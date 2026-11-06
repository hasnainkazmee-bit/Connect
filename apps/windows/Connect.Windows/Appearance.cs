using System.Windows;
using System.Windows.Media;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;

namespace Connect.Windows;

internal static class Appearance
{
    public static bool IsDark(AppearanceChoice choice)
    {
        if (SystemParameters.HighContrast) { var c=SystemColors.WindowColor; return c.R*299+c.G*587+c.B*114<128000; }
        if (choice != AppearanceChoice.System) return choice == AppearanceChoice.Dark;
        try { return Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is int value && value == 0; }
        catch { return false; }
    }
    public static void Apply(Window window, AppearanceChoice choice, CoreWebView2? core = null)
    {
#pragma warning disable WPF0001 // Official Fluent ThemeMode is experimental in WPF .NET10.
        window.ThemeMode = choice switch { AppearanceChoice.Light => ThemeMode.Light, AppearanceChoice.Dark => ThemeMode.Dark, _ => ThemeMode.System };
#pragma warning restore WPF0001
        var dark = IsDark(choice);
        void Set(string key,string value) => window.Resources[key] = new SolidColorBrush((Color)ColorConverter.ConvertFromString(value));
        Set("Canvas",dark?"#1C2D3A":"#F2F7FC");
        Set("Surface",dark?"#203342":"#FFFFFF");
        Set("Chrome",dark?"#1C2D3A":"#EDF4FA");
        Set("Ink",dark?"#F2F7FC":"#203342");
        Set("Secondary",dark?"#DBE5ED":"#586D7F");
        Set("Line",dark?"#40515D":"#DBE5ED");
        Set("Selection",dark?"#4B372C":"#FFF0E2");
        Set("SelectionInk",dark?"#F2F7FC":"#974100");
        Set("Accent","#FF6B0B");
        Set("OnAccent","#1C2D3A");
        if(SystemParameters.HighContrast)
        {
            foreach(var key in new[]{"Canvas","Surface","Chrome"})window.Resources[key]=SystemColors.WindowBrush;
            foreach(var key in new[]{"Ink","Secondary"})window.Resources[key]=SystemColors.WindowTextBrush;
            window.Resources["Line"]=SystemColors.WindowTextBrush;
            window.Resources["Selection"]=SystemColors.HighlightBrush;
            window.Resources["SelectionInk"]=SystemColors.HighlightTextBrush;
            window.Resources["Accent"]=SystemColors.HighlightBrush;
            window.Resources["OnAccent"]=SystemColors.HighlightTextBrush;
        }
        if(core is not null) core.Profile.PreferredColorScheme=choice switch {AppearanceChoice.Light=>CoreWebView2PreferredColorScheme.Light,AppearanceChoice.Dark=>CoreWebView2PreferredColorScheme.Dark,_=>CoreWebView2PreferredColorScheme.Auto};
    }
}
