using System.Text.Json;

namespace Connect.Core;

/// <summary>Presentation state only; never use this state to authorize API operations.</summary>
public sealed record WorkspaceState(bool Ready, string Path, bool SignedIn, string AccountType,
    string UserName, string CompanyName, bool CanPublish, int UnreadCount)
{
    public static WorkspaceState Empty { get; } = new(false, "/", false, "", "", "", false, 0);
    public bool CanUseNetwork => AccountType != "individual";
    public bool CanCreatePost => Ready && SignedIn && CanUseNetwork && (CanPublish || CompanyName.Length == 0);

    public static bool TryParse(string json, out WorkspaceState state)
    {
        state = Empty;
        if (string.IsNullOrEmpty(json) || json.Length > 16_384) return false;
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 4 });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || Text(root, "type", 20) != "state" ||
                !Flag(root, "ready", out var ready) || !Flag(root, "signedIn", out var signedIn) ||
                !Flag(root, "canPublish", out var canPublish)) return false;
            var path = Text(root, "path", 2048);
            if (!path.StartsWith('/') || path.StartsWith("//", StringComparison.Ordinal) || path.Contains('\\') || path.Any(char.IsControl)) return false;
            var account = Text(root, "accountType", 30);
            var unread = root.TryGetProperty("unreadCount", out var number) && number.TryGetInt32(out var count)
                ? Math.Clamp(count, 0, 999) : 0;
            state = new(ready, path, signedIn, account,
                signedIn ? Text(root, "userName", 160) : "",
                signedIn ? Text(root, "companyName", 160) : "",
                ready && signedIn && account != "individual" && canPublish,
                signedIn ? unread : 0);
            return true;
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or FormatException) { return false; }
    }

    private static bool Flag(JsonElement element, string key, out bool value)
    {
        value = false;
        if (!element.TryGetProperty(key, out var field) || field.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = field.GetBoolean();
        return true;
    }

    private static string Text(JsonElement element, string key, int max)
    {
        if (!element.TryGetProperty(key, out var field) || field.ValueKind != JsonValueKind.String) return "";
        var text = field.GetString() ?? "";
        return text.Length <= max ? text : text[..max];
    }
}
