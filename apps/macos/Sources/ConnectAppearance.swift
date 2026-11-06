import AppKit

/// Appearance is a device preference only. The same palette is used by the
/// Connect web workspace; no account or authentication state is stored here.
@MainActor
enum ConnectAppearance {
    enum Choice: String, CaseIterable {
        case system, light, dark

        var title: String {
            switch self {
            case .system: "System"
            case .light: "Light"
            case .dark: "Dark"
            }
        }
    }

    private static let preferenceKey = "connectAppearance"

    static var selectedChoice: Choice {
        UserDefaults.standard.string(forKey: preferenceKey).flatMap(Choice.init(rawValue:)) ?? .system
    }

    static func applySavedChoice() {
        apply(selectedChoice)
    }

    static func setChoice(_ choice: Choice) {
        UserDefaults.standard.set(choice.rawValue, forKey: preferenceKey)
        apply(choice)
    }

    private static func apply(_ choice: Choice) {
        switch choice {
        case .system: NSApp.appearance = nil
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        }
    }

    static let windowBackground = color("windowBackground", light: 0xF2F7FC, dark: 0x1C2D3A)
    static let contentBackground = color("contentBackground", light: 0xFFFFFF, dark: 0x203342)
    static let chromeTint = color("chromeTint", light: 0xEDF4FA, dark: 0x1C2D3A)
    static let text = color("text", light: 0x203342, dark: 0xF2F7FC)
    static let secondaryText = color("secondaryText", light: 0x586D7F, dark: 0xDBE5ED)
    static let separator = color("separator", light: 0xDBE5ED, dark: 0xDBE5ED, darkAlpha: 0.18)
    static let selection = color("selection", light: 0xFFF0E2, dark: 0xFF6B0B, darkAlpha: 0.18)
    static let selectionText = color("selectionText", light: 0x974100, dark: 0xF2F7FC)
    static let accent = color("accent", light: 0xFF6B0B, dark: 0xFF6B0B)

    private static func color(_ name: String, light: UInt32, dark: UInt32, darkAlpha: CGFloat = 1) -> NSColor {
        NSColor(name: NSColor.Name("Connect." + name)) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            let hex = isDark ? dark : light
            return NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
                           green: CGFloat((hex >> 8) & 0xFF) / 255,
                           blue: CGFloat(hex & 0xFF) / 255,
                           alpha: isDark ? darkAlpha : 1)
        }
    }
}
