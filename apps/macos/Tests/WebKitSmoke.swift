import AppKit
import Foundation
import WebKit

private struct SmokeFailure: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

@MainActor
private final class SmokeNotificationDelivery: NativeNotificationDelivering {
    var onOpen: ((NativeNotification) -> Void)?
    var shouldPresent: ((NativeNotification) -> Bool)?
    var requests = 0
    func permission() async -> String { "default" }
    func requestPermission() async throws -> Bool { requests += 1; return false }
    func show(_ notice: NativeNotification) async throws {}
    func clear() {}
    func remove(_ id: String) {}
}

@MainActor
private final class SmokeRunner: NSObject, NSApplicationDelegate {
    private var controllers: [BrowserWindowController] = []
    private var checks = 0
    private let notificationDelivery = SmokeNotificationDelivery()

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            do {
                try await run()
                print("PASS: \(checks) native WebKit smoke checks")
                fflush(stdout)
                NSApplication.shared.terminate(nil)
            } catch {
                fputs("FAIL: \(error)\n", stderr)
                fflush(stderr)
                exit(1)
            }
        }
    }

    private func check(_ value: Bool, _ label: String) throws {
        guard value else { throw SmokeFailure(label) }
        checks += 1
        print("PASS: \(label)")
        fflush(stdout)
    }

    private func wait(_ label: String, timeout: TimeInterval = 15, until condition: @MainActor () async throws -> Bool) async throws {
        let end = Date().addingTimeInterval(timeout)
        while Date() < end {
            if try await condition() { return }
            try await Task.sleep(for: .milliseconds(80))
        }
        throw SmokeFailure("Timed out: \(label)")
    }

    private func js(_ view: WKWebView, _ source: String) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            view.evaluateJavaScript(source) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value as? String ?? String(describing: value ?? "")) }
            }
        }
    }

    private func pageReady(_ controller: BrowserWindowController, path: String) async throws {
        try await wait("page \(path)") {
            guard controller.webView.url?.path == path, !controller.webView.isLoading else { return false }
            return (try? await self.js(controller.webView, "document.readyState")) == "complete"
        }
    }

    private func newController(_ policy: NavigationPolicy, automaticPopups: Bool = false) -> BrowserWindowController {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // Only this local fixture bypasses gesture gating. Production leaves it false.
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = automaticPopups
        let controller = BrowserWindowController(policy: policy, configuration: configuration, notificationDelivery: notificationDelivery)
        controllers.append(controller)
        controller.showWindow(nil)
        return controller
    }

    private func allButtons(_ view: NSView) -> [NSButton] {
        (view as? NSButton).map { [$0] } ?? view.subviews.flatMap(allButtons)
    }

    private func sidebar(in view: NSView) -> MacSidebar? {
        if let sidebar = view as? MacSidebar { return sidebar }
        return view.subviews.lazy.compactMap { self.sidebar(in: $0) }.first
    }

    private func stayOnPage(_ controller: BrowserWindowController) async throws {
        try await wait("native beforeunload sheet") { controller.window?.attachedSheet != nil }
        guard let content = controller.window?.attachedSheet?.contentView,
              let stay = allButtons(content).first(where: { $0.title == "Stay" }) else {
            throw SmokeFailure("Stay button missing from native draft guard")
        }
        stay.performClick(nil)
        try await wait("native beforeunload sheet closes") { controller.window?.attachedSheet == nil }
    }

    private func run() async throws {
        guard CommandLine.arguments.count == 4,
              let connect = URL(string: CommandLine.arguments[1]),
              let sso = URL(string: CommandLine.arguments[2]) else { throw SmokeFailure("Pass Connect and SSO loopback origins.") }
        let policy = try NavigationPolicy(testConnectOrigin: connect, testSSOOrigin: sso)
        let main = newController(policy, automaticPopups: true)
        main.loadInitialURL(connect.appendingPathComponent("/"))
        try await pageReady(main, path: "/")
        try check(main.webView.configuration.websiteDataStore.isPersistent, "persistent WebKit website store")
        try check(try await js(main.webView, "document.querySelector('#page').textContent") == "Connect fixture", "initial local app loads")

        if CommandLine.arguments[3] == "persistence" {
            _ = try await js(main.webView, "window.cookieRestored = false; fetch('/api/session').then(r=>r.json()).then(s=>window.cookieRestored=s.signedIn); 'checking'")
            try await wait("session restored after quitting the previous process") {
                (try? await self.js(main.webView, "String(window.cookieRestored)")) == "true"
            }
            try check(true, "HttpOnly authenticated session survives application process exit")
            let store = main.webView.configuration.websiteDataStore.httpCookieStore
            let cookies = await store.allCookies()
            for cookie in cookies where cookie.name == "connect_mac_smoke" { await store.deleteCookie(cookie) }
            controllers.forEach { $0.window?.orderOut(nil) }
            return
        }

        try check(try await js(main.webView, "String(window.__CONNECT_DESKTOP_NOTIFICATIONS__)") == "true", "main frame advertises native notifications")
        try check(try await js(main.webView, "typeof window.webkit.messageHandlers.connectNotificationPermission") == "undefined", "page world cannot access isolated permission handler")
        let notificationRequest = UUID().uuidString.lowercased()
        _ = try await js(main.webView, """
            window.notificationEvents = [];
            window.addEventListener('connect:mac-notifications', event => notificationEvents.push(event.detail));
            window.webkit.messageHandlers.connectMac.postMessage({type:'notificationOwner',userId:'\(notificationRequest)'});
            window.dispatchEvent(new CustomEvent('connect:native-notification-permission',{detail:{requestId:'\(notificationRequest)'}}));
            'sent';
            """)
        try await wait("isolated permission rejects synthetic event") {
            (try? await self.js(main.webView, "String(notificationEvents.some(item=>item.requestId==='\(notificationRequest)' && item.error))")) == "true"
        }
        try check(notificationDelivery.requests == 0, "synthetic permission event never prompts macOS")
        _ = try await js(main.webView, """
            window.webkit.messageHandlers.connectMac.postMessage({type:'notificationPermission',requestId:'\(notificationRequest)',permitted:true});
            document.body.click();
            window.dispatchEvent(new CustomEvent('connect:native-notification-permission',{detail:{requestId:'\(notificationRequest)'}}));
            'forged';
            """)
        try await Task.sleep(for: .milliseconds(150))
        try check(notificationDelivery.requests == 0, "forged page message and synthetic click cannot acquire permission")
        guard let mainWindow = main.window else { throw SmokeFailure("Main window is missing") }
        let previousAppearance = ConnectAppearance.selectedChoice
        ConnectAppearance.setChoice(.light)
        _ = try await js(main.webView, "window.appearanceDraft = 'Keep this draft'; 'ready'")
        ConnectAppearance.setChoice(.dark)
        try await wait("native Dark appearance reaches WebKit") {
            (try? await self.js(main.webView, "String(matchMedia('(prefers-color-scheme: dark)').matches)")) == "true"
        }
        try check(try await js(main.webView, "appearanceDraft") == "Keep this draft",
                  "Dark appearance reaches web content without reloading or losing drafts")
        ConnectAppearance.setChoice(.light)
        try await wait("native Light appearance reaches WebKit") {
            (try? await self.js(main.webView, "String(matchMedia('(prefers-color-scheme: dark)').matches)")) == "false"
        }
        try check(true, "Light appearance restores the web color scheme")
        ConnectAppearance.setChoice(previousAppearance)
        let originalFrame = mainWindow.frame
        for size in [NSSize(width: 1180, height: 800), NSSize(width: 1920, height: 1080), NSSize(width: 720, height: 650)] {
            mainWindow.setFrame(NSRect(origin: originalFrame.origin, size: size), display: false)
            mainWindow.contentView?.layoutSubtreeIfNeeded()
            let contentFrame = main.webView.convert(main.webView.bounds, to: nil)
            try check(contentFrame.maxY <= mainWindow.contentLayoutRect.maxY + 1 && contentFrame.height > 400,
                      "workspace stays below native titlebar at \(Int(size.width))pt")
            guard let root = mainWindow.contentView, let navigation = sidebar(in: root) else {
                throw SmokeFailure("Native sidebar is missing")
            }
            let navigationFrame = navigation.convert(navigation.bounds, to: nil)
            try check(navigationFrame.maxY <= mainWindow.contentLayoutRect.maxY + 1 &&
                      navigationFrame.maxX <= contentFrame.minX + 1 && navigationFrame.width >= 212,
                      "sidebar stays below toolbar and beside content at \(Int(size.width))pt")
        }
        let sidebarVisibleWidth = main.webView.bounds.width
        main.toggleSidebar(nil)
        mainWindow.contentView?.layoutSubtreeIfNeeded()
        try check(main.webView.bounds.width > sidebarVisibleWidth + 180,
                  "hiding sidebar expands workspace without a reserved toolbar column")
        main.toggleSidebar(nil)
        try await Task.sleep(for: .milliseconds(250))
        mainWindow.contentView?.layoutSubtreeIfNeeded()
        try check(abs(main.webView.bounds.width - sidebarVisibleWidth) <= 1,
                  "restoring sidebar preserves its width")
        mainWindow.setFrame(originalFrame, display: false)
        mainWindow.contentView?.layoutSubtreeIfNeeded()
        try check(mainWindow.subtitle.isEmpty, "native workspace title stays on one line")

        guard let compose = mainWindow.toolbar?.items.first(where: { $0.itemIdentifier.rawValue == "compose" }) else {
            throw SmokeFailure("Native New post toolbar item is missing")
        }
        try check(!compose.isEnabled, "native New post starts disabled before workspace readiness")
        _ = try await js(main.webView, """
            window.nativeCommands = [];
            window.nativeDocumentMarker = 'same-document';
            window.addEventListener('connect:mac-command', event => nativeCommands.push(event.detail));
            window.webkit.messageHandlers.connectMac.postMessage({type:'state',ready:false,signedIn:false,canPublish:false});
            'loading';
            """)
        try await Task.sleep(for: .milliseconds(100))
        main.showNotifications(nil)
        try check(try await js(main.webView, "String(nativeCommands.length)") == "0", "early menu intent waits for session readiness")
        _ = try await js(main.webView, "window.webkit.messageHandlers.connectMac.postMessage({type:'state',ready:true,signedIn:false,canPublish:false}); 'ready'")
        try await wait("queued guest notification intent reaches ready workspace") {
            (try? await self.js(main.webView, "String(nativeCommands.length === 1 && nativeCommands[0].type === 'notifications')")) == "true"
        }
        try check(!compose.isEnabled && !main.canCreatePost, "guest New post remains disabled after loading")
        if #available(macOS 26.0, *) {
            try check(compose.style == .plain && compose.backgroundTintColor == nil,
                      "guest Create has no prominent orange treatment")
        }
        func toolbarButton(_ action: Selector) throws -> NSButton {
            guard let chrome = mainWindow.contentView?.superview,
                  let button = allButtons(chrome).first(where: { $0.action == action && ($0.target as? BrowserWindowController) === main }) else {
                throw SmokeFailure("Missing actual native toolbar control for \(action)")
            }
            return button
        }
        let composeButton = try toolbarButton(#selector(BrowserWindowController.compose(_:)))
        let notificationsButton = try toolbarButton(#selector(BrowserWindowController.showNotifications(_:)))
        try check(!composeButton.isEnabled && notificationsButton.isEnabled, "actual guest Create is disabled while Notifications remains actionable")
        composeButton.performClick(nil)
        main.compose(nil)
        try await Task.sleep(for: .milliseconds(100))
        try check(try await js(main.webView, "String(nativeCommands.length)") == "1", "disabled Create and direct shortcut dispatch no compose intent")
        notificationsButton.performClick(nil)
        try await wait("guest Notifications click") {
            (try? await self.js(main.webView, "nativeCommands.at(-1)?.type")) == "notifications"
        }
        try check(true, "guest Notifications reaches its sign-in intent")
        _ = try await js(main.webView, """
            window.webkit.messageHandlers.connectMac.postMessage({
              type:'state', ready:true, path:'/spoofed-route', signedIn:true, canPublish:true,
              userName:'Native smoke user', companyName:'Native Fixture Solar', unreadCount:3
            });
            'sent';
            """)
        try await wait("authenticated native compose state") { compose.isEnabled }
        try check(compose.isEnabled, "legitimate main-frame state enables native New post")
        try check(main.window?.title == "Home" && main.webView.url?.path == "/", "bridge presentation path cannot spoof the actual native route")
        main.navigate(to: "/directory")
        try await wait("native route command reaches existing document") {
            (try? await self.js(main.webView, "String(nativeCommands.at(-1)?.type === 'navigate' && nativeCommands.at(-1)?.path === '/directory')")) == "true"
        }
        try check(try await js(main.webView, "nativeDocumentMarker") == "same-document" && main.webView.url?.path == "/", "native navigation dispatches a router command without reloading the page")
        composeButton.performClick(nil)
        try await wait("native New post command") {
            (try? await self.js(main.webView, "nativeCommands.at(-1)?.type")) == "compose"
        }
        try check(true, "real signed-in toolbar New post dispatches the compose intent")
        notificationsButton.performClick(nil)
        try await wait("signed-in Notifications click") {
            (try? await self.js(main.webView, "nativeCommands.at(-1)?.type")) == "notifications"
        }
        try check(true, "real signed-in notification control dispatches its intent")

        _ = try await js(main.webView, "startAuth('hold'); 'started'")
        try await wait("bridge-isolation popup") { main.authenticationWindows.count == 1 }
        let untrustedSender = main.authenticationWindows[0]
        try await pageReady(untrustedSender, path: "/login")
        // Test the web-view identity check separately from the origin check:
        // a popup on the trusted Connect origin still cannot update main chrome.
        _ = try await js(untrustedSender.webView, "location.href='\(connect.appendingPathComponent("next").absoluteString)'; 'navigating'")
        try await pageReady(untrustedSender, path: "/next")
        try check(try await js(untrustedSender.webView, "typeof window.webkit?.messageHandlers?.connectMac?.postMessage") == "function", "popup inherits the WebKit message controller for the isolation test")
        try check(try await js(untrustedSender.webView, "String(window.__CONNECT_DESKTOP_NOTIFICATIONS__ === true)") == "false", "authentication popup does not advertise desktop notifications")
        _ = try await js(untrustedSender.webView, "window.webkit.messageHandlers.connectMac.postMessage({type:'state',signedIn:false,canPublish:false,userName:'Popup override',companyName:'',unreadCount:0}); 'sent'")
        for _ in 0..<5 {
            try await Task.sleep(for: .milliseconds(80))
            guard compose.isEnabled, NSApp.dockTile.badgeLabel == "3" else {
                throw SmokeFailure("Popup altered main-window account or notification state")
            }
        }
        try check(true, "trusted-origin popup state is ignored despite its inherited message handler")
        untrustedSender.window?.performClose(nil)
        try await wait("bridge-isolation popup closes") {
            guard main.authenticationWindows.isEmpty else { return false }
            return (try? await self.js(main.webView, "String(authPopup.closed)")) == "true"
        }
        _ = try await js(main.webView, "window.webkit.messageHandlers.connectMac.postMessage({type:'state',signedIn:false,canPublish:false,userName:'',companyName:'',unreadCount:0}); 'reset'")
        try await wait("native account state reset") { !compose.isEnabled && NSApp.dockTile.badgeLabel == nil }
        try check(true, "sign-out disables Create again and clears unread state")
        // Return to an unbridged fixture document before the existing full-page
        // navigation, authentication, history, and beforeunload scenarios.
        main.loadInitialURL(connect.appendingPathComponent("/"))
        try await pageReady(main, path: "/")

        _ = try await js(main.webView, "document.querySelector('#next').click(); 'clicked'")
        try await pageReady(main, path: "/next")
        try check(main.webView.canGoBack, "normal navigation enters native history")
        main.goBack(nil)
        try await pageReady(main, path: "/")
        try check(main.webView.canGoForward, "native Back restores page and Forward history")

        try check(try await js(main.webView, "String(startAuth('success'))") == "true", "window.open returns a real popup")
        try await wait("retained auth window") { main.authenticationWindows.count == 1 }
        let popup = main.authenticationWindows[0]
        try await pageReady(popup, path: "/login")
        try check(popup.webView.url?.host == sso.host, "popup navigates to the second origin")
        try check(try await js(popup.webView, "String(!!window.opener)") == "true", "popup preserves opener across origins")
        try check(popup.webView.configuration.websiteDataStore === main.webView.configuration.websiteDataStore, "popup shares the supplied persistent cookie store")
        _ = try await js(popup.webView, "document.querySelector('#continue').click(); 'continued'")
        try await wait("callback and authenticated session") {
            (try? await self.js(main.webView, "String(smoke.received && smoke.session)")) == "true"
        }
        try check(try await js(main.webView, "smoke.callbackOrigin") == connect.absoluteString, "callback postMessage has the expected origin")
        try check(try await js(main.webView, "String(document.cookie.includes('connect_mac_smoke'))") == "false", "HttpOnly session is not exposed to page JavaScript")
        try await wait("ready acknowledgment closes callback window") { main.authenticationWindows.isEmpty }
        try check(try await js(main.webView, "String(authPopup.closed)") == "true", "ready acknowledgment closes the DOM popup and native window")

        let second = newController(policy)
        second.loadInitialURL(connect.appendingPathComponent("/"))
        try await pageReady(second, path: "/")
        _ = try await js(second.webView, "window.cookieRestored = false; fetch('/api/session').then(r=>r.json()).then(s=>window.cookieRestored=s.signedIn); 'checking'")
        try await wait("shared session in recreated web view") {
            (try? await self.js(second.webView, "String(window.cookieRestored)")) == "true"
        }
        try check(true, "new main web view restores the persistent-store session")
        second.window?.orderOut(nil)

        _ = try await js(main.webView, "startAuth('hold'); 'started'")
        try await wait("cancelable popup") { main.authenticationWindows.count == 1 }
        let cancelled = main.authenticationWindows[0]
        try await pageReady(cancelled, path: "/login")
        cancelled.window?.performClose(nil)
        try await wait("native Cancel closes DOM popup") {
            guard main.authenticationWindows.isEmpty else { return false }
            return (try? await self.js(main.webView, "String(authPopup.closed)")) == "true"
        }
        try check(true, "native popup close updates window.closed for web cancellation")

        _ = try await js(main.webView, "document.querySelector('#draft').value='Unsaved local draft'; sessionStorage.setItem('smoke-draft','kept'); 'set'")
        let retainedView = main.webView
        main.window?.performClose(nil)
        try check(main.window?.isVisible == false, "closing main window hides it")
        main.showWindow(nil)
        try check(main.webView === retainedView, "reopening retains the existing web view")
        try check(try await js(main.webView, "document.querySelector('#draft').value + ':' + sessionStorage.getItem('smoke-draft')") == "Unsaved local draft:kept", "reopening preserves unsent DOM and sessionStorage draft")

        _ = try await js(main.webView, "window.smokeBeforeUnload = e=>e.preventDefault(); addEventListener('beforeunload', smokeBeforeUnload); 'guarded'")
        var leaveResult: Bool?
        main.confirmLeaving(action: "Leave this page") { leaveResult = $0 }
        try await stayOnPage(main)
        try await wait("Stay callback") { leaveResult != nil }
        try check(leaveResult == false, "beforeunload guard returns false when Stay is selected")

        _ = try await js(main.webView, "document.querySelector('#next').click(); 'clicked'")
        try await stayOnPage(main)
        try check(main.webView.url?.path == "/", "Stay cancels full-page link navigation")
        try check(try await js(main.webView, "document.querySelector('#draft').value") == "Unsaved local draft", "cancelled link navigation retains the draft")

        _ = try await js(main.webView, "const link=document.createElement('a'); link.href='/next'; link.target='_blank'; document.body.append(link); link.click(); 'clicked'")
        try await stayOnPage(main)
        try check(main.webView.url?.path == "/" && main.authenticationWindows.isEmpty, "Stay cancels same-origin target=_blank fallback without opening an auth window")
        _ = try await js(main.webView, "removeEventListener('beforeunload', smokeBeforeUnload); 'removed'")

        _ = try await js(main.webView, "document.querySelector('#next').click(); 'clicked'")
        try await pageReady(main, path: "/next")
        _ = try await js(main.webView, "window.smokeBeforeUnload = e=>e.preventDefault(); addEventListener('beforeunload', smokeBeforeUnload); 'guarded'")
        main.goBack(nil)
        try await stayOnPage(main)
        // WebKit may expose the tentative history URL until its cancellation settles.
        try await wait("native Back cancellation settles") {
            main.webView.url?.path == "/next" && main.webView.canGoBack && !main.webView.isLoading
        }
        try check(main.webView.url?.path == "/next" && main.webView.canGoBack, "Stay cancels native Back and keeps history intact")
        _ = try await js(main.webView, "removeEventListener('beforeunload', smokeBeforeUnload); 'removed'")
        main.goBack(nil)
        try await pageReady(main, path: "/")

        let recovery = newController(policy)
        recovery.loadInitialURL(connect.appendingPathComponent("network-failure"))
        try await wait("failed main navigation recovery") { recovery.isShowingRecovery }
        try check(true, "failed main navigation shows native recovery")
        let (_, response) = try await URLSession.shared.data(from: connect.appendingPathComponent("control/recover"))
        try check((response as? HTTPURLResponse)?.statusCode == 204, "local network fixture recovers")
        recovery.retryConnection(nil)
        try await pageReady(recovery, path: "/network-failure")
        try check(!recovery.isShowingRecovery, "Retry hides recovery after a successful page load")
        try check(try await js(recovery.webView, "document.querySelector('#page').textContent") == "Connection restored", "Retry loads the restored local endpoint")

        // The second process verifies this fixture's HttpOnly cookie, then deletes only it.
        _ = await main.webView.configuration.websiteDataStore.httpCookieStore.allCookies()
        controllers.forEach { $0.window?.orderOut(nil) }
        print("NOTE: Test-only automatic popup allowance; production user-gesture gating is not covered.")
    }
}

@main
private struct WebKitSmoke {
    @MainActor static func main() {
        let application = NSApplication.shared
        let delegate = SmokeRunner()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        withExtendedLifetime(delegate) { application.run() }
    }
}
