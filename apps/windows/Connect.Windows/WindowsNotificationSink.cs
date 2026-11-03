using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
namespace Connect.Windows;
internal interface INotificationSink : IDisposable
{
    event Action<string>? Clicked;
    bool Supported { get; }
    bool Enabled { get; }
    void Register();
    bool Show(string id,string title,string body);
    Task Clear();
}
internal sealed class WindowsNotificationSink : INotificationSink
{
    public event Action<string>? Clicked;
    public bool Supported => AppNotificationManager.IsSupported();
    public bool Enabled => AppNotificationManager.Default.Setting==AppNotificationSetting.Enabled;
    private bool registered;
    public void Register()
    {
        if(registered)return;
        AppNotificationManager.Default.NotificationInvoked+=Invoked;
        try{AppNotificationManager.Default.Register();registered=true;}
        catch{AppNotificationManager.Default.NotificationInvoked-=Invoked;throw;}
    }
    public bool Show(string id,string title,string body)
    {
        var notification=new AppNotificationBuilder().AddArgument("id",id).AddText(title).AddText(body).BuildNotification();
        notification.Tag=id;notification.Group="connect";notification.Expiration=DateTimeOffset.Now.AddDays(1);
        AppNotificationManager.Default.Show(notification);return notification.Id!=0;
    }
    public async Task Clear(){if(registered)await AppNotificationManager.Default.RemoveAllAsync();}
    private void Invoked(AppNotificationManager sender,AppNotificationActivatedEventArgs args){if(args.Arguments.TryGetValue("id",out var id))Clicked?.Invoke(id);}
    public void Dispose(){if(!registered)return;AppNotificationManager.Default.NotificationInvoked-=Invoked;AppNotificationManager.Default.Unregister();registered=false;}
}
