import AppKit
import WebKit

@MainActor
final class BrowserWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, NSToolbarDelegate {
    let webView: WKWebView
    let policy: NavigationPolicy
    let authentication: Bool
    private(set) var authenticationWindows: [BrowserWindowController] = []
    var onClosed: (() -> Void)?
    var isShowingRecovery: Bool { !recovery.isHidden }
    private(set) var canUseNetwork = true
    private var forceClose = false
    private var initialURL: URL?
    private var observations: [NSKeyValueObservation] = []
    private let progress = NSProgressIndicator()
    private let recovery = RecoverySurface()
    private let recoveryTitle = NSTextField(labelWithString: "Connect is taking a moment")
    private let recoveryBody = NSTextField(wrappingLabelWithString: "Check your connection, then try again. Your account hasn’t been signed out.")
    private let sidebar = MacSidebar()
    private let splitController = NSSplitViewController()
    private var splitView: NSSplitView { splitController.splitView }
    private var sidebarItem: NSSplitViewItem?
    private let workspace = NSView()
    private var workspaceReady = false
    private var workspaceSignedIn = false
    private var workspaceCanPublish = false
    private var workspaceHasCompany = false
    var canCreatePost: Bool {
        workspaceReady && workspaceSignedIn && (workspaceCanPublish || (!workspaceHasCompany && canUseNetwork))
    }
    private var pendingCommand: [String: String]?
    private var bridge: MacWorkspaceBridge?
    private let nativeSelects = NativeSelectCoordinator()
    private var nativeNotifications: NativeNotificationCoordinator?
    private var notificationPermissionBridge: MacNotificationPermissionBridge?
#if DEBUG
    var activeNativeSelectMenu: NSMenu? { nativeSelects.activeMenu }
#endif
    private var composeItem: NSToolbarItem?
    private var backItem: NSToolbarItem?
    private var notificationItem: NSToolbarItem?
    private var downloads: DownloadCoordinator!
    private let findBar = NSStackView()
    private let searchField = NSSearchField()
    private let findStatus = NSTextField(labelWithString: "")
    private var findHeight: NSLayoutConstraint!

