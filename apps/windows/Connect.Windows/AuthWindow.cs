using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Interop;
using Connect.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Connect.Windows;

public sealed class AuthWindow : Window
{
    private readonly NavigationPolicy policy;
    private readonly CoreWebView2Environment environment;
    private readonly WebView2 web=new();
    private AppearanceChoice appearance;
    private bool allowClose,closing,disposed;
    public WebView2 Browser=>web;
    public bool IsClosed=>disposed;
    public AuthWindow(NavigationPolicy policy,CoreWebView2Environment environment,AppearanceChoice appearance)
    {
        this.policy=policy;this.environment=environment;this.appearance=appearance;
        Title="Sunhub Account";Width=500;Height=720;MinWidth=390;MinHeight=560;ShowInTaskbar=false;
        WindowStartupLocation=WindowStartupLocation.Manual;ResizeMode=ResizeMode.CanResize;
        var panel=new Grid();panel.Children.Add(new TextBlock{Text="Opening Sunhub…",HorizontalAlignment=HorizontalAlignment.Center,VerticalAlignment=VerticalAlignment.Center});panel.Children.Add(web);Content=panel;
        Appearance.Apply(this,appearance);SetResourceReference(BackgroundProperty,"Surface");SetResourceReference(ForegroundProperty,"Ink");
        SourceInitialized+=(_,_)=>CenterOnOwnerMonitor();
        Closing+=OnClosing;Closed+=(_,_)=>{disposed=true;web.Dispose();};
    }
    public async Task InitializeAsync()
    {
        // The main and popup share the SAME environment/profile. Assigning this
        // CoreWebView2 to NewWindow preserves browser opener and session semantics.
        await web.EnsureCoreWebView2Async(environment);
        if(disposed)return;
        var core=web.CoreWebView2;
        MainWindow.ConfigureCore(core);
        core.Settings.IsWebMessageEnabled=false; // Authentication has no native app bridge.
        SetAppearance(appearance);
        core.NavigationStarting+=(_,e)=>{
            if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out var url)){e.Cancel=true;return;}
            if(policy.Classify(url,true)==NavigationDecision.Internal)return;
            e.Cancel=true;if(e.IsUserInitiated&&!e.IsRedirected&&policy.Classify(url,true)==NavigationDecision.External)ExternalLinks.Open(url);
        };
        core.NewWindowRequested+=(_,e)=>{e.Handled=true;if(e.IsUserInitiated&&Uri.TryCreate(e.Uri,UriKind.Absolute,out var url)&&policy.Classify(url,true)==NavigationDecision.External)ExternalLinks.Open(url);};
        core.DownloadStarting+=(_,e)=>e.Cancel=true;
        core.WindowCloseRequested+=(_,_)=>Dispatcher.BeginInvoke(FinishClosing);
        core.ProcessFailed+=(_,_)=>{if(!disposed)Dispatcher.BeginInvoke(()=>{MessageBox.Show(this,"The sign-in window stopped responding. Close it and try signing in again from Connect.","Sunhub Account",MessageBoxButton.OK,MessageBoxImage.Information);FinishClosing();});};
    }
    public void SetAppearance(AppearanceChoice value){appearance=value;Appearance.Apply(this,value,web.CoreWebView2);web.DefaultBackgroundColor=Appearance.IsDark(value)?System.Drawing.Color.FromArgb(32,51,66):System.Drawing.Color.White;}
    internal void AttachDocumentGuard()
    {
        // WebView2 requires request interception to be attached after this core
        // is assigned to NewWindow, while its creation deferral is still held.
        var core=web.CoreWebView2;
        core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.Document,CoreWebView2WebResourceRequestSourceKinds.Document);
        core.WebResourceRequested+=(_,request)=>
        {
            if(request.ResourceContext==CoreWebView2WebResourceContext.Document&&
                (!Uri.TryCreate(request.Request.Uri,UriKind.Absolute,out var target)||policy.Classify(target,true)!=NavigationDecision.Internal))
                request.Response=environment.CreateWebResourceResponse(null,403,"Blocked","Content-Type: text/plain\r\nCache-Control: no-store");
        };
    }
    private async void OnClosing(object? sender,CancelEventArgs e)
    {
        if(allowClose)return;e.Cancel=true;if(closing)return;closing=true;
        try{if(web.CoreWebView2 is not null)await web.CoreWebView2.ExecuteScriptAsync("window.close()");}
        catch(Exception error)when(error is InvalidOperationException or COMException){}
        finally{FinishClosing();}
    }
    private void FinishClosing(){if(allowClose||disposed)return;allowClose=true;Close();}
    private void CenterOnOwnerMonitor()
    {
        var hwnd=new WindowInteropHelper(Owner ?? this).Handle;
        var monitor=MonitorFromWindow(hwnd,2);var info=new MonitorInfo{Size=Marshal.SizeOf<MonitorInfo>()};
        if(!GetMonitorInfo(monitor,ref info)){WindowStartupLocation=WindowStartupLocation.CenterScreen;return;}
        var source=PresentationSource.FromVisual(this);var fromDevice=source?.CompositionTarget?.TransformFromDevice ?? System.Windows.Media.Matrix.Identity;
        var topLeft=fromDevice.Transform(new Point(info.Work.Left,info.Work.Top));var bottomRight=fromDevice.Transform(new Point(info.Work.Right,info.Work.Bottom));
        Width=Math.Min(500,bottomRight.X-topLeft.X);Height=Math.Min(720,bottomRight.Y-topLeft.Y);
        Left=topLeft.X+(bottomRight.X-topLeft.X-Width)/2;Top=topLeft.Y+(bottomRight.Y-topLeft.Y-Height)/2;
    }
    [StructLayout(LayoutKind.Sequential)]private struct Rect{public int Left,Top,Right,Bottom;}
    [StructLayout(LayoutKind.Sequential)]private struct MonitorInfo{public int Size;public Rect Monitor,Work;public uint Flags;}
    [DllImport("user32.dll")]private static extern IntPtr MonitorFromWindow(IntPtr hwnd,uint flags);
    [DllImport("user32.dll",CharSet=CharSet.Auto)] [return:MarshalAs(UnmanagedType.Bool)]private static extern bool GetMonitorInfo(IntPtr monitor,ref MonitorInfo info);
}
