import AppKit
import Foundation
import UserNotifications

struct NativeNotification: Sendable, Equatable {
    let id: String
    let userID: String
    let title: String
    let body: String
    let url: String
    let companyID: String?

    init?(_ value: [String: Any]) {
        guard let id = Self.uuid(value["id"]), let user = Self.uuid(value["userId"]),
              let title = value["title"] as? String, !title.isEmpty, title.count <= 120,
              let body = value["body"] as? String, body.count <= 500,
              let url = value["url"] as? String, Self.safePath(url) else { return nil }
        if let company = value["companyId"], !(company is NSNull), Self.uuid(company) == nil { return nil }
        self.id = id; userID = user; self.title = title; self.body = body; self.url = url
        companyID = Self.uuid(value["companyId"])
    }

    var payload: [String: Any] {
        ["type": "open", "id": id, "userId": userID, "url": url, "companyId": companyID as Any? ?? NSNull()]
    }

    static func uuid(_ value: Any?) -> String? {
        guard let text = value as? String, text.count == 36, UUID(uuidString: text) != nil else { return nil }
        return text.lowercased()
    }

    static func safePath(_ path: String) -> Bool {
        guard path.count <= 300, path.hasPrefix("/"), !path.contains("%"), !path.contains("\\"),
              !path.contains("#"), let parts = URLComponents(string: path), parts.host == nil, parts.scheme == nil else { return false }
        let query = parts.queryItems ?? []
        let pieces = parts.path.split(separator: "/").map(String.init)
        guard parts.path == "/" + pieces.joined(separator: "/") else { return false }
        if pieces == ["messages"] {
            return query.isEmpty || (query.count == 1 && ["conversation", "personal", "company"].contains(query[0].name) && uuid(query[0].value) != nil)
        }
        if pieces.count == 3, pieces[0] == "messages", pieces[1] == "company", uuid(pieces[2]) != nil { return query.isEmpty }
        if pieces.count == 2, pieces[0] == "posts", uuid(pieces[1]) != nil {
            return query.isEmpty || (query.count == 1 && query[0].name == "comment" && uuid(query[0].value) != nil)
        }
        if pieces.count == 2, pieces[0] == "company", (pieces[1] == "profile" || uuid(pieces[1]) != nil) { return query.isEmpty }
        if pieces == ["account", "updates"] { return query.isEmpty }
        if pieces.count == 2, pieces[0] == "join", pieces[1].count <= 160,
           pieces[1].range(of: "^[a-zA-Z0-9][a-zA-Z0-9_-]+$", options: .regularExpression) != nil { return query.isEmpty }
        return false
    }
}

@MainActor
protocol NativeNotificationDelivering: AnyObject {
    var onOpen: ((NativeNotification) -> Void)? { get set }
    var shouldPresent: ((NativeNotification) -> Bool)? { get set }
    func permission() async -> String
    func requestPermission() async throws -> Bool
    func show(_ notice: NativeNotification) async throws
    func clear()
    func remove(_ id: String)
}

@MainActor
final class NativeNotificationCoordinator {
    // The page receives capability only. Permission requests use a separate
    // isolated world, so page script cannot forge a native user-gesture flag.
    static let capabilityScript = "if (!window.opener) Object.defineProperty(window, '__CONNECT_DESKTOP_NOTIFICATIONS__', {value:true, configurable:false});"
    static let permissionScript = """
    (() => {
      let gestureAt = 0;
      const credit = event => {
        if (event.isTrusted && (event.type === 'click' || event.key === 'Enter' || event.key === ' ')) gestureAt = performance.now();
      };
      document.addEventListener('click', credit, true);
      document.addEventListener('keydown', credit, true);
      window.addEventListener('connect:native-notification-permission', event => {
        const id = event.detail && event.detail.requestId;
        if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return;
        const permitted = gestureAt > 0 && performance.now() - gestureAt < 1000;
        gestureAt = 0;
        window.webkit.messageHandlers.connectNotificationPermission.postMessage({type:'notificationPermission', requestId:id, permitted});
      });
    })();
    """

