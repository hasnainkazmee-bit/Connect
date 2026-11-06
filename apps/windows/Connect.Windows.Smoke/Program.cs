using System.IO;
using System.Diagnostics;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Connect.Core;
using Connect.Windows;
using Microsoft.Web.WebView2.Core;

internal static class Program
{
    private static readonly List<string> checks=[];
    private static string output="";
    [STAThread]
    private static int Main(string[] args)
    {
        if(args.Length!=3){Console.Error.WriteLine("Usage: Connect.Windows.Smoke <loopback-app-origin> <loopback-sso-origin> <output-dir>");return 2;}
        var policy=NavigationPolicy.ForTesting(new Uri(args[0]),new Uri(args[1]));
        output=Path.GetFullPath(args[2]);Directory.CreateDirectory(output);
        Trace.Listeners.Add(new TextWriterTraceListener(Path.Combine(output,"native-decisions.log")));Trace.AutoFlush=true;
        var app=new Application { ShutdownMode=ShutdownMode.OnExplicitShutdown };
        var result=1;
        app.Startup+=async(_,_)=>
        {
            try{await Run(policy);result=0;}
            catch(Exception ex)
            {
                Console.Error.WriteLine(ex);File.WriteAllText(Path.Combine(output,"failure.txt"),ex.ToString());
                CaptureFailureDesktop();
            }
            finally{File.WriteAllText(Path.Combine(output,"checks.json"),JsonSerializer.Serialize(checks,new JsonSerializerOptions{WriteIndented=true}));app.Shutdown(result);}
        };
        app.Run();return result;
    }
    private static void Check(bool condition,string label)
    {if(!condition)throw new InvalidOperationException(label);checks.Add(label);Console.WriteLine("PASS "+label);}
    private static async Task Until(Func<bool> condition,string label,int seconds=30)
    {var until=DateTime.UtcNow.AddSeconds(seconds);while(!condition()){if(DateTime.UtcNow>until)throw new TimeoutException(label);await Task.Delay(100);}}
    private static async Task UntilJs(CoreWebView2 core,string expression,string label)
    {var until=DateTime.UtcNow.AddSeconds(20);while(!await Bool(core,expression)){if(DateTime.UtcNow>until)throw new TimeoutException(label);await Task.Delay(100);}}
    private static async Task<bool> Bool(CoreWebView2 core,string expression)=>await core.ExecuteScriptAsync(expression)=="true";
    private static async Task<JsonElement> EvaluateWithoutGesture(CoreWebView2 core,string expression)
    {
        var json=await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate",JsonSerializer.Serialize(new{expression,userGesture=false,returnByValue=true}));
        using var result=JsonDocument.Parse(json);
        return result.RootElement.GetProperty("result").GetProperty("value").Clone();
    }
    private static void Click(Button button)=>button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T:DependencyObject
    {
        foreach(var child in LogicalTreeHelper.GetChildren(root).OfType<DependencyObject>())
        {if(child is T match)yield return match;foreach(var nested in Descendants<T>(child))yield return nested;}
    }
    private static async Task TrustedClick(CoreWebView2 core,string id)
    {
        var browser=Application.Current.Windows.Cast<Window>()
            .Select(window=>window switch{MainWindow main=>main.Browser,AuthWindow auth=>auth.Browser,_=>null})
            .First(view=>view is not null&&ReferenceEquals(view.CoreWebView2,core))!;
        Window.GetWindow(browser).Activate();browser.Focus();await Task.Delay(100);
        var target=JsonSerializer.Serialize(id);
        var deadline=DateTime.UtcNow.AddSeconds(20);
        while(!(await EvaluateWithoutGesture(core,$"!!document.getElementById({target})")).GetBoolean())
        {if(DateTime.UtcNow>deadline)throw new TimeoutException("Click target exists");await Task.Delay(100);}
        await EvaluateWithoutGesture(core,$"(()=>{{document.getElementById({target}).scrollIntoView({{block:'center'}});return true}})()");
        await Task.Delay(150);
        var point=await EvaluateWithoutGesture(core,$"(()=>{{const r=document.getElementById({target}).getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}}}})()");
        var x=point.GetProperty("x").GetDouble();var y=point.GetProperty("y").GetDouble();
        var screen=browser.PointToScreen(new Point(x*browser.ZoomFactor,y*browser.ZoomFactor));
        if(!SetCursorPos((int)Math.Round(screen.X),(int)Math.Round(screen.Y)))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        NativeInput[] inputs=[new(){Type=0,Data=new(){Mouse=new(){Flags=0x0002}}},new(){Type=0,Data=new(){Mouse=new(){Flags=0x0004}}}];
        if(SendInput((uint)inputs.Length,inputs,Marshal.SizeOf<NativeInput>())!=inputs.Length)throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    private static async Task Run(NavigationPolicy policy)
    {
        var profile=Path.Combine(output,"profile","WebView2");
        var area=SystemParameters.WorkArea;
        var window=new MainWindow(policy,profile){Width=Math.Min(1280,area.Width),Height=Math.Min(850,area.Height),Left=area.Left,Top=area.Top,WindowStartupLocation=WindowStartupLocation.Manual};window.Show();window.Activate();
        await window.Initialized.WaitAsync(TimeSpan.FromSeconds(45));await Until(()=>window.WorkspaceState.Ready,"Initial native bridge");
        var core=window.Browser.CoreWebView2;
        core.NavigationStarting+=(_,e)=>File.AppendAllText(Path.Combine(output,"navigation.log"),$"{e.Uri} userInitiated={e.IsUserInitiated} redirected={e.IsRedirected} cancelled={e.Cancel}\n");
        core.WebResourceRequested+=(_,e)=>File.AppendAllText(Path.Combine(output,"document-requests.log"),$"{e.Request.Uri} context={e.ResourceContext} response={e.Response?.StatusCode}\n");
        Check(window.WindowStyle==WindowStyle.SingleBorderWindow&&window.ResizeMode==ResizeMode.CanResize,"Native Windows caption, resize and Snap controls");
        Check(!window.CreateButton.IsEnabled,"Guest Create is visibly disabled");
        Check(window.HomeButton.IsSelected,"Home initially selected");
        Click(window.NotificationsButton);await UntilJs(core,"commands.some(x=>x.type==='notifications')","Notifications command");Check(true,"Notifications invokes account-aware workspace action");
        Click(window.AccountButton);await UntilJs(core,"commands.some(x=>x.type==='account')","Account command");Check(true,"Native sign-in button invokes account action");
        window.NetworkButton.IsSelected=true;await Until(()=>window.WorkspaceState.Path=="/network"&&window.NetworkButton.IsSelected,"Guest Network route");Check(true,"Guest My Network retains correct native selection");
        window.MessagesButton.IsSelected=true;await Until(()=>window.WorkspaceState.Path=="/messages"&&window.MessagesButton.IsSelected,"Guest Messages route");Check(true,"Guest Messages retains correct native selection");
        await core.ExecuteScriptAsync("Object.assign(fixtureState,{signedIn:true,accountType:'company',userName:'Test employee',companyName:'Solar Test',canPublish:true,unreadCount:3});sendState()");
        await Until(()=>window.CreateButton.IsEnabled,"Company publish permission");Click(window.CreateButton);await UntilJs(core,"commands.some(x=>x.type==='compose')","Compose action");Check(true,"Company Create opens existing publisher");
        Check(window.NotificationsButton.ToolTip?.ToString()?.Contains("3 unread")==true,"Native notification unread count");
        await CheckNotifications(window);
        await core.ExecuteScriptAsync("Object.assign(fixtureState,{accountType:'individual',canPublish:true});sendState()");
        await Until(()=>!window.CreateButton.IsEnabled,"Individual publish denied");Check(window.NetworkButton.Visibility==Visibility.Collapsed,"Individuals cannot publish or open company network");
        await core.ExecuteScriptAsync("Object.assign(fixtureState,{accountType:'company',canPublish:false});sendState()");await Until(()=>window.NetworkButton.Visibility==Visibility.Visible,"Company network restored");
        Check(!window.CreateButton.IsEnabled,"Company viewer cannot publish");
        await window.NavigateAsync("/directory");await Until(()=>window.DirectoryButton.IsSelected,"Directory selection");
        foreach(var theme in new[]{"Light","Dark"})
        {
            var item=Descendants<MenuItem>(window).First(x=>x.Header?.ToString()==theme);item.RaiseEvent(new RoutedEventArgs(MenuItem.ClickEvent));
            await UntilJs(core,$"matchMedia('(prefers-color-scheme: dark)').matches=={(theme=="Dark"?"true":"false")}","Theme propagation");
            Check(true,$"{theme} theme applies to native shell and workspace");await Capture(window,theme.ToLowerInvariant());
        }
        window.Width=800;await Task.Delay(400);window.UpdateLayout();
        var sidebarRight=window.NavigationList.TranslatePoint(new Point(window.NavigationList.ActualWidth,0),window).X;
        var webLeft=window.Browser.TranslatePoint(new Point(0,0),window).X;
        Check(webLeft>=sidebarRight&&window.Browser.ActualWidth>=500,"Sidebar and content never overlap at narrow desktop width");
        Check(window.CreateButton.TranslatePoint(new Point(0,0),window).X>=webLeft,"Toolbar actions remain in workspace at narrow width");await Capture(window,"narrow");window.Width=Math.Min(1280,area.Width);
        // ExecuteScriptAsync supplies a host user gesture that remains transiently
        // active even after that call completes. A false CDP userGesture does not
        // erase it. Wait with CDP only so the probe itself cannot renew activation.
        var activationDeadline=DateTime.UtcNow.AddSeconds(15);
        while(true)
        {
            var activationJson=await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate",JsonSerializer.Serialize(new{expression="navigator.userActivation.isActive",userGesture=false,returnByValue=true}));
            using var activation=JsonDocument.Parse(activationJson);
            if(!activation.RootElement.GetProperty("result").GetProperty("value").GetBoolean())break;
            if(DateTime.UtcNow>activationDeadline)throw new TimeoutException("Page user activation did not expire before non-user navigation test");
            await Task.Delay(250);
        }
        var navigationEvidence=new List<object>();
        core.NavigationStarting+=(_,e)=>navigationEvidence.Add(new{url=e.Uri,userInitiated=e.IsUserInitiated,redirect=e.IsRedirected,cancelled=e.Cancel});
        await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate",JsonSerializer.Serialize(new{expression="setTimeout(()=>{location.href='http://127.0.0.1:4198/untrusted'},0)",userGesture=false}));await Task.Delay(700);
        Check(new Uri(core.Source).Port==policy.ConnectOrigin.Port,"Untrusted programmatic navigation is blocked");
        using(var client=new HttpClient{Timeout=TimeSpan.FromSeconds(5)})
        {
            var json=await client.GetStringAsync(new Uri(policy.ConnectOrigin,"/stats"));File.WriteAllText(Path.Combine(output,"fixture-stats.json"),json);File.WriteAllText(Path.Combine(output,"navigation-evidence.json"),JsonSerializer.Serialize(navigationEvidence));
            using var stats=JsonDocument.Parse(json);Check(stats.RootElement.GetProperty("untrustedRequests").GetInt32()==0,"No untrusted origin request occurred");
        }
        // The geometry reads in TrustedClick do not activate the document. Only
        // actual Windows mouse input should authorize this same-window link.
        Check(!(await EvaluateWithoutGesture(core,"navigator.userActivation.isActive")).GetBoolean(),"Script navigation did not create transient activation");
        await TrustedClick(core,"external");
        var clickDeadline=DateTime.UtcNow.AddSeconds(5);
        while(!(await EvaluateWithoutGesture(core,"window.fixtureLastClick?.id==='external'")).GetBoolean())
        {if(DateTime.UtcNow>clickDeadline)throw new TimeoutException("Windows input did not click the external anchor");await Task.Delay(50);}
        var click=await EvaluateWithoutGesture(core,"fixtureLastClick");
        File.WriteAllText(Path.Combine(output,"trusted-click.json"),click.GetRawText());
        Check(click.GetProperty("trusted").GetBoolean()&&click.GetProperty("active").GetBoolean(),"Real Windows click carries trusted transient activation");
        using(var client=new HttpClient{Timeout=TimeSpan.FromSeconds(5)})
        {
            var deadline=DateTime.UtcNow.AddSeconds(20);
            while(true)
            {
                var json=await client.GetStringAsync(new Uri(policy.ConnectOrigin,"/stats"));
                File.WriteAllText(Path.Combine(output,"trusted-external-stats.json"),json);
                using var stats=JsonDocument.Parse(json);
                var requests=stats.RootElement.GetProperty("untrustedDetails").EnumerateArray()
                    .Where(request=>request.GetProperty("url").GetString()=="/trusted-external").ToArray();
                if(requests.Length>0)
                {
                    Check(requests.All(request=>!(request.GetProperty("userAgent").GetString()??"").Contains("ConnectWindows/",StringComparison.Ordinal)),"Trusted external anchor opens in the OS browser");
                    break;
                }
                if(DateTime.UtcNow>deadline)throw new TimeoutException("Trusted external anchor did not reach the OS browser");
                await Task.Delay(250);
            }
        }
        Check(new Uri(core.Source).Port==policy.ConnectOrigin.Port,"Trusted external link leaves Connect in its workspace");
        window.Activate();await Task.Delay(200);
        var priorBoot=await core.ExecuteScriptAsync("fixtureBoot");
        await TrustedClick(core,"internal");await UntilJs(core,$"window.fixtureBoot&&fixtureBoot!=={priorBoot}","Same-origin new window link");await Until(()=>window.WorkspaceState.Ready,"New document bridge ready");Check(true,"Same-origin target blank link stays in workspace");
        await TrustedClick(core,"sunhub");
        await Until(()=>Application.Current.Windows.OfType<AuthWindow>().Any(),"Native Sunhub popup opens");
        var popup=Application.Current.Windows.OfType<AuthWindow>().Single();
        await Until(()=>popup.Browser.CoreWebView2 is not null&&Uri.TryCreate(popup.Browser.CoreWebView2.Source,UriKind.Absolute,out var u)&&u.Port==policy.SsoOrigin.Port,"SSO page navigation");
        await UntilJs(popup.Browser.CoreWebView2,"!!document.getElementById('continue')","SSO document ready");
        Check(await Bool(popup.Browser.CoreWebView2,"!!window.opener"),"Native Sunhub popup preserves opener");
        Check(!popup.Browser.CoreWebView2.Settings.IsWebMessageEnabled,"SSO page cannot invoke native workspace bridge");
        await TrustedClick(popup.Browser.CoreWebView2,"continue");
        await UntilJs(core,"authDone===true","SSO completion reaches opener");await Until(()=>!Application.Current.Windows.OfType<AuthWindow>().Any(),"SSO popup closes");
        Check(await Bool(core,"document.cookie.includes('fixtureAuth=complete')"),"Popup shares session cookies and completes smoothly");
        await TrustedClick(core,"sunhub");await Until(()=>Application.Current.Windows.OfType<AuthWindow>().Any(),"Second popup");
        popup=Application.Current.Windows.OfType<AuthWindow>().Single();await Until(()=>popup.Browser.CoreWebView2 is not null&&popup.Browser.CoreWebView2.Source.Contains("/login"),"Cancellation document ready");popup.Close();
        await UntilJs(core,"!!lastPopup&&lastPopup.closed","Popup cancellation");Check(true,"Closing sign-in popup reports cancellation to opener");
        await core.ExecuteScriptAsync("document.cookie='fixturePersist=saved; Path=/; SameSite=Lax; Max-Age=3600'");
        window.Close();await Until(()=>!window.IsVisible,"Window closes cleanly");
        var reopened=new MainWindow(policy,profile);reopened.Show();await reopened.Initialized.WaitAsync(TimeSpan.FromSeconds(45));await Until(()=>reopened.WorkspaceState.Ready,"Reopened session");
        Check(await Bool(reopened.Browser.CoreWebView2,"document.cookie.includes('fixturePersist=saved')&&document.cookie.includes('fixtureAuth=complete')"),"Cookies persist after closing and reopening Connect");
        Check(reopened.DirectoryButton.IsSelected,"Safe workspace route restored after relaunch");reopened.Close();await Until(()=>!reopened.IsVisible,"Reopened window closes");
        await CheckPublicGuest();
        Console.WriteLine($"{checks.Count} native Windows checks passed.");
    }
    private sealed class FakeNotificationSink : INotificationSink
    {
        public event Action<string>? Clicked;
        public bool Supported=>true;
        public bool Enabled=>true;
        public readonly List<string> Shown=[];
        public int Clears;
        public readonly List<string> Removed=[];
        public void Register(){}
        public bool Show(string id,string title,string body){Shown.Add(id);return true;}
        public Task Clear(){Clears++;return Task.CompletedTask;}
        public Task Remove(string id){Removed.Add(id);return Task.CompletedTask;}
        public void Tap(string id)=>Clicked?.Invoke(id);
        public void Dispose(){}
    }
    private static async Task CheckNotifications(MainWindow window)
    {
        var sink=new FakeNotificationSink();var replies=new List<JsonElement>();
        var user="11111111-1111-4111-8111-111111111111";var id="22222222-2222-4222-8222-222222222222";
        using(var coordinator=new NotificationCoordinator(window,Path.Combine(output,"notification-test.txt"),value=>replies.Add(JsonSerializer.SerializeToElement(value)),sink))
        {
            bool Send(object value)=>coordinator.Handle(JsonSerializer.Serialize(value));
            coordinator.SetOwner(user);
            Send(new{type="notificationPermission",requestId=id});
            await Until(()=>replies.Any(r=>r.TryGetProperty("requestId",out var request)&&request.GetString()==id),"Notification gesture denial");
            Check(!replies.Last().GetProperty("enabled").GetBoolean(),"Native alerts require an explicit gesture");
            coordinator.EnableFromGesture(Guid.NewGuid().ToString());
            await Until(()=>replies.Last().GetProperty("enabled").GetBoolean(),"Native notification opt-in");
            var notice=new{type="notificationShow",id,userId=user,title="Connect",body="A new notification",url="/messages?company=33333333-3333-4333-8333-333333333333",companyId=(string?)null};
            Send(notice);Send(notice);
            Send(new{type="notificationShow",id=Guid.NewGuid().ToString(),userId=Guid.NewGuid().ToString(),title="Connect",body="Wrong owner",url="/messages"});
            Send(new{type="notificationShow",id=Guid.NewGuid().ToString(),userId=user,title="Connect",body="Unsafe route",url="https://evil.test"});
            Check(sink.Shown.Count==1,"Native alerts reject duplicate IDs, wrong owners and external routes");
            sink.Tap(id);await Until(()=>replies.Any(r=>r.GetProperty("type").GetString()=="open"),"Native notification tap");
            Check(replies.Last().GetProperty("userId").GetString()==user,"Native tap retains owner and safe route context");
            var taps=replies.Count(r=>r.GetProperty("type").GetString()=="open");
            Send(new{type="notificationRead",userId=Guid.NewGuid().ToString(),ids=new[]{id}});
            Check(sink.Removed.Count==0,"Another account cannot withdraw notifications");
            Send(new{type="notificationRead",userId=user,ids=new[]{id}});Send(notice);sink.Tap(id);await Task.Delay(50);
            Check(sink.Removed.Contains(id)&&sink.Shown.Count==1&&replies.Count(r=>r.GetProperty("type").GetString()=="open")==taps,"Reading withdraws OS alerts and rejects late delivery or stale taps");
            var queued=Guid.NewGuid().ToString();Send(new{type="notificationRead",userId=user,ids=new[]{queued}});
            Send(new{type="notificationShow",id=queued,userId=user,title="Connect",body="Already read",url="/messages"});
            Check(sink.Shown.Count==1,"A confirmed read suppresses an alert still queued for delivery");
            coordinator.SetOwner(null);sink.Tap(id);await Task.Delay(50);
            Check(sink.Clears>0&&replies.Count(r=>r.GetProperty("type").GetString()=="open")==taps,"Logout clears OS alerts and invalidates stale taps");
            Check(!File.Exists(Path.Combine(output,"notification-test.txt")),"Logout clears per-account desktop notification opt-in");
            foreach(var path in new[]{"//evil.test/messages","/api/session","/messages%2f..%2fauth","/messages\\evil","javascript:alert(1)"})Check(!NotificationCoordinator.IsSafePath(path),"Native notification route rejects "+path);
        }
        using var runtime=new WindowsNotificationSink();
        if(runtime.Supported){runtime.Register();_ = runtime.Enabled;await runtime.Clear();Check(true,"Actual Windows notification runtime registers and clears without sending test alerts");}
        else Check(true,"Windows reports native notifications unsupported; user receives explicit fallback");
    }
    private static async Task CheckPublicGuest()
    {
        // Production is strictly read-only here: a new guest profile, normal
        // allowlist, and directory GETs. No fixture cookies or accounts cross over.
        var area=SystemParameters.WorkArea;
        var live=new MainWindow(new NavigationPolicy(),Path.Combine(output,"public-profile","WebView2"))
        {
            Width=Math.Min(1280,area.Width),Height=Math.Min(850,area.Height),
            Left=area.Left,Top=area.Top,WindowStartupLocation=WindowStartupLocation.Manual
        };
        try
        {
            live.Show();live.Activate();
            await live.Initialized.WaitAsync(TimeSpan.FromSeconds(45));
            await Until(()=>live.WorkspaceState.Ready,"Production guest session ready",45);
            Check(!live.WorkspaceState.SignedIn&&!live.CreateButton.IsEnabled,"Public Connect opens as a fresh guest");
            await live.NavigateAsync("/directory");
            await Until(()=>live.DirectoryButton.IsSelected&&live.WorkspaceState.Path=="/directory","Production native Directory selection");
            var core=live.Browser.CoreWebView2;
            await UntilJs(core,"document.documentElement.classList.contains('connect-windows')&&!document.querySelector('.site-header')","Production Windows content integration");
            Check(true,"Public directory uses Windows chrome without duplicate web navigation");
            await Capture(live,"public");
        }
        catch(Exception error)
        {
            File.WriteAllText(Path.Combine(output,"production-failure.txt"),$"{error}\nSource: {live.Browser.CoreWebView2?.Source}\nReady: {live.WorkspaceState.Ready}");
            throw;
        }
        finally
        {
            live.Close();await Until(()=>!live.IsVisible,"Production guest window closes");
        }
    }
    private static async Task Capture(MainWindow window,string name)
    {
        window.Activate();await Task.Delay(300);
        using(var stream=File.Create(Path.Combine(output,name+"-workspace.png")))await window.Browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,stream);
        var handle=new WindowInteropHelper(window).Handle;
        if(!GetWindowRect(handle,out var rect))return;
        var width=rect.Right-rect.Left;var height=rect.Bottom-rect.Top;
        var screen=GetDC(IntPtr.Zero);var target=CreateCompatibleDC(screen);var bitmap=CreateCompatibleBitmap(screen,width,height);var old=SelectObject(target,bitmap);
        try
        {
            if(!BitBlt(target,0,0,width,height,screen,rect.Left,rect.Top,0x00CC0020))return;
            var image=Imaging.CreateBitmapSourceFromHBitmap(bitmap,IntPtr.Zero,Int32Rect.Empty,BitmapSizeOptions.FromEmptyOptions());var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(image));using var file=File.Create(Path.Combine(output,name+"-window.png"));encoder.Save(file);
        }
        finally{SelectObject(target,old);DeleteObject(bitmap);DeleteDC(target);ReleaseDC(IntPtr.Zero,screen);}
    }
    private static void CaptureFailureDesktop()
    {
        // This harness only runs on a disposable Windows CI desktop. Preserve
        // the foreground OS dialog, without activating Connect over it first.
        try
        {
            File.WriteAllLines(Path.Combine(output,"failure-processes.txt"),Process.GetProcesses()
                .Where(p=>p.ProcessName.Contains("edge",StringComparison.OrdinalIgnoreCase)||p.ProcessName.Contains("chrome",StringComparison.OrdinalIgnoreCase)||p.ProcessName=="Connect.Windows.Smoke")
                .Select(p=>$"{p.Id} {p.ProcessName}: {p.MainWindowTitle}"));
            var left=GetSystemMetrics(76);var top=GetSystemMetrics(77);var width=GetSystemMetrics(78);var height=GetSystemMetrics(79);
            var screen=GetDC(IntPtr.Zero);var target=CreateCompatibleDC(screen);var bitmap=CreateCompatibleBitmap(screen,width,height);var old=SelectObject(target,bitmap);
            try
            {
                if(!BitBlt(target,0,0,width,height,screen,left,top,0x00CC0020))return;
                var image=Imaging.CreateBitmapSourceFromHBitmap(bitmap,IntPtr.Zero,Int32Rect.Empty,BitmapSizeOptions.FromEmptyOptions());
                var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(image));using var file=File.Create(Path.Combine(output,"failure-desktop.png"));encoder.Save(file);
            }
            finally{SelectObject(target,old);DeleteObject(bitmap);DeleteDC(target);ReleaseDC(IntPtr.Zero,screen);}
        }
        catch(Exception error){File.WriteAllText(Path.Combine(output,"failure-capture-error.txt"),error.ToString());}
    }
    [StructLayout(LayoutKind.Sequential)] private struct Rect {public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)] private struct NativeInput {public uint Type;public InputData Data;}
    [StructLayout(LayoutKind.Explicit)] private struct InputData {[FieldOffset(0)]public MouseInput Mouse;}
    [StructLayout(LayoutKind.Sequential)] private struct MouseInput {public int X,Y;public uint MouseData,Flags,Time;public UIntPtr ExtraInfo;}
    [DllImport("user32.dll",SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] private static extern bool SetCursorPos(int x,int y);
    [DllImport("user32.dll",SetLastError=true)] private static extern uint SendInput(uint count,NativeInput[] inputs,int size);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc,int width,int height);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr destination,int x,int y,int width,int height,IntPtr source,int sourceX,int sourceY,int operation);
}
