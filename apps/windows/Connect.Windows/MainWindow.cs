using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Connect.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;

namespace Connect.Windows;

public sealed class MainWindow : Window
{
    private readonly NavigationPolicy policy;
    private readonly string userDataFolder;
    private readonly SettingsStore settings;
    private WindowPreferences preferences;
    private WorkspaceState state=WorkspaceState.Empty;
    private CoreWebView2Environment? environment;
    private readonly WebView2 web=new();
    private readonly Image lightWordmark=new();
    private readonly StackPanel darkWordmark=new(){Orientation=Orientation.Horizontal};
    private readonly ListBox navigation=new(){ BorderThickness=new Thickness(0), Background=Brushes.Transparent };
    private readonly Dictionary<string,ListBoxItem> routes=[];
    private readonly Button back=NativeControls.Button("Back (Alt+Left)","\uE72B");
    private readonly Button forward=NativeControls.Button("Forward (Alt+Right)","\uE72A");
    private readonly Button reload=NativeControls.Button("Reload (Ctrl+R)","\uE72C");
    private readonly Button compose=NativeControls.Button("New post (Ctrl+N)");
    private readonly Button notifications=NativeControls.Button("Notifications","\uEA8F");
    private readonly Button account=NativeControls.Button("Sign in");
    private readonly TextBlock routeTitle=new(){ FontSize=17, FontWeight=FontWeights.SemiBold, VerticalAlignment=VerticalAlignment.Center, Margin=new Thickness(14,0,12,0) };
    private readonly TextBlock status=new(){FontSize=12,Margin=new Thickness(12,4,12,4),TextWrapping=TextWrapping.Wrap};
    private readonly Border recovery=new(){Padding=new Thickness(36),Visibility=Visibility.Collapsed};
    private readonly TextBlock recoveryTitle=new(){FontSize=24,FontWeight=FontWeights.SemiBold,TextWrapping=TextWrapping.Wrap};
    private readonly TextBlock recoveryBody=new(){FontSize=14,TextWrapping=TextWrapping.Wrap,Margin=new Thickness(0,12,0,20),MaxWidth=470};
    private readonly Button retry=NativeControls.Button("Try again");
    private readonly List<AuthWindow> authWindows=[];
    private DownloadCoordinator? downloads;
    private (string Type,string? Path)? pendingCommand;
    private bool selectingRoute,closed,allowClose,confirming,initializing;
    private string? lastSafeUrl;
    private long navigationGeneration;
    private ulong activeNavigationId;
    private readonly TaskCompletionSource<bool> initialized=new(TaskCreationOptions.RunContinuationsAsynchronously);
    public WebView2 Browser => web;
    public Button CreateButton => compose;
    public Button NotificationsButton => notifications;
    public Button AccountButton => account;
    public ListBox NavigationList => navigation;
    public ListBoxItem HomeButton => routes["/"];
    public ListBoxItem DirectoryButton => routes["/directory"];
    public ListBoxItem NetworkButton => routes["/network"];
    public ListBoxItem MessagesButton => routes["/messages"];
    public new Task Initialized => initialized.Task;
    public WorkspaceState WorkspaceState => state;
    public MainWindow():this(new NavigationPolicy(),Path.Combine(SettingsStore.ApplicationFolder,"WebView2")){}

