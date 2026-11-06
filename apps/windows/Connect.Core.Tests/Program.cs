using Connect.Core;
using System.Text.Json;

var checks = 0;
void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
    checks++;
}
var policy = new NavigationPolicy();
foreach (var path in new[] { "/", "/directory", "/messages/123", "/api/auth/sunhub/callback?code=one-use" })
    Check(policy.Classify(new("https://connect.sunhubapp.com" + path)) == NavigationDecision.Internal, "Connect origin allowed: " + path);
Check(policy.Classify(new("https://accounts.sunhubapp.com/login")) == NavigationDecision.External, "SSO not main navigation");
Check(policy.Classify(new("https://accounts.sunhubapp.com/login"), true) == NavigationDecision.Internal, "SSO allowed in popup");
foreach (var value in new[] { "https://connect.sunhubapp.com.evil.test/", "https://evil.test/connect.sunhubapp.com", "https://connect.sunhubapp.com:444/", "http://connect.sunhubapp.com/", "https://sunhubapp.com/" })
{
    Check(policy.Classify(new(value)) == NavigationDecision.External, "External origin: " + value);
    Check(!policy.IsSafeDownload(new(value)), "External download denied");
}
foreach (var value in new[] { "file:///C:/Windows/System32/cmd.exe", "javascript:alert(1)", "data:text/html,Hello", "ms-settings:privacy", "blob:null/123", "blob:https://evil.test/123", "https://user@connect.sunhubapp.com/", "https://connect%2esunhubapp.com/", "mailto:x@example.com%0d%0aBcc:y@example.com" })
{
    if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) { checks++; continue; }
    Check(policy.Classify(uri) == NavigationDecision.Blocked, "Untrusted destination rejected: " + value);
}
Check(policy.IsSafeDownload(new("blob:https://connect.sunhubapp.com/123")), "Connect blob downloadable");
Check(!policy.IsSafeDownload(new("blob:https://accounts.sunhubapp.com/123")), "SSO blob rejected");
Check(policy.Classify(new("mailto:hello@example.com")) == NavigationDecision.External, "Email link");
Check(policy.Classify(new("tel:+12025550123")) == NavigationDecision.External, "Phone link");
Check(policy.Classify(new("/directory", UriKind.Relative)) == NavigationDecision.Blocked, "Relative destination rejected");
foreach (var path in new[] { "/directory?type=Installer", "/network/connections", "/sunhub-company?tab=updates#projects" })
    Check(policy.SafeRestorationUrl(new("https://connect.sunhubapp.com" + path)) != null, "Restore ordinary route");
foreach (var path in new[] { "/api/session", "/AUTH/login", "/invite/words", "/join/team", "/%2561pi/session", "/safe/%2e%2e/auth/reset", "/?token=a", "/?access_token=a", "/?%2563ode=a", "/?x=1;state=secret", "/?redirect_uri=https://example.com", "/#access_token=a" })
    Check(policy.SafeRestorationUrl(new("https://connect.sunhubapp.com" + path)) == null, "Private URL never restored: " + path);
Check(policy.SafeRestorationUrl(new("https://evil.test/directory")) == null, "External URL never restored");
var testPolicy = NavigationPolicy.ForTesting(new("http://127.0.0.1:4189"), new("http://localhost:4190"));
Check(testPolicy.IsConnect(new("http://127.0.0.1:4189/path")), "Loopback fixture origin");
try { NavigationPolicy.ForTesting(new("https://example.com"), new("http://localhost:4190")); throw new Exception("Remote test origin accepted"); }
catch (ArgumentException) { checks++; }
string State(bool signedIn, bool canPublish, string account = "company", string company = "Sunhub", bool ready = true) =>
    JsonSerializer.Serialize(new { type = "state", ready, path = "/messages", signedIn, accountType = account, userName = "Team Member", companyName = company, canPublish, unreadCount = 2000 });
Check(WorkspaceState.TryParse(State(false, true), out var guest) && !guest.CanCreatePost && !guest.CanPublish && guest.CompanyName == "" && guest.UnreadCount == 0, "Guest cannot create, personal display state cleared");
Check(WorkspaceState.TryParse(State(true, true), out var owner) && owner.CanCreatePost && owner.UnreadCount == 999, "Company publisher can create; counts bounded");
Check(WorkspaceState.TryParse(State(true, true, "individual"), out var individual) && !individual.CanCreatePost && !individual.CanUseNetwork, "Individual publishing disabled");
Check(WorkspaceState.TryParse(State(true, false), out var employee) && !employee.CanCreatePost, "Unprivileged employee cannot publish");
Check(WorkspaceState.TryParse(State(true, false, company: ""), out var onboarding) && onboarding.CanCreatePost, "Company account onboarding remains reachable");
Check(WorkspaceState.TryParse(State(true, true, ready: false), out var loading) && !loading.CanCreatePost, "Publishing disabled while loading");
foreach (var value in new[] { "null", "[]", "{}", "{\"type\":\"state\",\"signedIn\":\"true\"}", new string('x', 16_385), State(true, true).Replace("/messages", "//evil.test"), State(true, true).Replace("2000", "\"many\"") })
    Check(!WorkspaceState.TryParse(value, out _), "Malformed native state rejected");
Check(DesktopCommands.ScriptFor("navigate", "/messages").Contains("connect:windows-command"), "Explicit Windows bridge");
foreach (var path in new[] { "https://evil.test/", "//evil.test", "/api/session", "/auth/login", "');alert(1)//" })
{
    Check(!DesktopCommands.IsAllowedPath(path), "Unsupported native route");
    try { DesktopCommands.ScriptFor("navigate", path); throw new Exception("Invalid command escaped allowlist"); }
    catch (ArgumentException) { checks++; }
}
try { DesktopCommands.ScriptFor("eval"); throw new Exception("Unknown native command accepted"); }
catch (ArgumentException) { checks++; }
Console.WriteLine($"PASS: {checks} Windows navigation, restoration, state and command checks");
