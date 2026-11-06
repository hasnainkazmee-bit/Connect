using System.Diagnostics;
using System.Windows;

namespace Connect.Windows;
internal static class ExternalLinks
{
    public static void Open(Uri uri,Func<bool>? stillAllowed=null)
    {
        if(!uri.IsAbsoluteUri||uri.UserInfo.Length>0||uri.Scheme is not("http" or "https" or "mailto" or "tel"))return;
        Application.Current.Dispatcher.BeginInvoke(()=>{
            try
            {
                if(stillAllowed?.Invoke()==false){Trace.WriteLine("Connect external navigation: document changed before OS launch.");return;}
                Trace.WriteLine("Connect external navigation: attempting OS launch.");
                Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});
                Trace.WriteLine("Connect external navigation: OS launch dispatched.");
            }
            catch(Exception e)when(e is System.ComponentModel.Win32Exception or InvalidOperationException){Trace.WriteLine($"Connect external navigation: OS launch failed ({e.GetType().Name}).");MessageBox.Show("Windows could not open that link. Check your default browser or calling app.","Connect",MessageBoxButton.OK,MessageBoxImage.Information);}
        });
    }
}
