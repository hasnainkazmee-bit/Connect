import AppKit
import WebKit

/// WebKit owns authenticated transfers; the native host only chooses their destination.
@MainActor
final class DownloadCoordinator: NSObject, WKDownloadDelegate {
    private weak var window: NSWindow?
    private let policy: NavigationPolicy
    private var download: WKDownload?
    private var destination: URL?
    private var temporary: URL?
    private var securityScoped = false
    private var transferPanel: NSPanel?
    private var progressObservation: NSKeyValueObservation?
    private var destinationPanel: NSSavePanel?
    private var noticePanel: NSPanel?
    private var sheetObserver: NSObjectProtocol?
    private var sheetWaitID: UUID?
    private enum Phase { case choosing, transferring, cancelling, saving, awaitingDestination }
    private var phase = Phase.choosing
    var isActive: Bool { download != nil }

    init(window: NSWindow, policy: NavigationPolicy) { self.window = window; self.policy = policy }

    func start(_ download: WKDownload) {
        guard self.download == nil else {
            download.cancel { _ in }
            showBusyNotice()
            return
        }
        self.download = download
        phase = .choosing
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping @MainActor @Sendable (URL?) -> Void) {
        guard self.download === download, phase == .choosing else { completionHandler(nil); return }
        guard let window, window.attachedSheet == nil,
              let url = response.url, policy.classify(url, inAuthenticationWindow: false) == .internalNavigation else {
            completionHandler(nil); cleanup(download); return
        }
        let panel = makeSavePanel(filename: suggestedFilename)
        destinationPanel = panel
        panel.beginSheetModal(for: window) { [weak self] result in
            guard let self, self.download === download, phase == .choosing else { completionHandler(nil); return }
            destinationPanel = nil
            guard result == .OK, let destination = panel.url else { completionHandler(nil); cleanup(download); return }
            selectDestination(destination)
            let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("connect-download-" + UUID().uuidString)
            self.temporary = temporary
            phase = .transferring
            completionHandler(temporary)
            showProgress(name: destination.lastPathComponent, download: download)
        }
    }

    private func makeSavePanel(filename: String) -> NSSavePanel {
        let panel = NSSavePanel()
        panel.title = "Save from Connect"
        panel.canCreateDirectories = true
        let name = (filename as NSString).lastPathComponent
            .components(separatedBy: .controlCharacters).joined()
            .replacingOccurrences(of: ":", with: "-")
        panel.nameFieldStringValue = name.isEmpty || name == "." || name == ".." ? "Connect download" : name
        return panel
    }

    private func selectDestination(_ destination: URL) {
        releaseDestinationAccess()
        self.destination = destination
        securityScoped = destination.startAccessingSecurityScopedResource()
    }

    private func releaseDestinationAccess() {
        if securityScoped { destination?.stopAccessingSecurityScopedResource() }
        securityScoped = false
    }

