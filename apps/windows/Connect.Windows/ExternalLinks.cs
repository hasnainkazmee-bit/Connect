using System.Diagnostics;
using System.Windows;

namespace Connect.Windows;
internal static class ExternalLinks
{
    public static void Open(Uri uri,Func<bool>? stillAllowed=null)
    {
        if(!uri.IsAbsoluteUri||uri.UserInfo.Length>0||uri.Scheme is not("http" or "https" or "mailto" or "tel"))return;
        Application.Current.Dispatcher.BeginInvoke(()=>{
            try{if(stillAllowed?.Invoke()==false)return;Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});}
            catch(Exception e)when(e is System.ComponentModel.Win32Exception or InvalidOperationException){MessageBox.Show("Windows could not open that link. Check your default browser or calling app.","Connect",MessageBoxButton.OK,MessageBoxImage.Information);}
        });
    }
}
