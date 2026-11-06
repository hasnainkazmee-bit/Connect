using System.Windows;

namespace Connect.Windows;

public sealed class App : Application
{
    [STAThread]
    public static void Main()
    {
        using var instance = new Mutex(true, @"Local\Sunhub.Connect.Windows", out var created);
        if (!created) { MessageBox.Show("Connect is already open. Switch to its window to continue.", "Connect", MessageBoxButton.OK, MessageBoxImage.Information); return; }
        var app = new App { ShutdownMode = ShutdownMode.OnMainWindowClose };
        var window = new MainWindow();
        app.MainWindow = window;
        app.Run(window);
    }
}
