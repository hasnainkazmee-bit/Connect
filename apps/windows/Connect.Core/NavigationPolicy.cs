namespace Connect.Core;

public enum NavigationDecision { Internal, External, Blocked }

/// <summary>Decides destinations without opening them. External navigation still requires a user gesture.</summary>
public sealed class NavigationPolicy
{
    public Uri ConnectOrigin { get; }
    public Uri SsoOrigin { get; }

    public NavigationPolicy() : this(new("https://connect.sunhubapp.com"), new("https://accounts.sunhubapp.com")) { }

    private NavigationPolicy(Uri connect, Uri sso)
    {
        ConnectOrigin = connect;
        SsoOrigin = sso;
    }

    // Tests use an isolated WebView profile. Production has no configurable remote origin.
    public static NavigationPolicy ForTesting(Uri connect, Uri sso)
    {
        if (!IsTestOrigin(connect) || !IsTestOrigin(sso))
            throw new ArgumentException("Test origins must be unambiguous loopback HTTP(S) origins.");
        return new(connect, sso);
    }

    public bool IsConnect(Uri uri) => SameOrigin(uri, ConnectOrigin);
    public bool IsSso(Uri uri) => SameOrigin(uri, SsoOrigin);

    public NavigationDecision Classify(Uri uri, bool inAuthenticationWindow = false)
    {
        if (!uri.IsAbsoluteUri || HasControls(uri.OriginalString)) return NavigationDecision.Blocked;
        if (uri.Scheme is "https" or "http")
        {
            if (!IsWebOrigin(uri)) return NavigationDecision.Blocked;
            return IsConnect(uri) || (inAuthenticationWindow && IsSso(uri))
                ? NavigationDecision.Internal : NavigationDecision.External;
        }
        if (uri.Scheme == "blob")
            return IsConnectBlob(uri) ? NavigationDecision.Internal : NavigationDecision.Blocked;
        if (uri.Scheme is "mailto" or "tel")
        {
            var value = uri.OriginalString[(uri.OriginalString.IndexOf(':') + 1)..];
            return value.Length > 0 && !value.StartsWith("//", StringComparison.Ordinal) &&
                !HasControls(Decode(value)) && !value.Contains('\\')
                ? NavigationDecision.External : NavigationDecision.Blocked;
        }
        return NavigationDecision.Blocked;
    }

    public bool IsSafeDownload(Uri uri) => IsConnect(uri) || IsConnectBlob(uri);

    public Uri? SafeRestorationUrl(Uri? uri)
    {
        if (uri is null || !IsConnect(uri)) return null;
        var path = NormalizePath(uri.AbsolutePath);
        string[] privateRoots = ["/api", "/assets", "/uploads", "/auth", "/invite", "/join"];
        if (privateRoots.Any(root => path == root || path.StartsWith(root + "/", StringComparison.Ordinal))) return null;
        foreach (var part in uri.Query.TrimStart('?').Split(['&', ';'], StringSplitOptions.RemoveEmptyEntries))
        {
            var key = Decode(part.Split('=', 2)[0]).Replace('+', ' ').ToLowerInvariant();
            if (key.Contains("token", StringComparison.Ordinal) || SensitiveQueryNames.Contains(key)) return null;
        }
        var fragment = Decode(uri.Fragment.TrimStart('#'));
        if (fragment.Contains('=') || fragment.Contains('?') || HasControls(fragment)) return null;
        return uri;
    }

    private bool IsConnectBlob(Uri uri)
    {
        if (!uri.IsAbsoluteUri || uri.Scheme != "blob" || HasControls(uri.OriginalString)) return false;
        return Uri.TryCreate(uri.OriginalString[5..], UriKind.Absolute, out var creator) &&
            IsConnect(creator) && creator.AbsolutePath.Length > 1;
    }

    private static bool SameOrigin(Uri uri, Uri origin) => IsWebOrigin(uri) &&
        uri.Scheme.Equals(origin.Scheme, StringComparison.OrdinalIgnoreCase) &&
        uri.IdnHost.Equals(origin.IdnHost, StringComparison.OrdinalIgnoreCase) && uri.Port == origin.Port;

    private static bool IsWebOrigin(Uri uri)
    {
        if (!uri.IsAbsoluteUri || uri.Scheme is not ("https" or "http") || string.IsNullOrEmpty(uri.Host) ||
            uri.UserInfo.Length > 0 || uri.Port is < 1 or > 65535 || HasControls(uri.OriginalString)) return false;
        var raw = uri.OriginalString;
        var separator = raw.IndexOf("://", StringComparison.Ordinal);
        if (separator < 0) return false;
        var authority = raw[(separator + 3)..].Split(['/', '?', '#'], 2)[0];
        return authority.Length > 0 && !authority.Any(c => c is '%' or '\\' or '@' || char.IsWhiteSpace(c));
    }

    private static bool IsTestOrigin(Uri uri) => IsWebOrigin(uri) &&
        (uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) || uri.Host is "127.0.0.1" or "[::1]" or "::1") &&
        uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0;

    private static string NormalizePath(string raw)
    {
        var parts = new List<string>();
        foreach (var part in Decode(raw).Replace('\\', '/').ToLowerInvariant().Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (part == "..") { if (parts.Count > 0) parts.RemoveAt(parts.Count - 1); }
            else if (part != ".") parts.Add(part);
        }
        return "/" + string.Join('/', parts);
    }

    private static string Decode(string value)
    {
        for (var i = 0; i < 3; i++)
        {
            var decoded = Uri.UnescapeDataString(value);
            if (decoded == value) break;
            value = decoded;
        }
        return value;
    }

    private static bool HasControls(string value) => value.Any(char.IsControl);
    private static readonly HashSet<string> SensitiveQueryNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "code", "state", "error", "sso_error", "sunhub_linked", "nonce", "code_verifier", "code_challenge",
        "authorization", "auth", "password", "secret", "session", "session_id", "ticket", "challenge",
        "challenge_id", "invite", "invitation", "request", "popup_id", "returnto", "return_to", "redirect",
        "redirect_uri", "redirect_url", "continue"
    };
}
