import AppKit
import Foundation

@main
struct NativeSelectTests {
    @MainActor static func main() {
        var checks = 0
        func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
        let coordinator = NativeSelectCoordinator()
        let id = UUID().uuidString
        let valid: [String: Any] = [
            "type": "select", "requestId": id, "label": "Company type", "selectedIndex": 1,
            "options": [["title": "All business types", "disabled": false], ["title": "Installer", "disabled": false], ["title": "Unavailable", "disabled": true]],
            "anchor": ["x": 20, "y": 100, "width": 180, "height": 36, "viewportWidth": 1000, "viewportHeight": 800],
        ]
        let request = NativeSelectCoordinator.Request(valid)!
        let menu = coordinator.makeMenu(for: request)
        check(menu.title == "Company type", "Native menu accessible title")
        check(menu.items.map(\.title) == ["All business types", "Installer", "Unavailable"], "All option labels preserved")
        check(menu.item(at: 1)?.state == .on && menu.item(at: 0)?.state == .off, "Selected option uses native checkmark")
        check(menu.item(at: 2)?.isEnabled == false && menu.item(at: 0)?.isEnabled == true, "Disabled option remains disabled")
        check(!menu.autoenablesItems, "AppKit never overrides server/UI disabled state")
        check(menu.items.map(\.tag) == [0, 1, 2], "Menu sends only original option indices")
        check(menu.items.allSatisfy { $0.target === coordinator }, "Actions target the bounded coordinator")
        let bounds = CGRect(x: 0, y: 0, width: 500, height: 400)
        check(request.point(in: bounds, flipped: true) == CGPoint(x: 10, y: 50), "Zoomed WebKit anchor uses viewport ratio")
        check(request.point(in: bounds, flipped: false) == CGPoint(x: 10, y: 350), "Unflipped AppKit coordinates")
        for (key, invalid) in [("requestId", "not-an-id" as Any), ("selectedIndex", 3 as Any), ("selectedIndex", true as Any), ("selectedIndex", 1.5 as Any), ("label", String(repeating: "a", count: 161) as Any), ("options", [] as Any)] {
            var body = valid; body[key] = invalid
            check(NativeSelectCoordinator.Request(body) == nil, "Reject malformed \(key)")
        }
        for (key, invalid) in [("viewportWidth", 0.0), ("height", -2.0), ("x", Double.infinity), ("x", 1000.0), ("y", -40.0)] {
            var body = valid
            var anchor = valid["anchor"] as! [String: Any]; anchor[key] = invalid; body["anchor"] = anchor
            check(NativeSelectCoordinator.Request(body) == nil, "Reject unsafe anchor \(key)")
        }
        var tooMany = valid
        tooMany["options"] = Array(repeating: ["title": "Option", "disabled": false], count: 513)
        check(NativeSelectCoordinator.Request(tooMany) == nil, "Bound menu allocation")
        var text = valid
        text["options"] = [["title": "A\nB", "disabled": false], ["title": "C", "disabled": false]]
        check(NativeSelectCoordinator.Request(text)?.options[0].title == "A B", "Strip menu control characters")
        coordinator.cancel()
        check(coordinator.activeMenu == nil, "Cancellation without a menu is harmless")
        print("Native select: \(checks) checks passed")
    }
}
