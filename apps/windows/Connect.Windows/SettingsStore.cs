using System.IO;
using System.Text.Json;
using Connect.Core;

namespace Connect.Windows;

public enum AppearanceChoice { System, Light, Dark }
public sealed record WindowPreferences
{
    public AppearanceChoice Appearance { get; init; }
    public string? LastUrl { get; init; }
    public double Width { get; init; } = 1180;
    public double Height { get; init; } = 800;
    public double Zoom { get; init; } = 1;
}

internal sealed class SettingsStore(string path, NavigationPolicy policy)
{
    public static string ApplicationFolder => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Sunhub", "Connect");
    public WindowPreferences Load()
    {
        try
        {
            var value = JsonSerializer.Deserialize<WindowPreferences>(File.ReadAllText(path));
            if (value is null) return new();
            return value with {
                Appearance = Enum.IsDefined(value.Appearance) ? value.Appearance : AppearanceChoice.System,
                LastUrl = Uri.TryCreate(value.LastUrl, UriKind.Absolute, out var url) ? policy.SafeRestorationUrl(url)?.AbsoluteUri : null,
                Width = double.IsFinite(value.Width) ? Math.Clamp(value.Width,720,3840) : 1180,
                Height = double.IsFinite(value.Height) ? Math.Clamp(value.Height,580,2160) : 800,
                Zoom = double.IsFinite(value.Zoom) ? Math.Clamp(value.Zoom,0.7,1.8) : 1
            };
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { return new(); }
    }
    public void Save(WindowPreferences value)
    {
        try
        {
            var safeUrl = Uri.TryCreate(value.LastUrl, UriKind.Absolute, out var url) ? policy.SafeRestorationUrl(url)?.AbsoluteUri : null;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(value with {LastUrl=safeUrl}));
            File.Move(temporary,path,true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* Preferences never block account use. */ }
    }
}
