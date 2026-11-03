using System.IO;
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
        var app=new Application { ShutdownMode=ShutdownMode.OnExplicitShutdown };
        var result=1;
        app.Startup+=async(_,_)=>
        {
            try{await Run(policy);result=0;}
            catch(Exception ex){Console.Error.WriteLine(ex);File.WriteAllText(Path.Combine(output,"failure.txt"),ex.ToString());}
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
    private static void Click(Button button)=>button.RaiseEvent(new RoutedEventArgs(Button.ClickEvent));
    private static IEnumerable<T> Descendants<T>(DependencyObject root) where T:DependencyObject
    {
        foreach(var child in LogicalTreeHelper.GetChildren(root).OfType<DependencyObject>())
        {if(child is T match)yield return match;foreach(var nested in Descendants<T>(child))yield return nested;}
    }
    private static async Task TrustedClick(CoreWebView2 core,string id)
    {
        await UntilJs(core,$"!!document.getElementById({JsonSerializer.Serialize(id)})","Click target exists");
        await core.ExecuteScriptAsync($"document.getElementById({JsonSerializer.Serialize(id)}).scrollIntoView({{block:'center'}})");
        await Task.Delay(150);
        var json=await core.ExecuteScriptAsync($"(()=>{{const r=document.getElementById({JsonSerializer.Serialize(id)}).getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}}}})()");
        using var point=JsonDocument.Parse(json);var x=point.RootElement.GetProperty("x").GetDouble();var y=point.RootElement.GetProperty("y").GetDouble();
        foreach(var type in new[]{"mousePressed","mouseReleased"})await core.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent",JsonSerializer.Serialize(new{type,x,y,button="left",clickCount=1}));
    }
    private static async Task Run(NavigationPolicy policy)
    {
        var profile=Path.Combine(output,"profile","WebView2");
        var area=SystemParameters.WorkArea;
        var window=new MainWindow(policy,profile){Width=Math.Min(1280,area.Width),Height=Math.Min(850,area.Height),Left=area.Left,Top=area.Top,WindowStartupLocation=WindowStartupLocation.Manual};window.Show();window.Activate();
        await window.Initialized.WaitAsync(TimeSpan.FromSeconds(45));await Until(()=>window.WorkspaceState.Ready,"Initial native bridge");
        var core=window.Browser.CoreWebView2;
        core.NavigationStarting+=(_,e)=>File.AppendAllText(Path.Combine(output,"navigation.log"),$"{e.Uri} userInitiated={e.IsUserInitiated} redirected={e.IsRedirected} cancelled={e.Cancel}\n");
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
    [StructLayout(LayoutKind.Sequential)] private struct Rect {public int Left,Top,Right,Bottom;}
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window,out Rect rect);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window,IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc,int width,int height);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr destination,int x,int y,int width,int height,IntPtr source,int sourceX,int sourceY,int operation);
}
