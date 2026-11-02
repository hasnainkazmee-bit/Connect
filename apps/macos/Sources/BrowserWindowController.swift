import AppKit
import WebKit

@MainActor
final class BrowserWindowController: NSWindowController, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, NSToolbarDelegate, NSSplitViewDelegate {
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
    private let recovery = NSView()
    private let recoveryTitle = NSTextField(labelWithString: "Connect is taking a moment")
    private let recoveryBody = NSTextField(wrappingLabelWithString: "Check your connection, then try again. Your account hasn’t been signed out.")
    private let sidebar = MacSidebar()
    private let splitView = NSSplitView()
    private let workspace = NSView()
    private var sidebarWidth: CGFloat = 224
    private var workspaceReady = false
    private var pendingCommand: [String: String]?
    private var bridge: MacWorkspaceBridge?
    private var composeButton: NSButton?
    private var backItem: NSToolbarItem?
    private var notificationItem: NSToolbarItem?
    private var downloads: DownloadCoordinator!
    private let findBar = NSStackView()
    private let searchField = NSSearchField()
    private let findStatus = NSTextField(labelWithString: "")
    private var findHeight: NSLayoutConstraint!

    init(policy: NavigationPolicy = NavigationPolicy(), configuration: WKWebViewConfiguration? = nil, authentication: Bool = false) {
        self.policy = policy
        self.authentication = authentication
        // A popup MUST retain WebKit's supplied configuration to preserve opener,
        // process pool, and the first-party session. Never copy tokens into Swift.
        let settings = configuration ?? WKWebViewConfiguration()
        if configuration == nil {
            settings.websiteDataStore = .default()
            settings.preferences.javaScriptCanOpenWindowsAutomatically = false
            settings.applicationNameForUserAgent = "ConnectMac/0.1"
        }
        webView = WKWebView(frame: .zero, configuration: settings)
        webView.allowsBackForwardNavigationGestures = true
        webView.underPageBackgroundColor = NSColor(red: 0.95, green: 0.97, blue: 0.99, alpha: 1)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: authentication ? 500 : 1180, height: authentication ? 680 : 800),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = authentication ? "Sunhub Account" : "Connect"
        window.subtitle = authentication ? (policy.ssoOrigin.host ?? "") : "Connect. Talk. Celebrate."
        window.minSize = authentication ? NSSize(width: 390, height: 560) : NSSize(width: 720, height: 580)
        window.isReleasedWhenClosed = false
        window.backgroundColor = webView.underPageBackgroundColor
        window.tabbingMode = .disallowed
        window.appearance = NSAppearance(named: .aqua)
        window.toolbarStyle = .unifiedCompact
        super.init(window: window)
        window.delegate = self
        webView.navigationDelegate = self
        webView.uiDelegate = self
        if !authentication {
            let bridge = MacWorkspaceBridge(owner: self)
            self.bridge = bridge
            settings.userContentController.add(bridge, name: "connectMac")
        }
        downloads = DownloadCoordinator(window: window, policy: policy)
        configureContent()
        if !authentication {
            let toolbar = NSToolbar(identifier: "ConnectToolbar")
            toolbar.delegate = self
            toolbar.displayMode = .iconOnly
            toolbar.allowsUserCustomization = false
            window.toolbar = toolbar
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
            splitView.frame = root.bounds
            splitView.autoresizingMask = [.width, .height]
            splitView.isVertical = true
            splitView.dividerStyle = .thin
            splitView.delegate = self
            sidebar.frame = NSRect(x: 0, y: 0, width: sidebarWidth, height: root.bounds.height)
            workspace.frame = NSRect(x: sidebarWidth + 1, y: 0, width: root.bounds.width - sidebarWidth - 1, height: root.bounds.height)
            splitView.addArrangedSubview(sidebar)
            splitView.addArrangedSubview(workspace)
            splitView.setHoldingPriority(.defaultHigh, forSubviewAt: 0)
            root.addSubview(splitView)
            splitView.adjustSubviews()
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
        findStatus.textColor = .secondaryLabelColor
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
            findBar.topAnchor.constraint(equalTo: container.topAnchor), findHeight,
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor), webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: findBar.bottomAnchor), webView.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            recovery.leadingAnchor.constraint(equalTo: webView.leadingAnchor), recovery.trailingAnchor.constraint(equalTo: webView.trailingAnchor),
            recovery.topAnchor.constraint(equalTo: webView.topAnchor), recovery.bottomAnchor.constraint(equalTo: webView.bottomAnchor),
        ])
        recovery.wantsLayer = true
        recovery.layer?.backgroundColor = window?.backgroundColor.cgColor
        recovery.isHidden = true
        let emblem = NSImageView(image: NSImage(named: NSImage.applicationIconName) ?? NSImage())
        emblem.imageScaling = .scaleProportionallyUpOrDown
        emblem.widthAnchor.constraint(equalToConstant: 68).isActive = true
        emblem.heightAnchor.constraint(equalToConstant: 68).isActive = true
        recoveryTitle.font = .systemFont(ofSize: 23, weight: .semibold)
        recoveryTitle.alignment = .center
        recoveryBody.font = .systemFont(ofSize: 14)
        recoveryBody.textColor = .secondaryLabelColor
        recoveryBody.alignment = .center
        recoveryBody.maximumNumberOfLines = 4
        let retry = NSButton(title: authentication ? "Close sign-in" : "Try again", target: self, action: #selector(retryConnection))
        retry.bezelStyle = .rounded
        retry.controlSize = .large
        retry.bezelColor = NSColor.systemOrange
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
        [.init("sidebar"), .init("back"), .flexibleSpace, .init("loading"), .init("notifications"), .init("compose")]
    }
    func toolbar(_ toolbar: NSToolbar, itemForItemIdentifier identifier: NSToolbarItem.Identifier, willBeInsertedIntoToolbar flag: Bool) -> NSToolbarItem? {
        let item = NSToolbarItem(itemIdentifier: identifier)
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
        case "compose":
            item.label = "New Post"
            let button = NSButton(title: "New post", target: self, action: #selector(compose))
            button.bezelStyle = .rounded
            button.bezelColor = NSColor(red: 1, green: 0.43, blue: 0.08, alpha: 1)
            button.image = NSImage(systemSymbolName: "square.and.pencil", accessibilityDescription: nil)
            button.imagePosition = .imageLeading
            button.toolTip = "Create a post or press release (⌘N)"
            button.isEnabled = false
            composeButton = button
            item.view = button
        case "notifications":
            item.label = "Notifications"
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
        return item
    }

    private func updateNavigation() {
        backItem?.isEnabled = webView.canGoBack
        if webView.isLoading { progress.startAnimation(nil) } else { progress.stopAnimation(nil) }
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
        window?.subtitle = title == "Connect" ? "Connect. Talk. Celebrate." : "Connect"
    }

    @objc func compose(_ sender: Any?) { sendWorkspaceCommand(["type": "compose"]) }
    @objc func showNotifications(_ sender: Any?) { sendWorkspaceCommand(["type": "notifications"]) }
    @objc func toggleSidebar(_ sender: Any?) {
        guard !authentication else { return }
        if !sidebar.isHidden { sidebarWidth = min(270, max(188, sidebar.frame.width)) }
        sidebar.isHidden.toggle()
        splitView.adjustSubviews()
    }

    func splitView(_ splitView: NSSplitView, canCollapseSubview subview: NSView) -> Bool { subview === sidebar }
    func splitView(_ splitView: NSSplitView, constrainMinCoordinate proposedMinimumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat { 188 }
    func splitView(_ splitView: NSSplitView, constrainMaxCoordinate proposedMaximumPosition: CGFloat, ofSubviewAt dividerIndex: Int) -> CGFloat { min(270, splitView.bounds.width - 480) }
    func splitView(_ splitView: NSSplitView, resizeSubviewsWithOldSize oldSize: NSSize) {
        let width: CGFloat = sidebar.isHidden ? 0 : min(270, max(188, sidebarWidth))
        let divider: CGFloat = sidebar.isHidden ? 0 : splitView.dividerThickness
        sidebar.frame = NSRect(x: 0, y: 0, width: width, height: splitView.bounds.height)
        workspace.frame = NSRect(x: width + divider, y: 0, width: splitView.bounds.width - width - divider, height: splitView.bounds.height)
    }
    func splitViewDidResizeSubviews(_ notification: Notification) {
        if !sidebar.isHidden { sidebarWidth = min(270, max(188, sidebar.frame.width)) }
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
              let state = message.body as? [String: Any], state["type"] as? String == "state" else { return }
        // Only presentation state crosses this bridge. Session cookies, emails,
        // access tokens, and native filesystem operations are never exposed.
        workspaceReady = true
        let signedIn = state["signedIn"] as? Bool == true
        let canPublish = signedIn && state["canPublish"] as? Bool == true
        canUseNetwork = state["accountType"] as? String != "individual"
        sidebar.setNetworkVisible(canUseNetwork)
        let name = signedIn ? (state["userName"] as? String).map { String($0.prefix(160)) } : nil
        let company = signedIn ? (state["companyName"] as? String).map { String($0.prefix(160)) } : nil
        sidebar.setAccount(name: name, company: company, canPublish: canPublish)
        composeButton?.isEnabled = canPublish
        notificationItem?.isEnabled = signedIn
        let unread = max(0, min(999, state["unreadCount"] as? Int ?? 0))
        notificationItem?.image = NSImage(systemSymbolName: unread > 0 ? "bell.badge" : "bell", accessibilityDescription: unread > 0 ? "\(unread) unread notifications" : "Notifications")
        NSApp.dockTile.badgeLabel = unread > 0 ? String(unread) : nil
        if let pending = pendingCommand { pendingCommand = nil; sendWorkspaceCommand(pending) }
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

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { if !authentication { workspaceReady = false } }
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
        workspaceReady = false
        composeButton?.isEnabled = false
        notificationItem?.isEnabled = false
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
private final class MacWorkspaceBridge: NSObject, WKScriptMessageHandler {
    weak var owner: BrowserWindowController?
    init(owner: BrowserWindowController) { self.owner = owner }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.receiveWorkspaceState(message)
    }
}
