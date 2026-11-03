using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows;
using Connect.Core;

namespace Connect.Windows;

// Local OS notifications only. Network/session authority remains in the trusted
// Connect document; no cookies, tokens, or notification bodies are persisted here.
internal sealed class NotificationCoordinator : IDisposable
{
    private readonly MainWindow window;
    private readonly string preferenceFile;
    private readonly Action<object> reply;
    private readonly INotificationSink sink;
    private readonly Dictionary<string, Notice> displayed = [];
    private readonly HashSet<string> seen = [];
    private string? owner, enabledFor;
    private bool registered, disposed;
    private long generation;
    private readonly record struct Notice(string Id,string UserId,string Title,string Body,string Url,string? CompanyId);
    public NotificationCoordinator(MainWindow window,string preferenceFile,Action<object> reply,INotificationSink? sink=null)
    {
        this.window=window;this.preferenceFile=preferenceFile;this.reply=reply;this.sink=sink??new WindowsNotificationSink();this.sink.Clicked+=Invoked;
        try { var value=File.ReadAllText(preferenceFile); if(Guid.TryParse(value,out _))enabledFor=value; } catch(IOException){} catch(UnauthorizedAccessException){}
    }
    public bool Handle(string json)
    {
        if(disposed||json.Length>8192)return false;
        try {
            using var parsed=JsonDocument.Parse(json);var data=parsed.RootElement;
            if(data.ValueKind!=JsonValueKind.Object||!data.TryGetProperty("type",out var kind)||kind.ValueKind!=JsonValueKind.String)return false;
            switch(kind.GetString()) {
                case "notificationOwner":
                    string? next=Text(data,"userId");if(next is not null&&!Guid.TryParse(next,out _))return true;
                    SetOwner(next);return true;
                case "notificationStatus": Status(Request(data));return true;
                case "notificationPermission":
                    Status(Request(data),"Use the Enable notifications button in Connect to continue.");return true;
                case "notificationDisable":
                    enabledFor=null;Save();Clear();Status(Request(data));return true;
                case "notificationShow":
                    if(ParseNotice(data) is { } notice)Show(notice);return true;
                default:return false;
            }
        } catch(JsonException){return false;}
    }
    private static string? Text(JsonElement data,string name)=>data.TryGetProperty(name,out var value)&&value.ValueKind==JsonValueKind.String?value.GetString():null;
    private static string? Request(JsonElement data)=>Text(data,"requestId") is { } id&&Guid.TryParse(id,out _)?id:null;
    internal static bool IsSafePath(string? value)
    {
        if(value is null||value.Length>2048||!value.StartsWith('/')||value.StartsWith("//")||value.Any(c=>char.IsWhiteSpace(c)||char.IsControl(c)||c=='\\')||value.Contains('%'))return false;
        var path=value.Split('?',2)[0];
        return Regex.IsMatch(path,@"^/(?:messages(?:/(?:people/|company/)?[a-fA-F0-9-]{36})?|posts/[a-fA-F0-9-]{36}|company/[a-fA-F0-9-]{36}|join/[a-z0-9][a-z0-9-]{1,39}|account(?:/updates)?|requests|network(?:/connections)?)$");
    }
    private static Notice? ParseNotice(JsonElement data)
    {
        var id=Text(data,"id");var user=Text(data,"userId");var title=Text(data,"title");var body=Text(data,"body");var url=Text(data,"url");var company=Text(data,"companyId");
        if(!Guid.TryParse(id,out _)||!Guid.TryParse(user,out _)||title is null||title.Length is <1 or >120||body is null||body.Length>500||!IsSafePath(url)||(company is not null&&!Guid.TryParse(company,out _)))return null;
        return new(id!,user!,title,body,url!,company);
    }
    public void SetOwner(string? value)
    {
        if(owner==value)return;
        generation++;Clear();owner=value;seen.Clear();
        if(value is null||enabledFor!=value){enabledFor=null;Save();}
        Status(null);
    }
    public void ResetDocument(){generation++;Clear();owner=null;seen.Clear();}
    private void Save(){try{Directory.CreateDirectory(Path.GetDirectoryName(preferenceFile)!);if(enabledFor is null)File.Delete(preferenceFile);else File.WriteAllText(preferenceFile,enabledFor);}catch(IOException){}catch(UnauthorizedAccessException){}}
    private bool Register()
    {
        if(registered)return true;
        if(!sink.Supported)return false;
        sink.Register();registered=true;return true;
    }
    public void EnableFromGesture(string request)
    {
        var expected=owner;var attempt=generation;
        if(expected is null||!window.WorkspaceState.Ready||!window.WorkspaceState.SignedIn) {Status(request,"Use the Enable notifications button in Connect to continue.");return;}
        if(disposed||generation!=attempt||owner!=expected)return;
        try {
            if(!Register()){Status(request,"Notifications are not supported on this Windows installation.");return;}
            if(!sink.Enabled){Status(request,"Allow Connect notifications in Windows Settings, then try again.");return;}
            enabledFor=owner;Save();Status(request);
        }catch(Exception error)when(error is System.Runtime.InteropServices.COMException or InvalidOperationException or TypeInitializationException or DllNotFoundException){Status(request,"Windows could not enable notifications. Install the latest Connect update and try again.");}
    }
    private void Status(string? request,string? error=null)
    {
        var permission="default";var enabled=false;
        try {
            if(owner is not null&&enabledFor==owner){if(Register()){permission=sink.Enabled?"granted":"denied";enabled=permission=="granted";}else permission="unsupported";}
        }catch(Exception){permission="unsupported";error??="Windows notifications are unavailable. Your Connect inbox still works.";}
        reply(new{type="status",requestId=request,enabled,permission,error});
    }
    private void Show(Notice notice)
    {
        if(disposed||owner!=notice.UserId||enabledFor!=owner||!seen.Add(notice.Id))return;
        try {
            if(!Register()||!sink.Enabled){Status(null);return;}
            displayed[notice.Id]=notice;
            if(!sink.Show(notice.Id,notice.Title,notice.Body)){displayed.Remove(notice.Id);Status(null,"Windows could not display an alert. Your Connect inbox still works.");}
        }catch(Exception){Status(null,"Windows could not display an alert. Your Connect inbox still works.");}
    }
    private void Invoked(string id)
    {
        window.Dispatcher.BeginInvoke(()=>{
            if(disposed||!displayed.TryGetValue(id,out var notice)||notice.UserId!=owner||enabledFor!=owner)return;
            if(window.WindowState==WindowState.Minimized)window.WindowState=WindowState.Normal;
            window.Activate();
            reply(new{type="open",id=notice.Id,userId=notice.UserId,url=notice.Url,companyId=notice.CompanyId});
        });
    }
    private void Clear(){displayed.Clear();if(registered)_=ClearSafely();}
    private async Task ClearSafely(){try{await sink.Clear();}catch(Exception){/* Logout still removes local click authorization. */}}
    public void Dispose(){if(disposed)return;disposed=true;generation++;Clear();sink.Clicked-=Invoked;try{sink.Dispose();}catch(Exception){}registered=false;}
}