    // Test harnesses pass loopback-only NavigationPolicy.ForTesting and a fresh profile.
    public MainWindow(NavigationPolicy policy,string userDataFolder)
    {
        this.policy=policy;this.userDataFolder=userDataFolder;
        settings=new SettingsStore(Path.Combine(Path.GetDirectoryName(userDataFolder)!,"preferences.json"),policy);
        preferences=settings.Load();lastSafeUrl=preferences.LastUrl;
        Title="Connect";MinWidth=720;MinHeight=580;
        Width=Math.Min(preferences.Width,SystemParameters.WorkArea.Width);Height=Math.Min(preferences.Height,SystemParameters.WorkArea.Height);
        WindowStartupLocation=WindowStartupLocation.CenterScreen;
        Icon=BitmapFrame.Create(new Uri("pack://application:,,,/Connect;component/Assets/connect-icon.png"));
        SetResourceReference(BackgroundProperty,"Canvas");SetResourceReference(ForegroundProperty,"Ink");
        Appearance.Apply(this,preferences.Appearance);NativeControls.InstallNavigationStyle(this);BuildContent();
        Loaded+=async (_,_)=>await InitializeAsync();Closing+=OnClosing;
        Closed+=(_,_)=>Dispose();PreviewKeyDown+=OnKeyDown;
        SystemEvents.UserPreferenceChanged+=OnSystemAppearance;
    }
    private void BuildContent()
    {
        var shell=new Grid();shell.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(224),MinWidth=188,MaxWidth=270});shell.ColumnDefinitions.Add(new ColumnDefinition{Width=new GridLength(1,GridUnitType.Star)});
        var sidebar=new Grid();sidebar.SetResourceReference(BackgroundProperty,"Chrome");sidebar.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});sidebar.RowDefinitions.Add(new RowDefinition{Height=new GridLength(1,GridUnitType.Star)});sidebar.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});
        var brand=new Grid{Margin=new Thickness(20,22,16,24),Height=40};
        lightWordmark.Source=BitmapFrame.Create(new Uri("pack://application:,,,/Connect;component/Assets/connect-logo.png"));lightWordmark.Stretch=Stretch.Uniform;lightWordmark.HorizontalAlignment=HorizontalAlignment.Left;lightWordmark.MaxWidth=184;
        AutomationProperties.SetName(lightWordmark,"Connect");brand.Children.Add(lightWordmark);
        darkWordmark.Children.Add(new Image{Source=Icon,Width=31,Height=31,Margin=new Thickness(0,0,9,0),Stretch=Stretch.Uniform});
        darkWordmark.Children.Add(new TextBlock{Text="Connect",FontSize=23,FontWeight=FontWeights.SemiBold,VerticalAlignment=VerticalAlignment.Center});brand.Children.Add(darkWordmark);sidebar.Children.Add(brand);
        var navStack=new StackPanel();
        AddRoute("Home","/","\uE80F");AddRoute("Directory","/directory","\uE80A");AddRoute("My Network","/network","\uE716");AddRoute("Messages","/messages","\uE8BD");
        navigation.SelectionChanged+=async (_,_)=>{if(!selectingRoute && navigation.SelectedItem is ListBoxItem{Tag:string path}){UpdateRoute();await NavigateAsync(path);}};
        navStack.Children.Add(navigation);Grid.SetRow(navStack,1);sidebar.Children.Add(navStack);
        account.Margin=new Thickness(12,12,12,18);account.HorizontalAlignment=HorizontalAlignment.Stretch;account.HorizontalContentAlignment=HorizontalAlignment.Left;account.Click+=async(_,_)=>await SendCommandAsync("account");Grid.SetRow(account,2);sidebar.Children.Add(account);shell.Children.Add(sidebar);
        var splitter=new GridSplitter{Width=1,HorizontalAlignment=HorizontalAlignment.Right,ResizeDirection=GridResizeDirection.Columns,ResizeBehavior=GridResizeBehavior.CurrentAndNext};splitter.SetResourceReference(BackgroundProperty,"Line");shell.Children.Add(splitter);
        var workspace=new Grid();workspace.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});workspace.RowDefinitions.Add(new RowDefinition{Height=new GridLength(1,GridUnitType.Star)});workspace.RowDefinitions.Add(new RowDefinition{Height=GridLength.Auto});Grid.SetColumn(workspace,1);
        var toolbar=new DockPanel{LastChildFill=true,Margin=new Thickness(12,8,12,8)};
        var right=new StackPanel{Orientation=Orientation.Horizontal};DockPanel.SetDock(right,Dock.Right);
        compose.Content="New post";compose.IsEnabled=false;compose.Click+=async(_,_)=>{if(state.CanCreatePost)await SendCommandAsync("compose");};right.Children.Add(compose);
        notifications.Click+=async(_,_)=>await SendCommandAsync("notifications");right.Children.Add(notifications);
        var menu=new Menu{Background=Brushes.Transparent,VerticalAlignment=VerticalAlignment.Center};var view=new MenuItem{Header="View"};var appearance=new MenuItem{Header="Appearance"};
        foreach(var choice in Enum.GetValues<AppearanceChoice>()){var item=new MenuItem{Header=choice.ToString(),IsCheckable=true,IsChecked=preferences.Appearance==choice,Tag=choice};item.Click+=(_,_)=>{preferences=preferences with{Appearance=choice};ApplyAppearance();foreach(MenuItem sibling in appearance.Items)sibling.IsChecked=Equals(sibling.Tag,choice);SaveSettings();};appearance.Items.Add(item);}view.Items.Add(appearance);
        AddMenu(view,"Zoom in",()=>ChangeZoom(0.1));AddMenu(view,"Zoom out",()=>ChangeZoom(-0.1));AddMenu(view,"Actual size",()=>{web.ZoomFactor=1;SaveSettings();});menu.Items.Add(view);right.Children.Add(menu);toolbar.Children.Add(right);
        var history=new StackPanel{Orientation=Orientation.Horizontal};back.Click+=async(_,_)=>await GoHistoryAsync(false);forward.Click+=async(_,_)=>await GoHistoryAsync(true);reload.Click+=async(_,_)=>await ReloadAsync();history.Children.Add(back);history.Children.Add(forward);history.Children.Add(reload);toolbar.Children.Add(history);toolbar.Children.Add(routeTitle);workspace.Children.Add(toolbar);
        var webArea=new Grid();webArea.Children.Add(web);Grid.SetRow(webArea,1);workspace.Children.Add(webArea);
        var recoveryContent=new StackPanel{VerticalAlignment=VerticalAlignment.Center,HorizontalAlignment=HorizontalAlignment.Center};recoveryContent.Children.Add(recoveryTitle);recoveryContent.Children.Add(recoveryBody);retry.HorizontalAlignment=HorizontalAlignment.Left;retry.Click+=async(_,_)=>{if(web.CoreWebView2 is null)await InitializeAsync();else await ReloadAsync();};recoveryContent.Children.Add(retry);recovery.Child=recoveryContent;recovery.SetResourceReference(BackgroundProperty,"Canvas");webArea.Children.Add(recovery);
        Grid.SetRow(status,2);status.SetResourceReference(TextBlock.ForegroundProperty,"Secondary");workspace.Children.Add(status);shell.Children.Add(workspace);Content=shell;UpdateControls();ApplyAppearance();
    }
    private void AddRoute(string label,string path,string glyph)
    {
        var row=new StackPanel{Orientation=Orientation.Horizontal};var icon=NativeControls.Symbol(glyph,18);icon.Width=28;row.Children.Add(icon);row.Children.Add(new TextBlock{Text=label,FontSize=14,VerticalAlignment=VerticalAlignment.Center});
        var item=new ListBoxItem{Content=row,Tag=path,Style=(Style)Resources["NavigationItem"],ToolTip=label};AutomationProperties.SetName(item,label);routes[path]=item;navigation.Items.Add(item);
    }
    private static void AddMenu(MenuItem parent,string label,Action action){var item=new MenuItem{Header=label};item.Click+=(_,_)=>action();parent.Items.Add(item);}
    private async Task InitializeAsync()
    {
        if(initializing||closed)return;initializing=true;ShowStatus("Opening Connect…");
        try
        {
            environment ??= await CoreWebView2Environment.CreateAsync(null,userDataFolder);
            if(closed)return;
            await web.EnsureCoreWebView2Async(environment);
            if(closed)return;
            var core=web.CoreWebView2;
            ConfigureCore(core);
            // Stop external documents at the request boundary too: cancelling
            // NavigationStarting can still allow a speculative network request.
            // Images, media and API requests keep their normal browser policies;
            // authentication popups have their own separately restricted core.
            core.AddWebResourceRequestedFilter("*",CoreWebView2WebResourceContext.Document,CoreWebView2WebResourceRequestSourceKinds.Document);
            core.WebResourceRequested+=(_,request)=>
            {
                if(request.ResourceContext==CoreWebView2WebResourceContext.Document&&
                    (!Uri.TryCreate(request.Request.Uri,UriKind.Absolute,out var target)||policy.Classify(target)!=NavigationDecision.Internal))
                    request.Response=core.Environment.CreateWebResourceResponse(null,403,"Blocked","Content-Type: text/plain\r\nCache-Control: no-store");
            };
            downloads=new DownloadCoordinator(this,policy,core,ShowStatus);
            core.DownloadStarting+=(_,_)=>Dispatcher.BeginInvoke(async()=>await ExecuteCommandAsync("state"));
            core.NavigationStarting+=NavigationStarting;
            core.NavigationCompleted+=NavigationCompleted;
            core.SourceChanged+=(_,_)=>UpdateRoute();
            core.HistoryChanged+=(_,_)=>UpdateControls();
            core.WebMessageReceived+=ReceiveState;
            core.NewWindowRequested+=NewWindowRequested;
            core.ProcessFailed+=(_,_)=>ShowRecovery("Connect needs to reconnect","Your session is still saved. Try loading the workspace again.");
            core.WindowCloseRequested+=(_,_)=>Dispatcher.BeginInvoke(Close);
            core.ContextMenuRequested+=(_,e)=>{for(int i=e.MenuItems.Count-1;i>=0;i--)if(e.MenuItems[i].Name is "back" or "forward" or "reload")e.MenuItems.RemoveAt(i);};
            web.PreviewKeyDown+=OnKeyDown;
            web.ZoomFactor=preferences.Zoom;ApplyAppearance();
            recovery.Visibility=Visibility.Collapsed;
            core.Navigate(lastSafeUrl ?? policy.ConnectOrigin.AbsoluteUri);
            initialized.TrySetResult(true);
        }
        catch(Exception e) when(e is WebView2RuntimeNotFoundException or System.Runtime.InteropServices.COMException or InvalidOperationException or IOException)
        {
            ShowRecovery("Connect couldn’t open",e is WebView2RuntimeNotFoundException ? "Microsoft Edge WebView2 Runtime is required. Run the Connect installer again to install it, then reopen Connect." : "The workspace could not start. Check your connection and try again.");
        }
        finally{initializing=false;}
    }
    internal static void ConfigureCore(CoreWebView2 core)
    {
        core.Settings.UserAgent+=" ConnectWindows/0.1";
        core.Settings.AreHostObjectsAllowed=false;core.Settings.IsStatusBarEnabled=false;
        core.Settings.AreBrowserAcceleratorKeysEnabled=false;
#if !DEBUG
        core.Settings.AreDevToolsEnabled=false;
#endif
        core.PermissionRequested+=(_,e)=>e.State=CoreWebView2PermissionState.Deny;
        // Certificate verification, SameSite cookies and renderer isolation retain runtime defaults.
    }
    private void NavigationStarting(object? sender,CoreWebView2NavigationStartingEventArgs e)
    {
        if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out var uri)){e.Cancel=true;return;}
        var decision=policy.Classify(uri);
        if(decision!=NavigationDecision.Internal)
        {
            // Cancel synchronously: external content must never enter this WebView.
            e.Cancel=true;
            if(decision==NavigationDecision.External&&e.IsUserInitiated&&!e.IsRedirected)
                _=OpenActivatedExternalLinkAsync(uri);
            return;
        }
        web.Visibility=Visibility.Visible;activeNavigationId=e.NavigationId;navigationGeneration++;state=WorkspaceState.Empty;UpdateControls();ShowStatus("Loading…");
    }
    private async Task OpenActivatedExternalLinkAsync(Uri uri)
    {
        if(closed||!CurrentIsConnect()){Trace.WriteLine("Connect external navigation: no live trusted document.");return;}
        var core=web.CoreWebView2;
        var source=core.Source;
        var generation=navigationGeneration;
        bool StillCurrent()=>!closed&&ReferenceEquals(web.CoreWebView2,core)&&
            generation==navigationGeneration&&core.Source==source&&CurrentIsConnect();
        try
        {
            // IsUserInitiated can also be true for script navigation. Unlike
            // ExecuteScriptAsync, this query does not grant page activation.
            var json=await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
                JsonSerializer.Serialize(new{expression="navigator.userActivation.isActive",userGesture=false,returnByValue=true}))
                .WaitAsync(TimeSpan.FromSeconds(3));
            using var result=JsonDocument.Parse(json);
            Trace.WriteLine($"Connect external navigation: live={!closed}, sameCore={ReferenceEquals(web.CoreWebView2,core)}, sameGeneration={generation==navigationGeneration}, sameSource={!closed&&core.Source==source}, trusted={!closed&&CurrentIsConnect()}.");
            if(!StillCurrent()){Trace.WriteLine("Connect external navigation: document changed during activation check.");return;}
            if(!result.RootElement.TryGetProperty("result",out var evaluation)||
                !evaluation.TryGetProperty("value",out var active)||active.ValueKind!=JsonValueKind.True)
            {Trace.WriteLine("Connect external navigation: no transient activation.");return;}
            Trace.WriteLine("Connect external navigation: transient activation confirmed.");
            ExternalLinks.Open(uri,StillCurrent);
        }
        catch(Exception error)when(error is InvalidOperationException or System.Runtime.InteropServices.COMException or JsonException or TimeoutException)
        {
            // A missing, failed or stale activation check never opens an OS app.
            Trace.WriteLine($"Connect external navigation: activation check failed ({error.GetType().Name}).");
        }
    }
    private async void NavigationCompleted(object? sender,CoreWebView2NavigationCompletedEventArgs e)
    {
        if(closed||e.NavigationId!=activeNavigationId)return;
        if(!e.IsSuccess){if(e.WebErrorStatus!=CoreWebView2WebErrorStatus.OperationCanceled)ShowRecovery("You’re offline","Connect couldn’t reach the server. Check your connection, then try again.");else {if(downloads?.IsActive!=true)ShowStatus("");await ExecuteCommandAsync("state");}return;}
        if(e.HttpStatusCode>=500){ShowRecovery("Connect is temporarily unavailable","The server couldn’t load your workspace. Please try again in a moment.");return;}
        recovery.Visibility=Visibility.Collapsed;web.Visibility=Visibility.Visible;ShowStatus("");UpdateRoute();
        await ExecuteCommandAsync("state");
    }
    private void ReceiveState(object? sender,CoreWebView2WebMessageReceivedEventArgs e)
    {
        // CoreWebView2.WebMessageReceived is top-level only; no frame handlers are installed.
        if(closed || !Uri.TryCreate(e.Source,UriKind.Absolute,out var source)||!policy.IsConnect(source)||!CurrentIsConnect())return;
        if(!WorkspaceState.TryParse(e.WebMessageAsJson,out var received))return;
        state=received;UpdateControls();UpdateRoute();
        if(state.Ready&&pendingCommand is { } command){pendingCommand=null;_ = ExecuteCommandAsync(command.Type,command.Path);}
    }
    public async Task NavigateAsync(string path)
    {
        if(!DesktopCommands.IsAllowedPath(path))return;
        await SendCommandAsync("navigate",path);
    }
    public async Task SendCommandAsync(string type,string? path=null)
    {
        if(closed)return;
        if(!state.Ready){pendingCommand=(type,path);return;}
        await ExecuteCommandAsync(type,path);
    }
    private async Task ExecuteCommandAsync(string type,string? path=null)
    {
        if(!CurrentIsConnect()||closed)return;
        try{await web.CoreWebView2.ExecuteScriptAsync(DesktopCommands.ScriptFor(type,path));}
        catch(ArgumentException){ }
        catch(Exception e)when(e is InvalidOperationException or System.Runtime.InteropServices.COMException){ShowStatus("The workspace is reconnecting. Try again in a moment.");}
    }
    private bool CurrentIsConnect()=>web.CoreWebView2 is not null&&Uri.TryCreate(web.CoreWebView2.Source,UriKind.Absolute,out var current)&&policy.IsConnect(current);
    private void UpdateRoute()
    {
        var path=web.Source?.AbsolutePath ?? "/";
        var route=path=="/"?"/":path.StartsWith("/network",StringComparison.Ordinal)?"/network":path.StartsWith("/messages",StringComparison.Ordinal)?"/messages":path=="/directory"?"/directory":null;
        selectingRoute=true;foreach(var pair in routes){pair.Value.IsSelected=pair.Key==route;AutomationProperties.SetHelpText(pair.Value,pair.Key==route?"Current page":"");}selectingRoute=false;
        routeTitle.Text=route switch{"/"=>"Home","/directory"=>"Directory","/network"=>"My Network","/messages"=>"Messages",_=>"Connect"};
        if(policy.SafeRestorationUrl(web.Source) is { } safe)lastSafeUrl=safe.AbsoluteUri;
        UpdateControls();
    }
    private void UpdateControls()
    {
        back.IsEnabled=web.CoreWebView2?.CanGoBack==true;forward.IsEnabled=web.CoreWebView2?.CanGoForward==true;reload.IsEnabled=web.CoreWebView2 is not null;
        compose.IsEnabled=state.CanCreatePost;
        compose.SetResourceReference(Control.BackgroundProperty,state.CanCreatePost?"Accent":"Chrome");
        compose.SetResourceReference(Control.ForegroundProperty,state.CanCreatePost?"OnAccent":"Secondary");
        notifications.IsEnabled=state.Ready;
        notifications.ToolTip=state.UnreadCount>0?$"Notifications ({state.UnreadCount} unread)":"Notifications";
        AutomationProperties.SetName(notifications,notifications.ToolTip.ToString());
        account.Content=state.SignedIn ? new StackPanel{Children={new TextBlock{Text=state.UserName.Length>0?state.UserName:"Your account",TextTrimming=TextTrimming.CharacterEllipsis},new TextBlock{Text=state.CompanyName,FontSize=11,Opacity=0.7,TextTrimming=TextTrimming.CharacterEllipsis}}}:"Sign in";
        AutomationProperties.SetName(account,state.SignedIn?"Your account":"Sign in to Connect");
        if(routes.TryGetValue("/network",out var network))network.Visibility=state.CanUseNetwork?Visibility.Visible:Visibility.Collapsed;
    }
    private async void NewWindowRequested(object? sender,CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled=true;
        if(!CurrentIsConnect()||!Uri.TryCreate(e.Uri,UriKind.Absolute,out var target))return;
        var requestFrame=e.OriginalSourceFrameInfo;
        if(requestFrame.FrameId!=web.CoreWebView2.FrameId||!Uri.TryCreate(requestFrame.Source,UriKind.Absolute,out var source)||!policy.IsConnect(source))return;
        if(!policy.IsConnect(target)||target.AbsolutePath!="/api/auth/sunhub/start")
        {
            if(!e.IsUserInitiated)return;
            if(policy.IsConnect(target)&&!target.AbsolutePath.StartsWith("/api/auth",StringComparison.OrdinalIgnoreCase))
                web.CoreWebView2.Navigate(target.AbsoluteUri);
            else if(policy.Classify(target)==NavigationDecision.External)ExternalLinks.Open(target);
            return;
        }
        if(!e.IsUserInitiated||environment is null)return;
        using var deferral=e.GetDeferral();
        AuthWindow? popup=null;
        try
        {
            popup=new AuthWindow(policy,environment,preferences.Appearance){Owner=this};
            authWindows.Add(popup);popup.Closed+=(_,_)=>authWindows.Remove(popup);
            popup.Show();
            await popup.InitializeAsync();
            if(closed||popup.IsClosed){popup.Close();return;}
            e.NewWindow=popup.Browser.CoreWebView2;
            popup.AttachDocumentGuard();
        }
        catch(Exception ex)when(ex is InvalidOperationException or System.Runtime.InteropServices.COMException){popup?.Close();ShowStatus("The sign-in window could not open. Please try again.");}
    }
    // Real browser navigation invokes WebView2's native beforeunload dialog.
    // Do not pre-confirm and then ask the user a second time in Chromium.
    public Task ReloadAsync(){if(web.CoreWebView2 is not null){recovery.Visibility=Visibility.Collapsed;web.Reload();}return Task.CompletedTask;}
    private Task GoHistoryAsync(bool next){if(web.CoreWebView2 is not null&&(next?web.CoreWebView2.CanGoForward:web.CoreWebView2.CanGoBack)){if(next)web.GoForward();else web.GoBack();}return Task.CompletedTask;}
    private async Task<bool> ConfirmLeavingAsync(string action,bool quitting)
    {
        if(confirming)return false;confirming=true;
        try
        {
            bool dirty=false;
            if(CurrentIsConnect())
            {
                var generation=navigationGeneration;
                try
                {
                    var chats=quitting?"Object.keys(sessionStorage).some(k=>(k.startsWith('draft:')||k.startsWith('connect:personal-draft:'))&&(sessionStorage.getItem(k)||'').trim().length>0)":"false";
                    var result=await web.CoreWebView2.ExecuteScriptAsync("(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);let chats=false;try{chats="+chats+"}catch{}return e.defaultPrevented||chats})()");
                    dirty=result=="true";
                    if(generation!=navigationGeneration||closed)return false;
                }
                catch(Exception e)when(e is InvalidOperationException or System.Runtime.InteropServices.COMException){dirty=true;}
            }
            var active=quitting&&downloads?.IsActive==true;
            if(!dirty&&!active)return true;
            return MessageBox.Show(this,active?"A download is still in progress. Closing Connect will cancel it. Close anyway?":quitting?"Your unsent messages and changes that haven’t been saved will be lost. Close Connect anyway?":"Your draft or upload is still in progress. Leave and lose unsaved changes?",active?"Download in progress":"Changes in progress",MessageBoxButton.YesNo,MessageBoxImage.Warning,MessageBoxResult.No)==MessageBoxResult.Yes;
        }
        finally{confirming=false;}
    }
    private async void OnClosing(object? sender,CancelEventArgs e)
    {
        if(allowClose)return;e.Cancel=true;
        if(await ConfirmLeavingAsync("Close Connect",true)){allowClose=true;SaveSettings();Close();}
    }
    private void OnKeyDown(object sender,KeyEventArgs e){if(e.Handled)return;if(HandleKey(e.Key==Key.System?e.SystemKey:e.Key,Keyboard.Modifiers)){e.Handled=true;}}
    private static bool IsShortcut(Key key,ModifierKeys m)=>(m==ModifierKeys.Control&&key is Key.D1 or Key.D2 or Key.D3 or Key.D4 or Key.N or Key.R or Key.OemPlus or Key.Add or Key.OemMinus or Key.Subtract or Key.D0)||(m==ModifierKeys.Alt&&key is Key.Left or Key.Right)||(m==ModifierKeys.None&&key==Key.F5);
    private bool HandleKey(Key key,ModifierKeys m)
    {
        if(!IsShortcut(key,m))return false;
        if(m==ModifierKeys.Control){switch(key){case Key.D1:_=NavigateAsync("/");break;case Key.D2:_=NavigateAsync("/directory");break;case Key.D3:if(state.CanUseNetwork)_=NavigateAsync("/network");break;case Key.D4:_=NavigateAsync("/messages");break;case Key.N:if(state.CanCreatePost)_=SendCommandAsync("compose");break;case Key.R:_=ReloadAsync();break;case Key.OemPlus:case Key.Add:ChangeZoom(.1);break;case Key.OemMinus:case Key.Subtract:ChangeZoom(-.1);break;case Key.D0:web.ZoomFactor=1;SaveSettings();break;}}
        else if(m==ModifierKeys.Alt)_=GoHistoryAsync(key==Key.Right);else _=ReloadAsync();return true;
    }
    private void ChangeZoom(double delta){web.ZoomFactor=Math.Clamp(web.ZoomFactor+delta,.7,1.8);SaveSettings();}
    private void ShowRecovery(string title,string message){state=WorkspaceState.Empty;pendingCommand=null;UpdateControls();recoveryTitle.Text=title;recoveryBody.Text=message;web.Visibility=Visibility.Collapsed;recovery.Visibility=Visibility.Visible;ShowStatus("");}
    internal void ShowStatus(string message){status.Text=message;status.Visibility=message.Length==0?Visibility.Collapsed:Visibility.Visible;}
    private void ApplyAppearance(){lightWordmark.Visibility=Appearance.IsDark(preferences.Appearance)?Visibility.Collapsed:Visibility.Visible;darkWordmark.Visibility=Appearance.IsDark(preferences.Appearance)?Visibility.Visible:Visibility.Collapsed;Appearance.Apply(this,preferences.Appearance,web.CoreWebView2);web.DefaultBackgroundColor=Appearance.IsDark(preferences.Appearance)?System.Drawing.Color.FromArgb(28,45,58):System.Drawing.Color.FromArgb(242,247,252);foreach(var popup in authWindows)popup.SetAppearance(preferences.Appearance);}
    private void OnSystemAppearance(object sender,UserPreferenceChangedEventArgs e){if(!closed)Dispatcher.BeginInvoke(ApplyAppearance);}
    private void SaveSettings(){preferences=preferences with{LastUrl=lastSafeUrl,Width=RestoreBounds.Width>0?RestoreBounds.Width:Width,Height=RestoreBounds.Height>0?RestoreBounds.Height:Height,Zoom=web.ZoomFactor};settings.Save(preferences);}
    private void Dispose(){if(closed)return;closed=true;SystemEvents.UserPreferenceChanged-=OnSystemAppearance;foreach(var popup in authWindows.ToArray())popup.Close();downloads?.Dispose();web.Dispose();}
}
