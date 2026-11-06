using System.Text.Json;

namespace Connect.Core;

public static class DesktopCommands
{
    private static readonly HashSet<string> Paths = ["/", "/directory", "/network", "/network/connections", "/messages"];
    private static readonly HashSet<string> Types = ["state", "navigate", "compose", "account", "notifications", "profile"];
    public static bool IsAllowedPath(string path) => Paths.Contains(path);

    public static string ScriptFor(string type, string? path = null)
    {
        if (!Types.Contains(type) || (type == "navigate" && (path is null || !IsAllowedPath(path))))
            throw new ArgumentException("Unsupported native workspace command.");
        var detail = type == "navigate" ? new Dictionary<string, string> { ["type"] = type, ["path"] = path! }
            : new Dictionary<string, string> { ["type"] = type };
        return "window.dispatchEvent(new CustomEvent('connect:windows-command',{detail:" + JsonSerializer.Serialize(detail) + "}));";
    }
}