    private let delivery: NativeNotificationDelivering
    private let defaults: UserDefaults
    private(set) var owner: String?
    private var generation = 0
    private var permissionPending = false
    private var inFlight: Set<String> = []
    var onEvent: (([String: Any]) -> Void)?
    var onActivate: (() -> Void)?

    init(delivery: NativeNotificationDelivering, defaults: UserDefaults = .standard) {
        self.delivery = delivery; self.defaults = defaults
        delivery.onOpen = { [weak self] notice in self?.open(notice) }
        delivery.shouldPresent = { [weak self] notice in
            guard let self else { return false }
            return notice.userID == self.owner && self.defaults.bool(forKey: self.preferenceKey(notice.userID)) && !self.readIDs(notice.userID).contains(notice.id)
        }
        // A new process has no verified owner until the trusted page reports it.
        delivery.clear()
    }

    func setOwner(_ value: String?) {
        guard value != owner else { return }
        generation += 1; owner = value; inFlight.removeAll(); delivery.clear()
    }

    func receive(_ value: [String: Any]) {
        switch value["type"] as? String {
        case "notificationOwner":
            if value["userId"] == nil || value["userId"] is NSNull { setOwner(nil) }
            else if let id = NativeNotification.uuid(value["userId"]) { setOwner(id) }
        case "notificationStatus":
            guard let id = NativeNotification.uuid(value["requestId"]) else { return }
            Task { await sendStatus(id: id) }
        case "notificationDisable":
            guard let id = NativeNotification.uuid(value["requestId"]) else { return }
            if let owner { defaults.set(false, forKey: preferenceKey(owner)) }
            generation += 1; inFlight.removeAll(); delivery.clear()
            Task { await sendStatus(id: id) }
        case "notificationRead":
            guard let user = NativeNotification.uuid(value["userId"]), user == owner,
                  let values = value["ids"] as? [String], values.count <= 500 else { return }
            let ids = values.compactMap { NativeNotification.uuid($0) }
            guard ids.count == values.count else { return }
            var read = readIDs(user)
            var displayed = seen(user)
            for id in ids {
                if !read.contains(id) { read.append(id) }
                if !displayed.contains(id) { displayed.append(id) }
                delivery.remove(id)
            }
            defaults.set(Array(read.suffix(512)), forKey: readKey(user))
            defaults.set(Array(displayed.suffix(512)), forKey: seenKey(user))
        case "notificationShow":
            guard let notice = NativeNotification(value) else { return }
            Task { await show(notice) }
        default: break // In particular, page-world permission messages are ignored.
        }
    }

    func requestPermission(id: String, trustedGesture: Bool) async {
        guard let requestID = NativeNotification.uuid(id) else { return }
        guard trustedGesture, let owner, !permissionPending else {
            await sendStatus(id: requestID, error: "Choose Enable notifications to allow alerts on this Mac.")
            return
        }
        permissionPending = true
        defer { permissionPending = false }
        let revision = generation
        do {
            let granted = try await delivery.requestPermission()
            guard revision == generation, owner == self.owner else { return }
            defaults.set(granted, forKey: preferenceKey(owner))
            await sendStatus(id: requestID)
        } catch {
            guard revision == generation else { return }
            await sendStatus(id: requestID, error: "macOS couldn’t enable notifications. Try again or check System Settings → Notifications.")
        }
    }

    func sendStatus(id: String? = nil, error: String? = nil) async {
        let revision = generation
        let permission = await delivery.permission()
        guard revision == generation else { return }
        var value: [String: Any] = ["type": "status", "permission": permission, "enabled": permission == "granted" && owner.map { defaults.bool(forKey: preferenceKey($0)) } == true]
        if let id { value["requestId"] = id }
        if let error { value["error"] = error }
        onEvent?(value)
    }