    init(policy: NavigationPolicy = NavigationPolicy(), configuration: WKWebViewConfiguration? = nil, authentication: Bool = false, notificationDelivery: NativeNotificationDelivering? = nil) {
        self.policy = policy
        self.authentication = authentication
        // A popup MUST retain WebKit's supplied configuration to preserve opener,
        // process pool, and the first-party session. Never copy tokens into Swift.
        let settings = configuration ?? WKWebViewConfiguration()
        if configuration == nil {
            settings.websiteDataStore = .default()
            settings.preferences.javaScriptCanOpenWindowsAutomatically = false
            let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1"
            settings.applicationNameForUserAgent = "ConnectMac/\(version)"
        }
        webView = WKWebView(frame: .zero, configuration: settings)
        webView.allowsBackForwardNavigationGestures = true
        webView.underPageBackgroundColor = ConnectAppearance.windowBackground
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: authentication ? 500 : 1180, height: authentication ? 680 : 800),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = authentication ? "Sunhub Account" : "Connect"
        window.subtitle = authentication ? (policy.ssoOrigin.host ?? "") : ""
        window.minSize = authentication ? NSSize(width: 390, height: 560) : NSSize(width: 720, height: 580)
        window.isReleasedWhenClosed = false
        window.backgroundColor = ConnectAppearance.windowBackground
        window.tabbingMode = .disallowed
        if !authentication {
            window.toolbarStyle = .unified
            window.titlebarSeparatorStyle = .none
            // The selected sidebar row supplies the workspace name. Hiding
            // the duplicate title keeps native controls aligned to each pane.
            window.titleVisibility = .hidden
        }
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if !authentication {
            let bridge = MacWorkspaceBridge(owner: self)
            self.bridge = bridge
            settings.userContentController.add(bridge, name: "connectMac")
            let notifications = NativeNotificationCoordinator(delivery: notificationDelivery ?? SystemNotificationDelivery())
            nativeNotifications = notifications
            notifications.onEvent = { [weak self] payload in self?.sendNotificationEvent(payload) }
            notifications.onActivate = { [weak self] in
                self?.window?.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
            let permissionBridge = MacNotificationPermissionBridge(owner: self)
            notificationPermissionBridge = permissionBridge
            let permissionWorld = WKContentWorld.world(name: "ConnectNotificationPermission")
            settings.userContentController.add(permissionBridge, contentWorld: permissionWorld, name: "connectNotificationPermission")
            settings.userContentController.addUserScript(WKUserScript(
                source: NativeNotificationCoordinator.permissionScript,
                injectionTime: .atDocumentStart, forMainFrameOnly: true, in: permissionWorld
            ))
            settings.userContentController.addUserScript(WKUserScript(
                source: NativeNotificationCoordinator.capabilityScript,
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
            settings.userContentController.addUserScript(WKUserScript(
                source: NativeSelectCoordinator.capabilityScript,
                injectionTime: .atDocumentStart, forMainFrameOnly: true
            ))
        }
        downloads = DownloadCoordinator(window: window, policy: policy)
        configureContent()
        if !authentication {
            let toolbar = NSToolbar(identifier: "ConnectToolbar")
            toolbar.delegate = self
            toolbar.displayMode = .iconOnly
            toolbar.allowsUserCustomization = false
            window.toolbar = toolbar
            // A full-size content window lets the sidebar's glass continue
            // behind the toolbar. Keep both panes strictly below native chrome.
            window.styleMask.remove(.fullSizeContentView)
            if !window.setFrameUsingName("ConnectMainWindow") { window.center() }
            window.setFrameAutosaveName("ConnectMainWindow")
            webView.pageZoom = min(1.8, max(0.7, UserDefaults.standard.double(forKey: "pageZoom").nonzero ?? 1))
        }
        observations = [
            webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.updateNavigation() } },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.updateNavigation() } },
            webView.observe(\.url, options: [.new]) { [weak self] _, _ in Task { @MainActor in self?.recordLocation() } },
        ]
    }

    required init?(coder: NSCoder) { fatalError("Use init(policy:configuration:authentication:)") }

    func loadInitialURL(_ url: URL) {
        guard policy.classify(url, inAuthenticationWindow: authentication) == .internalNavigation else { return }
        initialURL = url
        recovery.isHidden = true
        webView.load(URLRequest(url: url))
    }

    private func configureContent() {
        guard let root = window?.contentView else { return }
        let container: NSView
        if authentication { container = root }
        else {
            splitView.isVertical = true
            splitView.dividerStyle = .thin
            let navigationController = NSViewController()
            navigationController.view = sidebar
            let navigationItem = NSSplitViewItem(sidebarWithViewController: navigationController)
            navigationItem.minimumThickness = 212
            navigationItem.maximumThickness = 260
            navigationItem.allowsFullHeightLayout = false
            navigationItem.canCollapseFromWindowResize = false
            navigationItem.holdingPriority = .defaultHigh
            navigationItem.collapseBehavior = .preferResizingSiblingsWithFixedSplitView
            navigationItem.titlebarSeparatorStyle = .none
            sidebarItem = navigationItem
            let contentController = NSViewController()
            contentController.view = workspace
            let contentItem = NSSplitViewItem(viewController: contentController)
            contentItem.minimumThickness = 480
            contentItem.titlebarSeparatorStyle = .none
            if #available(macOS 26.0, *) {
                // Both panes own their space; web content must never extend
                // beneath a floating sidebar or rely on a DOM safe-area inset.
                contentItem.automaticallyAdjustsSafeAreaInsets = false
            }
            splitController.addSplitViewItem(navigationItem)
            splitController.addSplitViewItem(contentItem)
            let preferredWidth = sidebar.widthAnchor.constraint(equalToConstant: 224)
            preferredWidth.priority = .defaultLow
            preferredWidth.isActive = true
            // AppKit supplies its current sidebar glass and owns resizing and
            // collapse restoration. A custom visual-effect fill masks it.
            splitController.view.frame = root.bounds
            window?.contentViewController = splitController
            sidebar.onNavigate = { [weak self] path in self?.navigate(to: path) }
            sidebar.onCompose = { [weak self] in self?.compose(nil) }
            sidebar.onAccount = { [weak self] in self?.sendWorkspaceCommand(["type": "account"]) }
            container = workspace
        }
        for view in [webView, recovery, findBar] {
            view.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(view)
        }
        findBar.orientation = .horizontal
        findBar.alignment = .centerY
        findBar.spacing = 10
        findBar.edgeInsets = NSEdgeInsets(top: 4, left: 14, bottom: 4, right: 14)
        searchField.placeholderString = "Find on this page"
        searchField.target = self
        searchField.action = #selector(findNext)
        searchField.sendsSearchStringImmediately = false
        searchField.widthAnchor.constraint(equalToConstant: 260).isActive = true
        findStatus.textColor = ConnectAppearance.secondaryText
        findStatus.font = .systemFont(ofSize: 12)
        let next = NSButton(title: "Next", target: self, action: #selector(findNext))
        next.bezelStyle = .rounded
        let done = NSButton(title: "Done", target: self, action: #selector(hideFind))
        done.bezelStyle = .rounded
        [searchField, next, findStatus, NSView(), done].forEach(findBar.addArrangedSubview)
        findHeight = findBar.heightAnchor.constraint(equalToConstant: 0)
        findBar.isHidden = true
        NSLayoutConstraint.activate([
            findBar.leadingAnchor.constraint(equalTo: container.leadingAnchor), findBar.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            // The split panes extend beneath native window chrome, but their
            // interactive content starts below it, including after resizing.
            findBar.topAnchor.constraint(equalTo: container.safeAreaLayoutGuide.topAnchor), findHeight,
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor), webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: findBar.bottomAnchor), webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            recovery.leadingAnchor.constraint(equalTo: webView.leadingAnchor), recovery.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            recovery.topAnchor.constraint(equalTo: webView.topAnchor), recovery.bottomAnchor.constraint(equalTo: webView.bottomAnchor),
        ])
        recovery.wantsLayer = true
        recovery.isHidden = true
        let emblem = NSImageView(image: NSImage(named: NSImage.applicationIconName) ?? NSImage())
        emblem.imageScaling = .scaleProportionallyUpOrDown
        emblem.widthAnchor.constraint(equalToConstant: 68).isActive = true
        emblem.heightAnchor.constraint(equalToConstant: 68).isActive = true
        recoveryTitle.font = .systemFont(ofSize: 23, weight: .semibold)
        recoveryTitle.alignment = .center
        recoveryBody.font = .systemFont(ofSize: 14)
        recoveryTitle.textColor = ConnectAppearance.text
        recoveryBody.textColor = ConnectAppearance.secondaryText
        recoveryBody.alignment = .center
        recoveryBody.maximumNumberOfLines = 4
        let retry = NSButton(title: authentication ? "Close sign-in" : "Try again", target: self, action: #selector(retryConnection))
        retry.bezelStyle = .rounded
        retry.controlSize = .large
        retry.bezelColor = ConnectAppearance.accent
        let stack = NSStackView(views: [emblem, recoveryTitle, recoveryBody, retry])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        recovery.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: recovery.centerXAnchor), stack.centerYAnchor.constraint(equalTo: recovery.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualTo: recovery.widthAnchor, constant: -48),
            recoveryBody.widthAnchor.constraint(lessThanOrEqualToConstant: 380),
        ])
    }

    func toolbarAllowedItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] { toolbarDefaultItemIdentifiers(toolbar) }
    func toolbarDefaultItemIdentifiers(_ toolbar: NSToolbar) -> [NSToolbarItem.Identifier] {
        [.init("sidebar"), .init("sidebarSeparator"), .init("back"), .flexibleSpace, .init("loading"), .init("notifications"), .init("compose")]
    }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        if identifier.rawValue == "sidebarSeparator" {
            return NSTrackingSeparatorToolbarItem(identifier: identifier, splitView: splitView, dividerIndex: 0)
        }
        let item = NSToolbarItem(itemIdentifier: identifier)
        item.isBordered = identifier.rawValue != "loading"
        switch identifier.rawValue {
        case "back":
            item.label = "Back"
            item.toolTip = "Back (⌘[)"
            item.image = NSImage(systemSymbolName: "chevron.left", accessibilityDescription: "Back")
            item.target = self
            item.action = #selector(goBack)
            item.autovalidates = false
            item.isEnabled = webView.canGoBack
            backItem = item
        case "sidebar":
            item.label = "Toggle Sidebar"
            item.toolTip = "Show or hide sidebar (⌃⌘S)"
            item.image = NSImage(systemSymbolName: "sidebar.left", accessibilityDescription: item.label)
            item.target = self
            item.action = #selector(toggleSidebar)
            item.isNavigational = true
        case "compose":
            item.label = "New Post"
            item.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: "New post")
            item.toolTip = "Create a post or press release (⌘N)"
            item.target = self
            item.action = #selector(compose)
            item.autovalidates = false
            item.isEnabled = false
            composeItem = item
        case "notifications":
            item.label = "Notifications"
            item.toolTip = "Notifications"
            item.image = NSImage(systemSymbolName: "bell", accessibilityDescription: "Notifications")
            item.target = self
            item.action = #selector(showNotifications)
            item.autovalidates = false
            item.isEnabled = false
            notificationItem = item
        case "loading":
            progress.style = .spinning
            progress.controlSize = .small
            progress.isDisplayedWhenStopped = false
            progress.setFrameSize(NSSize(width: 16, height: 16))
            progress.setAccessibilityLabel("Loading Connect")
            item.view = progress
            item.label = "Loading"
        default: return nil
        }
        updateWorkspaceActions()
        return item
    }

    private func updateNavigation() {
        backItem?.isEnabled = webView.canGoBack
        if webView.isLoading { progress.startAnimation(nil) } else { progress.stopAnimation(nil) }
    }

    private func updateWorkspaceActions() {
        let canCreate = canCreatePost
        composeItem?.isEnabled = canCreate
        notificationItem?.isEnabled = workspaceReady
        composeItem?.toolTip = !workspaceSignedIn
            ? "Sign in from the sidebar to create a post"
            : (canCreate ? "Create a post or press release (⌘N)" : "Publishing is managed by company owners and administrators")
        notificationItem?.toolTip = workspaceSignedIn ? "Notifications" : "Sign in to view notifications"
        if #available(macOS 26.0, *) {
            // Disabled prominent items keep their orange fill on Tahoe. Use a
            // standard treatment until the action is available.
            composeItem?.style = composeItem?.isEnabled == true ? .prominent : .plain
            composeItem?.backgroundTintColor = composeItem?.isEnabled == true ? ConnectAppearance.accent : nil
        }
    }
    private func recordLocation() {
        guard let url = webView.url else { return }
        if authentication { window?.subtitle = url.host ?? "Sunhub Account" }
        else {
            sidebar.setRoute(url.path)
            updateWindowTitle(path: url.path)
            if let safe = policy.safeRestorationURL(url) { UserDefaults.standard.set(safe.absoluteString, forKey: "lastConnectURL") }
        }
    }

    func navigate(to path: String) {
        guard path.hasPrefix("/"), !path.hasPrefix("//"), let url = URL(string: path, relativeTo: policy.connectOrigin)?.absoluteURL,
              policy.classify(url, inAuthenticationWindow: false) == .internalNavigation else { return }
        if workspaceReady { sendWorkspaceCommand(["type": "navigate", "path": path]) }
        else { confirmLeaving(action: "Leave this page") { [weak self] allowed in if allowed { self?.loadInitialURL(url) } } }
    }

    private func updateWindowTitle(path: String) {
        let title: String
        if path == "/" { title = "Home" }
        else if path.hasPrefix("/directory") { title = "Directory" }
        else if path.hasPrefix("/network") { title = "My Network" }
        else if path.hasPrefix("/messages") { title = "Messages" }
        else if path.hasPrefix("/account") { title = "Account" }
        else { title = "Connect" }
        window?.title = title
        window?.subtitle = ""
    }

    @objc func compose(_ sender: Any?) {
        guard canCreatePost else { return }
        sendWorkspaceCommand(["type": "compose"])
    }
    @objc func showNotifications(_ sender: Any?) { sendWorkspaceCommand(["type": "notifications"]) }
    @objc func toggleSidebar(_ sender: Any?) {
        guard !authentication, let sidebarItem else { return }
        sidebarItem.isCollapsed.toggle()
        splitController.view.layoutSubtreeIfNeeded()
        updateSidebarToolbar()
    }

    private func updateSidebarToolbar() {
        guard let toolbar = window?.toolbar else { return }
        let identifier = NSToolbarItem.Identifier("sidebarSeparator")
        let index = toolbar.items.firstIndex { $0.itemIdentifier == identifier }
        if sidebarItem?.isCollapsed == true, let index { toolbar.removeItem(at: index) }
        else if sidebarItem?.isCollapsed == false, index == nil { toolbar.insertItem(withItemIdentifier: identifier, at: 1) }
    }

    private func sendWorkspaceCommand(_ command: [String: String]) {
        guard !authentication else { return }
        guard workspaceReady else { pendingCommand = command; return }
        guard let url = webView.url, policy.classify(url, inAuthenticationWindow: false) == .internalNavigation,
              let data = try? JSONSerialization.data(withJSONObject: command), let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('connect:mac-command', { detail: \(json) }))", completionHandler: nil)
    }

    fileprivate func receiveWorkspaceState(_ message: WKScriptMessage) {
        guard !authentication, message.webView === webView, message.frameInfo.isMainFrame,
              let source = message.frameInfo.request.url, ["http", "https"].contains(source.scheme ?? ""),
              policy.classify(source, inAuthenticationWindow: false) == .internalNavigation,
              let state = message.body as? [String: Any] else { return }
        if (state["type"] as? String)?.hasPrefix("notification") == true {
            nativeNotifications?.receive(state)
            return
        }
        if ["select", "selectCancel"].contains(state["type"] as? String ?? "") {
            nativeSelects.receive(state, from: webView)
            return
        }
        guard state["type"] as? String == "state" else { return }
        // Only presentation state crosses this bridge. Session cookies, emails,
        // access tokens, and native filesystem operations are never exposed.
        // Older web releases lack this field; current releases explicitly
        // report session readiness so startup commands cannot disappear.
        workspaceReady = state["ready"] as? Bool ?? true
        let signedIn = state["signedIn"] as? Bool == true
        if !signedIn { nativeNotifications?.setOwner(nil) }
        let canPublish = signedIn && state["canPublish"] as? Bool == true
        workspaceSignedIn = signedIn
        workspaceCanPublish = canPublish
        canUseNetwork = state["accountType"] as? String != "individual"
        sidebar.setNetworkVisible(canUseNetwork)
        let name = signedIn ? (state["userName"] as? String).map { String($0.prefix(160)) } : nil
        let company = signedIn ? (state["companyName"] as? String).map { String($0.prefix(160)) } : nil
        workspaceHasCompany = company?.isEmpty == false
        sidebar.setAccount(name: name, company: company, canPublish: canPublish)
        updateWorkspaceActions()
        let unread = max(0, min(999, state["unreadCount"] as? Int ?? 0))
        notificationItem?.image = NSImage(systemSymbolName: unread > 0 ? "bell.badge" : "bell", accessibilityDescription: unread > 0 ? "\(unread) unread notifications" : "Notifications")
        NSApp.dockTile.badgeLabel = unread > 0 ? String(unread) : nil
        if workspaceReady, let pending = pendingCommand { pendingCommand = nil; sendWorkspaceCommand(pending) }
    }
    private func sendNotificationEvent(_ payload: [String: Any]) {
        guard !authentication, let url = webView.url, ["http", "https"].contains(url.scheme ?? ""),
              policy.classify(url, inAuthenticationWindow: false) == .internalNavigation,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('connect:mac-notifications', { detail: \(json) }))", completionHandler: nil)
    }

    fileprivate func receiveNotificationPermission(_ message: WKScriptMessage) {
        guard !authentication, message.webView === webView, message.frameInfo.isMainFrame,
              let source = message.frameInfo.request.url, ["http", "https"].contains(source.scheme ?? ""),
              policy.classify(source, inAuthenticationWindow: false) == .internalNavigation,
              let value = message.body as? [String: Any], let id = value["requestId"] as? String else { return }
        let permitted = value["permitted"] as? Bool == true
        Task { await nativeNotifications?.requestPermission(id: id, trustedGesture: permitted) }
    }

    @objc func goBack(_ sender: Any?) {
        guard webView.canGoBack else { return }
        webView.goBack()
    }
    @objc func goForward(_ sender: Any?) {
        guard webView.canGoForward else { return }
        webView.goForward()
    }
    @objc func reloadPage(_ sender: Any?) {
        if isShowingRecovery { retryConnection(nil) } else { webView.reload() }
    }
    @objc func retryConnection(_ sender: Any?) {
        if authentication {
            window?.performClose(nil)
            return
        }
        recovery.isHidden = true
        // Re-enter the app, never replay an OAuth code/consent POST after failure.
        let target = webView.url.flatMap(policy.safeRestorationURL)
        loadInitialURL(target ?? initialURL.flatMap(policy.safeRestorationURL) ?? policy.connectOrigin)
    }
    func changeZoom(by amount: Double) {
        webView.pageZoom = min(1.8, max(0.7, webView.pageZoom + amount))
        if !authentication { UserDefaults.standard.set(webView.pageZoom, forKey: "pageZoom") }
    }
    func resetZoom() { webView.pageZoom = 1; if !authentication { UserDefaults.standard.removeObject(forKey: "pageZoom") } }

    func showFind() {
        findHeight.constant = 40
        findBar.isHidden = false
        window?.makeFirstResponder(searchField)
        searchField.selectText(nil)
    }
    @objc private func hideFind() { findBar.isHidden = true; findHeight.constant = 0; window?.makeFirstResponder(webView) }
    @objc private func findNext() {
        guard !searchField.stringValue.isEmpty else { return }
        let configuration = WKFindConfiguration()
        configuration.wraps = true
        webView.find(searchField.stringValue, configuration: configuration) { [weak self] result in
            self?.findStatus.stringValue = result.matchFound ? "" : "No matches"
        }
    }

    func confirmLeaving(action: String, quitting: Bool = false, completion: @escaping @MainActor @Sendable (Bool) -> Void) {
        guard window?.attachedSheet == nil else { completion(false); return }
        // Respect the publisher's existing draft/upload guard without exposing
        // form values, cookies, or session tokens to the native host.
        let chatCheck = quitting ? "Object.keys(sessionStorage).some(key => (key.startsWith('draft:') || key.startsWith('connect:personal-draft:')) && (sessionStorage.getItem(key) || '').trim().length > 0)" : "false"
        webView.evaluateJavaScript("(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); let chats = false; try { chats = \(chatCheck); } catch {} return event.defaultPrevented || chats; })()") { [weak self] value, _ in
            guard let self else { completion(false); return }
            let downloading = downloads.isActive
            guard value as? Bool == true || (quitting && downloading) else { completion(true); return }
            let alert = NSAlert()
            alert.messageText = quitting && downloading ? "A download is still in progress" : "You have changes in progress"
            alert.informativeText = quitting && downloading ? "Quitting now will cancel the download." : (quitting ? "Finish saving or sending your work first. Quitting discards unsent messages and changes that haven’t been saved." : "Wait for your draft or upload to finish, or leave and lose changes that haven’t been saved.")
            alert.addButton(withTitle: "Stay")
            alert.addButton(withTitle: action)
            window?.makeKeyAndOrderFront(nil)
            alert.beginSheetModal(for: window!) { response in completion(response == .alertSecondButtonReturn) }
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        nativeSelects.cancel()
        if forceClose { return true }
        if authentication {
            // The actual DOM window must close so the opener's cancellation poll
            // sees window.closed. Script-opened WebKit windows permit this.
            webView.evaluateJavaScript("window.close()") { [weak self] _, _ in self?.closeAuthenticationWindow() }
        } else { sender.orderOut(nil) } // Closing the main window keeps drafts alive.
        return false
    }
    private func closeAuthenticationWindow() {
        guard !forceClose else { return }
        forceClose = true
        webView.stopLoading()
        window?.close()
        onClosed?()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let decision = policy.classify(url, inAuthenticationWindow: authentication)
        if decision == .internalNavigation {
            if navigationAction.shouldPerformDownload { decisionHandler(.download); return }
            // A single gate covers menu/toolbar reloads, physical history swipes,
            // and full-page links. SPA navigation stays with Connect's router.
            let changesDocument = [.linkActivated, .backForward, .reload, .formSubmitted, .formResubmitted].contains(navigationAction.navigationType)
            if !authentication, navigationAction.targetFrame?.isMainFrame == true, changesDocument {
                confirmLeaving(action: navigationAction.navigationType == .reload ? "Reload" : "Leave this page") { [weak self] allowed in
                    if allowed { self?.recovery.isHidden = true }
                    decisionHandler(allowed ? .allow : .cancel)
                }
            } else { decisionHandler(.allow) }
        } else {
            // Server redirects and scripts cannot invoke other applications.
            if decision == .external, navigationAction.navigationType == .linkActivated,
               policy.classify(navigationAction.sourceFrame.request.url ?? policy.connectOrigin, inAuthenticationWindow: authentication) == .internalNavigation {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
        guard let url = navigationResponse.response.url,
              policy.classify(url, inAuthenticationWindow: authentication) == .internalNavigation else { decisionHandler(.cancel); return }
        let response = navigationResponse.response as? HTTPURLResponse
        let attachment = response?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased().hasPrefix("attachment") == true
        if attachment || !navigationResponse.canShowMIMEType { decisionHandler(.download) }
        else if navigationResponse.isForMainFrame, (response?.statusCode ?? 200) >= 500 {
            showRecovery()
            decisionHandler(.cancel)
        } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if !authentication { nativeSelects.cancel(); nativeNotifications?.setOwner(nil); workspaceReady = false; updateWorkspaceActions() }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { recovery.isHidden = true; recordLocation() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { showRecovery(processEnded: true) }
    private func navigationFailed(_ error: Error) {
        let failure = error as NSError
        if (failure.domain == NSURLErrorDomain && failure.code == NSURLErrorCancelled) || (failure.domain == "WebKitErrorDomain" && failure.code == 102) { return }
        showRecovery()
    }
    private func showRecovery(processEnded: Bool = false) {
        nativeSelects.cancel()
        nativeNotifications?.setOwner(nil)
        workspaceReady = false
        updateWorkspaceActions()
        recoveryTitle.stringValue = processEnded ? "Let’s reopen Connect" : "Connect is taking a moment"
        recoveryBody.stringValue = authentication ? "Close this window and start Sunhub sign-in again from Connect." : (processEnded ? "Your session is saved. Reload to get back to Connect." : "Check your connection, then try again. Your account hasn’t been signed out.")
        recovery.isHidden = false
        progress.stopAnimation(nil)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url,
              let source = navigationAction.sourceFrame.request.url,
              policy.classify(source, inAuthenticationWindow: authentication) == .internalNavigation else { return nil }
        // Only the app's explicit Sunhub flow receives a retained authentication
        // window. Untrusted pages cannot inherit its trusted account chrome.
        guard !authentication, url.path == "/api/auth/sunhub/start",
              policy.classify(url, inAuthenticationWindow: false) == .internalNavigation else {
            if policy.classify(url, inAuthenticationWindow: authentication) == .external, navigationAction.navigationType == .linkActivated { NSWorkspace.shared.open(url) }
            else if policy.classify(url, inAuthenticationWindow: false) == .internalNavigation {
                confirmLeaving(action: "Leave this page") { [weak self] allowed in if allowed { self?.loadInitialURL(url) } }
            }
            return nil
        }
        let popup = BrowserWindowController(policy: policy, configuration: configuration, authentication: true)
        popup.onClosed = { [weak self, weak popup] in self?.authenticationWindows.removeAll { $0 === popup } }
        authenticationWindows.append(popup)
        if let screen = window?.screen ?? NSScreen.main {
            let frame = screen.visibleFrame
            let size = NSSize(width: min(500, frame.width), height: min(720, frame.height))
            popup.window?.setFrame(NSRect(x: frame.midX - size.width / 2, y: frame.midY - size.height / 2, width: size.width, height: size.height), display: false)
        }
        popup.showWindow(nil)
        popup.window?.makeKeyAndOrderFront(nil)
        return popup.webView
    }
    func webViewDidClose(_ webView: WKWebView) { if authentication { closeAuthenticationWindow() } }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void) {
        guard let origin = frame.request.url, policy.classify(origin, inAuthenticationWindow: authentication) == .internalNavigation,
              let window, window.attachedSheet == nil else { completionHandler(nil); return }
        let panel = NSOpenPanel()
        panel.title = "Add to Connect"
        panel.prompt = "Choose"
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    private func dialog(_ message: String, frame: WKFrameInfo) -> NSAlert? {
        guard let url = frame.request.url, policy.classify(url, inAuthenticationWindow: authentication) == .internalNavigation,
              window?.attachedSheet == nil else { return nil }
        let alert = NSAlert()
        alert.messageText = authentication ? "Sunhub Account" : "Connect"
        alert.informativeText = message
        return alert
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable () -> Void) {
        guard let alert = dialog(message, frame: frame), let window else { completionHandler(); return }
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (Bool) -> Void) {
        guard let alert = dialog(message, frame: frame), let window else { completionHandler(false); return }
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping @MainActor @Sendable (String?) -> Void) {
        guard let alert = dialog(prompt, frame: frame), let window else { completionHandler(nil); return }
        let field = NSTextField(string: defaultText ?? "")
        field.frame = NSRect(x: 0, y: 0, width: 280, height: 24)
        alert.accessoryView = field
        alert.addButton(withTitle: "Continue")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
        alert.window.makeFirstResponder(field)
    }
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { downloads.start(download) }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { downloads.start(download) }
}

private extension Double { var nonzero: Double? { self == 0 ? nil : self } }

@MainActor
private final class RecoverySurface: NSView {
    override var isOpaque: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        ConnectAppearance.windowBackground.setFill()
        bounds.fill()
    }
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
}

@MainActor
private final class MacWorkspaceBridge: NSObject, WKScriptMessageHandler {
    weak var owner: BrowserWindowController?
    init(owner: BrowserWindowController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receiveWorkspaceState(message)
    }
}

@MainActor
private final class MacNotificationPermissionBridge: NSObject, WKScriptMessageHandler {
    weak var owner: BrowserWindowController?
    init(owner: BrowserWindowController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receiveNotificationPermission(message)
    }
}