    private func showProgress(name: String, download: WKDownload) {
        guard self.download === download, phase == .transferring else { return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 110), styleMask: [.titled, .utilityWindow], backing: .buffered, defer: false)
        panel.title = "Downloading"
        panel.isFloatingPanel = true
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        let label = NSTextField(labelWithString: name)
        label.lineBreakMode = .byTruncatingMiddle
        let bar = NSProgressIndicator()
        bar.style = .bar
        bar.isIndeterminate = true
        bar.startAnimation(nil)
        let cancel = NSButton(title: "Cancel", target: self, action: #selector(cancelDownload))
        cancel.bezelStyle = .rounded
        let stack = NSStackView(views: [label, bar, cancel])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -16),
            stack.centerYAnchor.constraint(equalTo: panel.contentView!.centerYAnchor),
            bar.widthAnchor.constraint(equalTo: stack.widthAnchor), label.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        progressObservation = download.progress.observe(\.fractionCompleted, options: [.new]) { [weak self, weak download] progress, _ in
            let fraction = progress.fractionCompleted
            Task { @MainActor in
                guard let self, let download, self.download === download, self.phase == .transferring else { return }
                bar.isIndeterminate = false
                bar.maxValue = 1
                bar.doubleValue = fraction
            }
        }
        transferPanel = panel
        panel.center()
        panel.orderFront(nil)
    }

    @objc private func cancelDownload() {
        guard let download, phase == .transferring else { return }
        phase = .cancelling
        download.cancel { [weak self] _ in self?.cleanup(download) }
    }

    func download(_ download: WKDownload, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, decisionHandler: @escaping @MainActor @Sendable (WKDownload.RedirectPolicy) -> Void) {
        guard self.download === download, phase == .choosing || phase == .transferring else { decisionHandler(.cancel); return }
        let allowed = request.url.map { policy.classify($0, inAuthenticationWindow: false) == .internalNavigation } ?? false
        decisionHandler(allowed ? .allow : .cancel)
    }

    func download(_ download: WKDownload, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping @MainActor @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard self.download === download, phase == .choosing || phase == .transferring else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.performDefaultHandling, nil)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard self.download === download, phase == .transferring else { return }
        stopProgress()
        saveCompletedDownload(download)
    }

    private func saveCompletedDownload(_ download: WKDownload) {
        guard self.download === download, let destination, let temporary else { return }
        phase = .saving
        // Keep the original transfer intact until a destination has been saved.
        // File copying can be substantial for video, so do it off the UI thread.
        Task { [self] in
            let result = await Task.detached(priority: .utility) {
                Result { try Self.saveFile(from: temporary, to: destination) }
            }.value
            guard self.download === download, phase == .saving else { return }
            releaseDestinationAccess()
            switch result {
            case .success:
                cleanup(download)
                showSaved(destination)
            case .failure:
                phase = .awaitingDestination
                offerAnotherDestination(download)
            }
        }
    }

    nonisolated private static func saveFile(from source: URL, to destination: URL) throws {
        let files = FileManager.default
        if files.fileExists(atPath: destination.path) {
            // Replacement requires a staging file on the destination's volume.
            // Copy, rather than move, so failure never consumes the only download.
            let stagingDirectory = try files.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: destination, create: true)
            var removeStaging = true
            defer { if removeStaging { try? files.removeItem(at: stagingDirectory) } }
            let stagingFile = stagingDirectory.appendingPathComponent(UUID().uuidString)
            try files.copyItem(at: source, to: stagingFile)
            do {
                _ = try files.replaceItemAt(destination, withItemAt: stagingFile)
            } catch {
                // Foundation can report a relocated original after a failed swap.
                // Do not remove a recovery directory that might contain that file.
                removeStaging = (error as NSError).userInfo["NSFileOriginalItemLocationKey"] == nil
                throw error
            }
        } else {
            try files.copyItem(at: source, to: destination)
        }
    }

    private func offerAnotherDestination(_ download: WKDownload) {
        whenSheetAvailable(download) { [weak self] in
            guard let self, self.download === download, phase == .awaitingDestination, let window else { return }
            let alert = NSAlert()
            alert.messageText = "Choose another place to save"
            alert.informativeText = "Your download is complete and is still available. Save it somewhere else, or cancel to discard it."
            alert.addButton(withTitle: "Save elsewhere…")
            alert.addButton(withTitle: "Cancel")
            alert.beginSheetModal(for: window) { [weak self] result in
                guard let self, self.download === download, phase == .awaitingDestination else { return }
                if result == .alertFirstButtonReturn { chooseAnotherDestination(download) }
                else { cleanup(download) }
            }
        }
    }

    private func chooseAnotherDestination(_ download: WKDownload) {
        whenSheetAvailable(download) { [weak self] in
            guard let self, self.download === download, phase == .awaitingDestination, let window else { return }
            let panel = makeSavePanel(filename: destination?.lastPathComponent ?? "Connect download")
            destinationPanel = panel
            panel.beginSheetModal(for: window) { [weak self] result in
                guard let self, self.download === download, phase == .awaitingDestination else { return }
                destinationPanel = nil
                guard result == .OK, let destination = panel.url else {
                    // Cancelling the chooser does not discard the completed file.
                    offerAnotherDestination(download)
                    return
                }
                selectDestination(destination)
                saveCompletedDownload(download)
            }
        }
    }

    private func whenSheetAvailable(_ download: WKDownload, action: @escaping @MainActor @Sendable () -> Void) {
        guard self.download === download, let window else { return }
        guard window.attachedSheet == nil else {
            if let sheetObserver { NotificationCenter.default.removeObserver(sheetObserver) }
            let waitID = UUID()
            sheetWaitID = waitID
            sheetObserver = NotificationCenter.default.addObserver(forName: NSWindow.didEndSheetNotification, object: window, queue: .main) { [weak self] _ in
                Task { @MainActor in
                    guard let self, self.download === download, self.sheetWaitID == waitID else { return }
                    self.sheetWaitID = nil
                    if let observer = self.sheetObserver { NotificationCenter.default.removeObserver(observer) }
                    self.sheetObserver = nil
                    self.whenSheetAvailable(download, action: action)
                }
            }
            return
        }
        action()
    }

    private func showSaved(_ destination: URL) {
        let alert = NSAlert()
        alert.messageText = "Download saved"
        alert.informativeText = destination.lastPathComponent
        alert.addButton(withTitle: "Done")
        alert.addButton(withTitle: "Show in Finder")
        if let window, window.attachedSheet == nil {
            alert.beginSheetModal(for: window) { result in
                if result == .alertSecondButtonReturn { NSWorkspace.shared.activateFileViewerSelecting([destination]) }
            }
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        guard self.download === download, phase != .saving, phase != .awaitingDestination else { return }
        let wasCancelled = phase == .cancelling || ((error as NSError).domain == NSURLErrorDomain && (error as NSError).code == NSURLErrorCancelled)
        cleanup(download)
        if !wasCancelled { showError("The download didn’t finish. Check your connection and try again.") }
    }

    private func showBusyNotice() {
        if let noticePanel { noticePanel.makeKeyAndOrderFront(nil); return }
        let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 380, height: 145), styleMask: [.titled], backing: .buffered, defer: false)
        panel.title = "A download is already open"
        panel.isFloatingPanel = true
        panel.isReleasedWhenClosed = false
        panel.hidesOnDeactivate = false
        let message = NSTextField(wrappingLabelWithString: "Finish saving or cancel your current download, then try the next file again.")
        let button = NSButton(title: "OK", target: self, action: #selector(dismissBusyNotice))
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"
        let stack = NSStackView(views: [message, button])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -20),
            stack.centerYAnchor.constraint(equalTo: panel.contentView!.centerYAnchor),
            message.widthAnchor.constraint(equalTo: stack.widthAnchor),
        ])
        noticePanel = panel
        panel.center()
        panel.makeKeyAndOrderFront(nil)
    }

    @objc private func dismissBusyNotice() { noticePanel?.close(); noticePanel = nil }

    private func showError(_ message: String) {
        guard let window, window.attachedSheet == nil else { return }
        let alert = NSAlert()
        alert.messageText = "Couldn’t save the file"
        alert.informativeText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window)
    }

    private func stopProgress() {
        progressObservation = nil
        transferPanel?.close()
        transferPanel = nil
    }

    private func cleanup(_ download: WKDownload) {
        guard self.download === download else { return }
        // Invalidate ownership before closing UI, whose completions may run later.
        self.download = nil
        if let sheetObserver { NotificationCenter.default.removeObserver(sheetObserver) }
        sheetObserver = nil
        sheetWaitID = nil
        let panel = destinationPanel
        destinationPanel = nil
        if let panel, let parent = panel.sheetParent { parent.endSheet(panel, returnCode: .cancel) }
        stopProgress()
        releaseDestinationAccess()
        if let temporary { try? FileManager.default.removeItem(at: temporary) }
        destination = nil
        temporary = nil
        phase = .choosing
    }
}
