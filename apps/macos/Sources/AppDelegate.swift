import AppKit
import WebKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    private var browser: BrowserWindowController!
    private var checkingTermination = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        ConnectAppearance.applySavedChoice()
        installMenus()
        browser = BrowserWindowController()
        let policy = NavigationPolicy()
        let restored = UserDefaults.standard.string(forKey: "lastConnectURL")
            .flatMap(URL.init(string:)).flatMap(policy.safeRestorationURL)
        browser.loadInitialURL(restored ?? policy.connectOrigin)
        showConnect(nil)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showConnect(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let browser else { return .terminateNow }
        guard !checkingTermination else { return .terminateCancel }
        checkingTermination = true
        browser.confirmLeaving(action: "Quit Connect", quitting: true) { [weak self] allowed in
            self?.checkingTermination = false
            sender.reply(toApplicationShouldTerminate: allowed)
        }
        return .terminateLater
    }

    @objc private func showConnect(_ sender: Any?) {
        browser?.showWindow(nil)
        browser?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func navigate(_ sender: NSMenuItem) {
        showConnect(nil)
        browser.navigate(to: sender.representedObject as? String ?? "/")
    }

    @objc private func reload(_ sender: Any?) { activeBrowser.reloadPage(nil) }
    @objc private func back(_ sender: Any?) { activeBrowser.goBack(nil) }
    @objc private func forward(_ sender: Any?) { activeBrowser.goForward(nil) }
    @objc private func zoomIn(_ sender: Any?) { activeBrowser.changeZoom(by: 0.1) }
    @objc private func zoomOut(_ sender: Any?) { activeBrowser.changeZoom(by: -0.1) }
    @objc private func actualSize(_ sender: Any?) { activeBrowser.resetZoom() }
    @objc private func find(_ sender: Any?) { activeBrowser.showFind() }
    @objc private func compose(_ sender: Any?) { showConnect(nil); browser.compose(nil) }
    @objc private func sidebar(_ sender: Any?) { browser.toggleSidebar(nil) }
    @objc private func selectAppearance(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? String,
              let choice = ConnectAppearance.Choice(rawValue: value) else { return }
        ConnectAppearance.setChoice(choice)
    }
    @objc private func updates(_ sender: Any?) {
        let alert = NSAlert()
        alert.messageText = "Connect stays current"
        alert.informativeText = "Feed, messaging, and profile improvements arrive through Connect’s web service. Reload to load the latest interface. Native Mac app upgrades require a new app build."
        alert.addButton(withTitle: "Done")
        alert.addButton(withTitle: "Reload")
        alert.beginSheetModal(for: browser.window!) { [weak self] result in
            if result == .alertSecondButtonReturn { self?.browser.reloadPage(nil) }
        }
    }
    @objc private func about(_ sender: Any?) {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "Connect",
            .credits: NSAttributedString(string: "Connect. Talk. Celebrate.\nA place for the solar industry to come together."),
        ])
    }

    private var activeBrowser: BrowserWindowController {
        (NSApp.keyWindow?.windowController as? BrowserWindowController) ?? browser
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(selectAppearance(_:)) {
            menuItem.state = menuItem.representedObject as? String == ConnectAppearance.selectedChoice.rawValue ? .on : .off
        }
        if menuItem.representedObject as? String == "/network" { return browser?.canUseNetwork ?? true }
        return true
    }

    private func installMenus() {
        let main = NSMenu()
        NSApp.mainMenu = main
        func menu(_ title: String) -> NSMenu {
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            let submenu = NSMenu(title: title)
            item.submenu = submenu
            main.addItem(item)
            return submenu
        }
        @discardableResult
        func item(_ menu: NSMenu, _ title: String, _ action: Selector, _ key: String = "", target: AnyObject? = nil) -> NSMenuItem {
            let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
            entry.target = target
            menu.addItem(entry)
            return entry
        }
        let app = menu("Connect")
        item(app, "About Connect", #selector(about), target: self)
        item(app, "App Updates…", #selector(updates), target: self)
        app.addItem(.separator())
        let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
        services.submenu = NSMenu(title: "Services")
        NSApp.servicesMenu = services.submenu
        app.addItem(services)
        app.addItem(.separator())
        item(app, "Hide Connect", #selector(NSApplication.hide(_:)), "h")
        let others = item(app, "Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h")
        others.keyEquivalentModifierMask = [.command, .option]
        item(app, "Show All", #selector(NSApplication.unhideAllApplications(_:)))
        app.addItem(.separator())
        item(app, "Quit Connect", #selector(NSApplication.terminate(_:)), "q")

        let file = menu("File")
        item(file, "New Post", #selector(compose), "n", target: self)
        item(file, "Show Connect", #selector(showConnect), target: self)
        item(file, "Close Window", #selector(NSWindow.performClose(_:)), "w")
        let edit = menu("Edit")
        for (title, action, key) in [("Undo", "undo:", "z"), ("Redo", "redo:", "Z"),
                                    ("Cut", "cut:", "x"), ("Copy", "copy:", "c"),
                                    ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            item(edit, title, Selector(action), key)
        }
        edit.addItem(.separator())
        item(edit, "Find…", #selector(find), "f", target: self)

        let view = menu("View")
        let sidebar = item(view, "Toggle Sidebar", #selector(sidebar), "s", target: self)
        sidebar.keyEquivalentModifierMask = [.command, .control]
        view.addItem(.separator())
        item(view, "Reload", #selector(reload), "r", target: self)
        view.addItem(.separator())
        item(view, "Zoom In", #selector(zoomIn), "+", target: self)
        item(view, "Zoom Out", #selector(zoomOut), "-", target: self)
        item(view, "Actual Size", #selector(actualSize), "0", target: self)
        view.addItem(.separator())
        let appearanceItem = NSMenuItem(title: "Appearance", action: nil, keyEquivalent: "")
        let appearanceMenu = NSMenu(title: "Appearance")
        for choice in ConnectAppearance.Choice.allCases {
            let entry = item(appearanceMenu, choice.title, #selector(selectAppearance(_:)), target: self)
            entry.representedObject = choice.rawValue
            entry.state = choice == ConnectAppearance.selectedChoice ? .on : .off
        }
        appearanceItem.submenu = appearanceMenu
        view.addItem(appearanceItem)
        view.addItem(.separator())
        let fullscreen = item(view, "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]

        let go = menu("Go")
        item(go, "Back", #selector(back), "[", target: self)
        item(go, "Forward", #selector(forward), "]", target: self)
        go.addItem(.separator())
        for (index, route) in [("Home", "/"), ("Directory", "/directory"), ("My Network", "/network"), ("Messages", "/messages")].enumerated() {
            let entry = item(go, route.0, #selector(navigate), String(index + 1), target: self)
            entry.representedObject = route.1
        }
        let window = menu("Window")
        NSApp.windowsMenu = window
        item(window, "Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")
        item(window, "Zoom", #selector(NSWindow.performZoom(_:)))
        item(window, "Bring All to Front", #selector(NSApplication.arrangeInFront(_:)))
    }
}
