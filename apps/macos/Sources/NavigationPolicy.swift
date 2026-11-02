import Foundation

/// URL decisions only. The host app must require a user gesture before opening
/// an external destination, and alone controls initial about:blank popup creation.
struct NavigationPolicy: Sendable {
    enum Decision: Equatable, Sendable {
        case internalNavigation
        case external
        case blocked
    }

    let connectOrigin: URL
    let ssoOrigin: URL
    private let connect: Origin
    private let sso: Origin

    init() {
        connectOrigin = URL(string: "https://connect.sunhubapp.com")!
        ssoOrigin = URL(string: "https://accounts.sunhubapp.com")!
        connect = Origin(url: connectOrigin)!
        sso = Origin(url: ssoOrigin)!
    }

    #if DEBUG
    enum ConfigurationError: Error {
        case invalidTestOrigin
    }

    /// Development overrides cannot expose the embedded app to a remote origin.
    init(testConnectOrigin: URL, testSSOOrigin: URL) throws {
        guard let connect = Origin.testOrigin(testConnectOrigin),
              let sso = Origin.testOrigin(testSSOOrigin) else {
            throw ConfigurationError.invalidTestOrigin
        }
        connectOrigin = testConnectOrigin
        ssoOrigin = testSSOOrigin
        self.connect = connect
        self.sso = sso
    }
    #endif

    func classify(_ url: URL, inAuthenticationWindow: Bool) -> Decision {
        guard url.baseURL == nil, let scheme = url.scheme?.lowercased() else {
            return .blocked
        }
        switch scheme {
        case "http", "https":
            guard let destination = Origin(url: url) else { return .blocked }
            if destination == connect || (inAuthenticationWindow && destination == sso) {
                return .internalNavigation
            }
            return .external
        case "blob":
            // A blob URL carries its creator's origin; never trust a substring
            // match, an opaque/null creator, or an SSO-created blob.
            let value = String(url.absoluteString.dropFirst(5))
            guard let creatorURL = URL(string: value),
                  Origin(url: creatorURL) == connect,
                  creatorURL.path.count > 1 else { return .blocked }
            return .internalNavigation
        case "mailto", "tel":
            guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  parts.host == nil, parts.user == nil, parts.password == nil,
                  !parts.path.isEmpty else { return .blocked }
            return .external
        default:
            return .blocked
        }
    }

    /// Keep ordinary application routes only. Authentication credentials and
    /// one-use invitation URLs must never enter restoration preferences.
    func safeRestorationURL(_ url: URL) -> URL? {
        guard url.baseURL == nil, Origin(url: url) == connect,
              let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let path = Self.normalizedPath(parts.percentEncodedPath)
        let privateRoots = ["/api", "/assets", "/uploads", "/auth", "/invite", "/join"]
        guard !privateRoots.contains(where: { path == $0 || path.hasPrefix($0 + "/") }) else {
            return nil
        }
        for item in parts.queryItems ?? [] {
            let name = Self.decoded(item.name).lowercased()
            if name.contains("token") || Self.sensitiveQueryNames.contains(name) {
                return nil
            }
        }
        if let fragment = parts.percentEncodedFragment {
            let value = Self.decoded(fragment)
            // Normal section anchors survive; OAuth-style fragment parameters do not.
            if value.contains("=") || value.contains("?") { return nil }
        }
        return url
    }

    private static let sensitiveQueryNames: Set<String> = [
        "code", "state", "error", "sso_error", "sunhub_linked", "nonce",
        "code_verifier", "code_challenge", "authorization", "auth", "password",
        "secret", "session", "session_id", "ticket", "challenge", "challenge_id",
        "invite", "invitation", "request", "popup_id", "returnto", "return_to",
        "redirect", "redirect_uri", "redirect_url", "continue",
    ]

    private static func decoded(_ value: String) -> String {
        var result = value
        for _ in 0..<3 {
            guard let next = result.removingPercentEncoding, next != result else { break }
            result = next
        }
        return result
    }

    private static func normalizedPath(_ value: String) -> String {
        let decodedPath = decoded(value).replacingOccurrences(of: "\\", with: "/")
        var segments: [Substring] = []
        for segment in decodedPath.lowercased().split(separator: "/") {
            if segment == ".." {
                if !segments.isEmpty { segments.removeLast() }
            } else if segment != "." {
                segments.append(segment)
            }
        }
        return "/" + segments.joined(separator: "/")
    }

    private struct Origin: Equatable, Sendable {
        let scheme: String
        let host: String
        let port: Int

        init?(url: URL) {
            guard url.baseURL == nil,
                  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let scheme = parts.scheme?.lowercased(),
                  ["https", "http"].contains(scheme),
                  let host = parts.host?.lowercased(), !host.isEmpty,
                  parts.user == nil, parts.password == nil,
                  let separator = url.absoluteString.range(of: "://") else { return nil }
            let authority = url.absoluteString[separator.upperBound...]
                .prefix { $0 != "/" && $0 != "?" && $0 != "#" }
            // Foundation decodes percent-encoded hosts; WebKit can normalize
            // them differently. Only an unambiguous authority is eligible.
            guard !authority.contains("%"), !authority.contains("\\"),
                  !authority.contains("@") else { return nil }
            let port = parts.port ?? (scheme == "https" ? 443 : 80)
            guard (1...65535).contains(port) else { return nil }
            self.scheme = scheme
            self.host = host
            self.port = port
        }

        #if DEBUG
        static func testOrigin(_ url: URL) -> Origin? {
            guard let origin = Origin(url: url),
                  ["localhost", "127.0.0.1", "[::1]", "::1"].contains(origin.host),
                  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  ["", "/"].contains(parts.path), parts.query == nil, parts.fragment == nil else {
                return nil
            }
            return origin
        }
        #endif
    }
}
