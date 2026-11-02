import Foundation

@main
struct NavigationPolicyTests {
    static func main() throws {
        let policy = NavigationPolicy()
        var count = 0
        func check(_ value: Bool, _ message: String) {
            precondition(value, message)
            count += 1
        }
        func url(_ value: String) -> URL { URL(string: value)! }

        let destinations: [(String, NavigationPolicy.Decision, NavigationPolicy.Decision)] = [
            ("https://connect.sunhubapp.com/", .internalNavigation, .internalNavigation),
            ("https://connect.sunhubapp.com/directory?location=Austin#companies", .internalNavigation, .internalNavigation),
            ("https://CONNECT.SUNHUBAPP.COM:443/messages", .internalNavigation, .internalNavigation),
            ("https://accounts.sunhubapp.com/login", .external, .internalNavigation),
            ("https://accounts.sunhubapp.com:443/authorize", .external, .internalNavigation),
            ("http://connect.sunhubapp.com/", .external, .external),
            ("https://connect.sunhubapp.com:444/", .external, .external),
            ("https://accounts.sunhubapp.com:444/", .external, .external),
            ("https://connect.sunhubapp.com.evil.test/", .external, .external),
            ("https://connect.sunhubapp.com./", .external, .external),
            ("https://evil.test/connect.sunhubapp.com", .external, .external),
            ("https://connect.sunhubapp.com@evil.test/", .blocked, .blocked),
            ("https://evil.test@connect.sunhubapp.com/", .blocked, .blocked),
            ("https://user:password@accounts.sunhubapp.com/", .blocked, .blocked),
            ("https://%63onnect.sunhubapp.com/", .blocked, .blocked),
            ("https://connect%2Esunhubapp.com/", .blocked, .blocked),
            ("https://connect.sunhubapp.com:0/", .blocked, .blocked),
            ("https://example.org/project", .external, .external),
            ("mailto:hello@example.org?subject=Connect", .external, .external),
            ("tel:+15551234567", .external, .external),
            ("mailto:", .blocked, .blocked),
            ("tel:", .blocked, .blocked),
            ("javascript:alert(1)", .blocked, .blocked),
            ("file:///etc/passwd", .blocked, .blocked),
            ("data:text/html,hello", .blocked, .blocked),
            ("connect://profile/solar", .blocked, .blocked),
            ("about:blank", .blocked, .blocked),
            ("blob:https://connect.sunhubapp.com/1234", .internalNavigation, .internalNavigation),
            ("blob:https://connect.sunhubapp.com:443/1234", .internalNavigation, .internalNavigation),
            ("blob:https://connect.sunhubapp.com:444/1234", .blocked, .blocked),
            ("blob:https://accounts.sunhubapp.com/1234", .blocked, .blocked),
            ("blob:https://connect.sunhubapp.com.evil.test/1234", .blocked, .blocked),
            ("blob:https://connect.sunhubapp.com@evil.test/1234", .blocked, .blocked),
            ("blob:https://%63onnect.sunhubapp.com/1234", .blocked, .blocked),
            ("blob:null/1234", .blocked, .blocked),
            ("blob:blob:https://connect.sunhubapp.com/1234", .blocked, .blocked),
            ("blob:https://connect.sunhubapp.com", .blocked, .blocked),
        ]
        for (value, main, auth) in destinations {
            check(policy.classify(url(value), inAuthenticationWindow: false) == main, "Main navigation: \(value)")
            check(policy.classify(url(value), inAuthenticationWindow: true) == auth, "Authentication navigation: \(value)")
        }
        for path in ["/", "/directory?type=Installer&search=solar+panels", "/company-name#portfolio", "/messages", "/account", "/posts/123?from=feed"] {
            let value = url("https://connect.sunhubapp.com" + path)
            check(policy.safeRestorationURL(value) == value, "Restore normal route: \(path)")
        }
        for path in [
            "/api/auth/sunhub/callback", "/api/auth", "/api/session", "/assets/connect-logo.png", "/uploads/photo",
            "/x/../api/auth/callback", "/%61pi/auth/callback", "/%2561pi/auth/callback", "/API/AUTH/callback", "/auth/reset",
            "/invite/private-bearer-token", "/join/company?invite=secret",
            "/?code=secret", "/?%63ode=secret", "/?%2563ode=secret", "/?State=secret", "/?sso_error=failed", "/?error=denied",
            "/?access_token=secret", "/?id_token=secret", "/?refreshToken=secret", "/?session=secret", "/?nonce=secret",
            "/?request=secret", "/?returnTo=%2F%3Fcode%3Dsecret", "/?sunhub_linked=1", "/#access_token=secret", "/#%61ccess_token%3Dsecret",
        ] {
            check(policy.safeRestorationURL(url("https://connect.sunhubapp.com" + path)) == nil, "Do not persist authentication: \(path)")
        }
        for value in ["https://accounts.sunhubapp.com/", "https://evil.test/", "https://user@connect.sunhubapp.com/", "http://connect.sunhubapp.com/", "https://connect.sunhubapp.com:444/", "blob:https://connect.sunhubapp.com/1234", "about:blank"] {
            check(policy.safeRestorationURL(url(value)) == nil, "Restore only a normal Connect page: \(value)")
        }
        let relative = URL(string: "/directory", relativeTo: policy.connectOrigin)!
        check(policy.classify(relative, inAuthenticationWindow: false) == .blocked, "Do not resolve an ambiguous relative navigation")
        check(policy.safeRestorationURL(relative) == nil, "Do not persist relative URLs")
        check(policy.classify(url("http://localhost:4100/"), inAuthenticationWindow: false) == .external, "Production never embeds loopback by default")

        #if DEBUG
        for loopback in ["localhost", "127.0.0.1", "[::1]"] {
            let local = try NavigationPolicy(testConnectOrigin: url("http://\(loopback):4100"), testSSOOrigin: url("http://\(loopback):8085/"))
            check(local.classify(url("http://\(loopback):4100/directory"), inAuthenticationWindow: false) == .internalNavigation, "DEBUG Connect loopback: \(loopback)")
            check(local.classify(url("http://\(loopback):8085/login"), inAuthenticationWindow: true) == .internalNavigation, "DEBUG SSO loopback: \(loopback)")
            check(local.classify(url("http://\(loopback):8085/login"), inAuthenticationWindow: false) == .external, "SSO remains isolated: \(loopback)")
            check(local.classify(url("http://\(loopback):4101/"), inAuthenticationWindow: true) == .external, "Exact DEBUG port: \(loopback)")
            check(local.safeRestorationURL(url("http://\(loopback):4100/directory")) != nil, "Restore DEBUG app route: \(loopback)")
        }
        for value in ["https://example.org", "http://localhost.evil.test:4100", "http://127.0.0.2:4100", "http://localhost.:4100", "http://user@localhost:4100", "http://%6Cocalhost:4100", "http://localhost:4100/path", "http://localhost:4100/?code=x", "http://localhost:4100/#hash", "file:///localhost"] {
            do {
                _ = try NavigationPolicy(testConnectOrigin: url(value), testSSOOrigin: url("http://localhost:8085"))
                preconditionFailure("Invalid DEBUG origin accepted: \(value)")
            } catch NavigationPolicy.ConfigurationError.invalidTestOrigin {
                count += 1
            }
        }
        do {
            _ = try NavigationPolicy(testConnectOrigin: url("http://localhost:4100"), testSSOOrigin: url("https://accounts.sunhubapp.com"))
            preconditionFailure("A remote DEBUG SSO origin must not be accepted")
        } catch NavigationPolicy.ConfigurationError.invalidTestOrigin {
            count += 1
        }
        print("NavigationPolicy DEBUG: \(count) checks passed")
        #else
        print("NavigationPolicy release: \(count) checks passed")
        #endif
    }
}
