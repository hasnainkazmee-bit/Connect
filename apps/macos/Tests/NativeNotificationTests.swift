import Foundation

@MainActor
private final class FakeDelivery: NativeNotificationDelivering {
    var onOpen: ((NativeNotification) -> Void)?
    var shouldPresent: ((NativeNotification) -> Bool)?
    var status = "default"
    var requests = 0
    var shown: [NativeNotification] = []
    var removed: [String] = []
    var clears = 0
    var onShow: (() -> Void)?
    var onPermission: (() -> Void)?
    var fail = false
    func permission() async -> String { status }
    func requestPermission() async throws -> Bool { requests += 1; status = "granted"; onPermission?(); return true }
    func show(_ notice: NativeNotification) async throws {
        if fail { throw CocoaError(.fileReadUnknown) }
        shown.append(notice); onShow?()
    }
    func clear() { clears += 1 }
    func remove(_ id: String) { removed.append(id) }
}

@main
struct NativeNotificationTests {
    @MainActor static func main() async {
        var checks = 0
        func check(_ value: Bool, _ label: String) { precondition(value, label); checks += 1 }
        let a = UUID().uuidString.lowercased(), b = UUID().uuidString.lowercased(), id = UUID().uuidString.lowercased()
        let suite = "connect.notification-test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let delivery = FakeDelivery()
        let subject = NativeNotificationCoordinator(delivery: delivery, defaults: defaults)
        var events: [[String: Any]] = []
        var activations = 0
        subject.onEvent = { events.append($0) }
        subject.onActivate = { activations += 1 }
        let value: [String: Any] = ["id": id, "userId": a, "title": "Connect", "body": "New activity", "url": "/posts/\(id)?comment=\(b)", "companyId": b]
        let notice = NativeNotification(value)!
        check(notice.companyID == b && notice.payload["url"] as? String == value["url"] as? String, "Preserve safe context")
        for path in ["/messages", "/messages?conversation=\(id)", "/messages?personal=\(id)", "/messages?company=\(id)", "/messages/company/\(id)", "/company/\(id)", "/company/profile", "/account/updates", "/join/brighter-solar-team-123"] {
            check(NativeNotification.safePath(path), "Allow notification route \(path)")
        }
        for path in ["//evil.test/messages", "https://evil.test", "/api/session", "/messages?company=wrong", "/messages?company=\(id)&next=/api", "/posts/\(id)#external", "/messages%3Fcompany=x", "/messages/", "/messages//company/\(id)", "/join/a/../b", "/account/updates?url=evil", "/company/admin"] {
            check(!NativeNotification.safePath(path), "Reject unsafe route \(path)")
        }
        for (key, invalid) in [("id", "bad" as Any), ("userId", true as Any), ("companyId", "bad" as Any), ("title", String(repeating: "x", count: 121) as Any), ("body", String(repeating: "x", count: 501) as Any)] {
            var bad = value; bad[key] = invalid
            check(NativeNotification(bad) == nil, "Reject malformed \(key)")
        }
        await subject.show(notice)
        check(delivery.shown.isEmpty, "No owner cannot show")
        subject.setOwner(a)
        await subject.requestPermission(id: id, trustedGesture: false)
        check(delivery.requests == 0, "Forged gesture cannot request system permission")
        subject.receive(["type": "notificationPermission", "requestId": id, "permitted": true])
        check(delivery.requests == 0, "Page-world permission message ignored")
        await subject.show(notice)
        check(delivery.shown.isEmpty, "Opt-in required")
        await subject.requestPermission(id: id, trustedGesture: true)
        check(delivery.requests == 1 && events.last?["enabled"] as? Bool == true, "Trusted opt-in stores enabled permission")
        await subject.show(notice); await subject.show(notice)
        check(delivery.shown.count == 1, "Stable notification UUID dedupes")
        check(delivery.shouldPresent?(notice) == true, "Current owner may present")
        delivery.onOpen?(notice)
        check(activations == 1 && events.last?["type"] as? String == "open", "Tap activates window and passes guarded route to web")
        subject.receive(["type": "notificationRead", "userId": b, "ids": [notice.id]])
        check(delivery.shouldPresent?(notice) == true, "Another account cannot clear this owner’s notification")
        subject.receive(["type": "notificationRead", "userId": a, "ids": [notice.id]])
        check(delivery.shouldPresent?(notice) == false && delivery.removed.contains(notice.id), "Confirmed read withdraws the system alert")
        delivery.onOpen?(notice)
        check(activations == 1, "Read notification tap cannot reopen stale context")
        subject.setOwner(b)
        check(delivery.shouldPresent?(notice) == false && delivery.clears >= 3, "Account switch clears and rejects queued old preview")
        delivery.onOpen?(notice)
        await subject.show(notice)
        check(activations == 1 && delivery.shown.count == 1, "Old account taps and messages rejected")
        subject.setOwner(a)
        await subject.show(notice)
        check(delivery.shown.count == 1, "Dedupe survives returning account")
        var next = value; next["id"] = UUID().uuidString.lowercased()
        let lateNotice = NativeNotification(next)!
        delivery.onShow = { subject.setOwner(nil) }
        await subject.show(lateNotice)
        check(delivery.removed.contains(lateNotice.id), "Logout during async add removes late notification")
        delivery.onShow = nil
        subject.setOwner(a)
        next["id"] = UUID().uuidString.lowercased()
        let readDuringAdd = NativeNotification(next)!
        delivery.onShow = { subject.receive(["type": "notificationRead", "userId": a, "ids": [readDuringAdd.id]]) }
        await subject.show(readDuringAdd)
        delivery.onShow = nil
        check(delivery.removed.filter { $0 == readDuringAdd.id }.count == 2, "Read during async add removes its late completion")
        await subject.show(readDuringAdd)
        check(delivery.shown.count == 3, "Read IDs reject queued provider replay")
        subject.setOwner(a)
        delivery.onPermission = { subject.setOwner(b) }
        await subject.requestPermission(id: id, trustedGesture: true)
        await subject.sendStatus()
        check(events.last?["enabled"] as? Bool == false, "Permission result cannot enable switched account")
        delivery.onPermission = nil
        subject.setOwner(a)
        subject.receive(["type": "notificationDisable", "requestId": id])
        await subject.show(lateNotice)
        check(delivery.shown.count == 3 && delivery.shouldPresent?(notice) == false, "Disable cancels previews and further delivery")
        print("Native notifications: \(checks) checks passed (fake delivery; no OS prompt)")
    }
}
