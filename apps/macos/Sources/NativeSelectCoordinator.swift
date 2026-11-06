import AppKit
import CoreFoundation
import WebKit

/// A bounded presentation bridge: directory filter labels/indices only. React
/// retains the selected value, routing, authorization, and API requests.
@MainActor
final class NativeSelectCoordinator: NSObject {
    static let capabilityScript = "Object.defineProperty(window, '__connectMacCapabilities', { value: Object.freeze({ nativeSelect: true }), writable: false, configurable: false });"

    struct Option: Equatable {
        let title: String
        let disabled: Bool
    }
    struct Request {
        let id: String
        let label: String
        let selectedIndex: Int
        let options: [Option]
        let anchor: CGRect
        let viewport: CGSize

        init?(_ body: [String: Any]) {
            guard body["type"] as? String == "select",
                  let id = body["requestId"] as? String, UUID(uuidString: id) != nil,
                  let label = body["label"] as? String, label.utf16.count <= 160,
                  let rawOptions = body["options"] as? [[String: Any]], (1...512).contains(rawOptions.count),
                  let selected = Self.integer(body["selectedIndex"]), (-1..<rawOptions.count).contains(selected),
                  let coordinates = body["anchor"] as? [String: Any],
                  let x = Self.number(coordinates["x"]), let y = Self.number(coordinates["y"]),
                  let width = Self.number(coordinates["width"]), let height = Self.number(coordinates["height"]),
                  let viewportWidth = Self.number(coordinates["viewportWidth"]), let viewportHeight = Self.number(coordinates["viewportHeight"]),
                  (1...20_000).contains(viewportWidth), (1...20_000).contains(viewportHeight),
                  (1...20_000).contains(width), (1...20_000).contains(height),
                  x < viewportWidth, y < viewportHeight, x + width > 0, y + height > 0 else { return nil }
            var options: [Option] = []
            for raw in rawOptions {
                guard let title = raw["title"] as? String, title.utf16.count <= 240,
                      let disabled = raw["disabled"] as? Bool else { return nil }
                options.append(Option(title: Self.menuText(title), disabled: disabled))
            }
            self.id = id
            self.label = Self.menuText(label)
            selectedIndex = selected
            self.options = options
            anchor = CGRect(x: x, y: y, width: width, height: height)
            viewport = CGSize(width: viewportWidth, height: viewportHeight)
        }
        private static func number(_ value: Any?) -> Double? {
            guard let number = value as? NSNumber,
                  CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else { return nil }
            return number.doubleValue
        }
        private static func integer(_ value: Any?) -> Int? {
            guard let number = number(value), number.rounded() == number, (-1...512).contains(number) else { return nil }
            return Int(number)
        }
        private static func menuText(_ text: String) -> String {
            text.components(separatedBy: .controlCharacters).joined(separator: " ")
        }
        func point(in bounds: CGRect, flipped: Bool) -> CGPoint {
            let x = max(bounds.minX, min(bounds.maxX - 1, bounds.minX + anchor.minX * bounds.width / viewport.width))
            let top = max(0, min(bounds.height - 1, anchor.minY * bounds.height / viewport.height))
            return CGPoint(x: x, y: flipped ? bounds.minY + top : bounds.maxY - top)
        }
    }

    @MainActor
    private final class Presentation {
        let request: Request
        weak var webView: WKWebView?
        let page: URL?
        let menu: NSMenu
        var selectedIndex: Int?
        init(request: Request, webView: WKWebView, menu: NSMenu) {
            self.request = request; self.webView = webView; page = webView.url; self.menu = menu
        }
    }
    private var presentation: Presentation?
    var activeMenu: NSMenu? { presentation?.menu }

    /// Call only after BrowserWindowController's existing main-frame, exact
    /// trusted-origin and root-webView checks. Authentication windows never call.
    func receive(_ body: [String: Any], from webView: WKWebView) {
        if body["type"] as? String == "selectCancel" {
            if let id = body["requestId"] as? String, presentation?.request.id == id { cancel() }
            return
        }
        guard let request = Request(body) else { return }
        cancel()
        let menu = makeMenu(for: request)
        let current = Presentation(request: request, webView: webView, menu: menu)
        presentation = current
        // Wait until the originating DOM pointer/key handler has prevented the
        // WebKit picker. AppKit then owns menu tracking, type-ahead, AX and Escape.
        Task { @MainActor [weak self, weak current] in
            guard let self, let current, presentation === current,
                  let view = current.webView, let window = view.window, window.isVisible,
                  window.attachedSheet == nil, view.url == current.page else {
                if let self, let current { self.finish(current, index: nil) }
                return
            }
            let selected = request.selectedIndex >= 0 ? menu.item(at: request.selectedIndex) : nil
            menu.minimumWidth = min(600, request.anchor.width * view.bounds.width / request.viewport.width)
            _ = menu.popUp(positioning: selected, at: request.point(in: view.bounds, flipped: view.isFlipped), in: view)
            finish(current, index: current.selectedIndex)
        }
    }

    func makeMenu(for request: Request) -> NSMenu {
        let menu = NSMenu(title: request.label)
        menu.autoenablesItems = false
        menu.allowsContextMenuPlugIns = false
        for (index, option) in request.options.enumerated() {
            let item = NSMenuItem(title: option.title, action: #selector(choose(_:)), keyEquivalent: "")
            item.tag = index
            item.target = self
            item.isEnabled = !option.disabled
            item.state = request.selectedIndex == index ? .on : .off
            menu.addItem(item)
        }
        return menu
    }

    @objc private func choose(_ item: NSMenuItem) {
        guard let current = presentation, item.menu === current.menu,
              current.request.options.indices.contains(item.tag), !current.request.options[item.tag].disabled else { return }
        current.selectedIndex = item.tag
    }

    /// Call before document navigation, recovery, or a native window close.
    func cancel() {
        guard let current = presentation else { return }
        current.menu.cancelTrackingWithoutAnimation()
        finish(current, index: nil)
    }

    private func finish(_ current: Presentation, index: Int?) {
        guard presentation === current else { return }
        presentation = nil
        guard let view = current.webView, view.url == current.page else { return }
        let result: [String: Any] = ["requestId": current.request.id, "selectedIndex": index.map { $0 as Any } ?? NSNull()]
        guard let data = try? JSONSerialization.data(withJSONObject: result), let json = String(data: data, encoding: .utf8) else { return }
        view.evaluateJavaScript("window.dispatchEvent(new CustomEvent('connect:mac-select-result', { detail: \(json) }))", completionHandler: nil)
    }
}