    func show(_ notice: NativeNotification) async {
        guard notice.userID == owner, defaults.bool(forKey: preferenceKey(notice.userID)),
              !inFlight.contains(notice.id), !seen(notice.userID).contains(notice.id) else { return }
        let revision = generation
        inFlight.insert(notice.id)
        defer { inFlight.remove(notice.id) }
        guard await delivery.permission() == "granted", generation == revision, owner == notice.userID, !readIDs(notice.userID).contains(notice.id) else { return }
        do {
            try await delivery.show(notice)
            guard generation == revision, owner == notice.userID, !readIDs(notice.userID).contains(notice.id) else { delivery.remove(notice.id); return }
            var ids = seen(notice.userID); ids.append(notice.id)
            defaults.set(Array(ids.suffix(512)), forKey: seenKey(notice.userID))
        } catch {
            guard generation == revision else { return }
            await sendStatus(error: "macOS couldn’t show this alert. Your activity is still in Connect.")
        }
    }

    private func open(_ notice: NativeNotification) {
        guard notice.userID == owner, defaults.bool(forKey: preferenceKey(notice.userID)), !readIDs(notice.userID).contains(notice.id) else { return }
        delivery.remove(notice.id)
        onActivate?()
        onEvent?(notice.payload)
    }

    private func preferenceKey(_ user: String) -> String { "connect.notifications.enabled.\(user)" }
    private func readKey(_ user: String) -> String { "connect.notifications.read.\(user)" }
    private func readIDs(_ user: String) -> [String] { defaults.stringArray(forKey: readKey(user)) ?? [] }
    private func seenKey(_ user: String) -> String { "connect.notifications.seen.\(user)" }
    private func seen(_ user: String) -> [String] { defaults.stringArray(forKey: seenKey(user)) ?? [] }
}

@MainActor
final class SystemNotificationDelivery: NSObject, NativeNotificationDelivering, UNUserNotificationCenterDelegate {
    var onOpen: ((NativeNotification) -> Void)?
    var shouldPresent: ((NativeNotification) -> Bool)?
    private let center: UNUserNotificationCenter
    override init() {
        center = .current()
        super.init()
        center.delegate = self
    }
    func permission() async -> String {
        switch await center.notificationSettings().authorizationStatus {
        case .authorized, .provisional: return "granted"
        case .notDetermined: return "default"
        default: return "denied"
        }
    }
    func requestPermission() async throws -> Bool { try await center.requestAuthorization(options: [.alert, .sound]) }
    func show(_ notice: NativeNotification) async throws {
        let content = UNMutableNotificationContent()
        content.title = notice.title; content.body = notice.body; content.sound = .default
        var payload = notice.payload; payload["title"] = notice.title; payload["body"] = notice.body
        if notice.companyID == nil { payload.removeValue(forKey: "companyId") }
        content.userInfo = payload
        try await center.add(UNNotificationRequest(identifier: notice.id, content: content, trigger: nil))
    }
    func clear() { center.removeAllPendingNotificationRequests(); center.removeAllDeliveredNotifications() }
    func remove(_ id: String) { center.removePendingNotificationRequests(withIdentifiers: [id]); center.removeDeliveredNotifications(withIdentifiers: [id]) }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping @Sendable (UNNotificationPresentationOptions) -> Void) {
        // Recheck the owner after queueing; logout may have happened in between.
        guard let notice = NativeNotification(notification.request.content.userInfo as? [String: Any] ?? [:]) else { completionHandler([]); return }
        Task { @MainActor [weak self] in
            guard self?.shouldPresent?(notice) == true else { completionHandler([]); return }
            completionHandler([.banner, .list, .sound])
        }
    }
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping @Sendable () -> Void) {
        let notice = NativeNotification(response.notification.request.content.userInfo as? [String: Any] ?? [:])
        let isOpen = response.actionIdentifier == UNNotificationDefaultActionIdentifier
        Task { @MainActor [weak self] in
            if isOpen, let notice { self?.onOpen?(notice) }
            completionHandler()
        }
    }
}
