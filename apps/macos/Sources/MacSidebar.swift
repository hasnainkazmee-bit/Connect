import AppKit

/// The Mac workspace stays outside the web view, so navigation and account
/// controls remain in a predictable place while Connect loads or changes pages.
@MainActor
final class MacSidebar: NSView {
    var onNavigate: ((String) -> Void)?
    var onCompose: (() -> Void)?
    var onAccount: (() -> Void)?

    private let accountButton = SidebarButton()
    private var routeButtons: [(path: String, button: SidebarButton)] = []

    override var intrinsicContentSize: NSSize {
        NSSize(width: 224, height: NSView.noIntrinsicMetric)
    }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        configure()
        setRoute("/")
        setAccount(name: nil, company: nil, canPublish: false)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        configure()
        setRoute("/")
        setAccount(name: nil, company: nil, canPublish: false)
    }

    private func configure() {
        wantsLayer = true
        layer?.backgroundColor = NSColor(srgbRed: 0.93, green: 0.955, blue: 0.98, alpha: 1).cgColor
        setAccessibilityElement(false)
        setAccessibilityLabel("Connect sidebar")

        let brand: NSView
        if let image = NSImage(named: "ConnectWordmark") {
            let wordmark = NSImageView(image: image)
            wordmark.imageScaling = .scaleProportionallyUpOrDown
            wordmark.imageAlignment = .alignLeft
            wordmark.setAccessibilityLabel("Connect")
            brand = wordmark
        } else {
            let wordmark = NSTextField(labelWithString: "Connect")
            wordmark.font = .systemFont(ofSize: 23, weight: .semibold)
            wordmark.textColor = .labelColor
            brand = wordmark
        }

        let section = NSTextField(labelWithString: "Workspace")
        section.font = .systemFont(ofSize: 11, weight: .semibold)
        section.textColor = .secondaryLabelColor
        section.setAccessibilityElement(false)

        let navigation = NSStackView()
        navigation.orientation = .vertical
        navigation.alignment = .leading
        navigation.spacing = 4
        navigation.detachesHiddenViews = true
        for (title, path, symbol) in [
            ("Home", "/", "house"),
            ("Directory", "/directory", "building.2"),
            ("My Network", "/network", "person.2"),
            ("Messages", "/messages", "bubble.left.and.bubble.right"),
        ] {
            let button = SidebarButton()
            button.title = title
            button.font = .systemFont(ofSize: 13)
            button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 15, weight: .regular)
            button.imagePosition = .imageLeading
            button.imageHugsTitle = true
            button.toolTip = title
            button.setAccessibilityLabel(title)
            button.target = self
            button.action = #selector(navigate(_:))
            button.identifier = NSUserInterfaceItemIdentifier(path)
            navigation.addArrangedSubview(button)
            button.widthAnchor.constraint(equalTo: navigation.widthAnchor).isActive = true
            button.heightAnchor.constraint(equalToConstant: 36).isActive = true
            routeButtons.append((path, button))
        }

        let separator = NSBox()
        separator.boxType = .separator
        accountButton.image = NSImage(systemSymbolName: "person.crop.circle", accessibilityDescription: nil)
        accountButton.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 25, weight: .regular)
        accountButton.imagePosition = .imageLeading
        accountButton.imageHugsTitle = true
        accountButton.cell?.usesSingleLineMode = false
        accountButton.target = self
        accountButton.action = #selector(account)

        for view in [brand, section, navigation, separator, accountButton] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            brand.topAnchor.constraint(equalTo: topAnchor, constant: 24),
            brand.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 22),
            brand.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -22),
            brand.heightAnchor.constraint(equalToConstant: 34),

            section.topAnchor.constraint(equalTo: brand.bottomAnchor, constant: 24),
            section.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            section.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -14),
            navigation.topAnchor.constraint(equalTo: section.bottomAnchor, constant: 8),
            navigation.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            navigation.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),

            separator.topAnchor.constraint(greaterThanOrEqualTo: navigation.bottomAnchor, constant: 24),
            separator.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18),
            separator.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -18),
            separator.bottomAnchor.constraint(equalTo: accountButton.topAnchor, constant: -8),
            accountButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            accountButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            accountButton.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            accountButton.heightAnchor.constraint(equalToConstant: 56),
        ])
    }

    func setRoute(_ path: String) {
        let pathname = URLComponents(string: path)?.path ?? path
        for item in routeButtons {
            let selected = pathname == item.path || (item.path != "/" && pathname.hasPrefix(item.path + "/"))
            item.button.isCurrentRoute = selected
            item.button.setAccessibilityHelp(selected ? "Current page" : nil)
        }
    }

    func setNetworkVisible(_ visible: Bool) {
        routeButtons.first(where: { $0.path == "/network" })?.button.isHidden = !visible
    }

    func setAccount(name: String?, company: String?, canPublish: Bool) {
        let name = Self.displayText(name)
        let company = Self.displayText(company)
        let title = name ?? "Sign in"
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        paragraph.lineSpacing = 3
        let text = NSMutableAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .medium),
            .foregroundColor: NSColor.labelColor,
            .paragraphStyle: paragraph,
        ])
        if name != nil {
            text.append(NSAttributedString(string: "\n" + (company ?? "Personal account"), attributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: NSColor.secondaryLabelColor,
                .paragraphStyle: paragraph,
            ]))
        }
        accountButton.attributedTitle = text
        accountButton.setAccessibilityLabel(name == nil ? "Sign in to Connect" : "Account: " + title + (company.map { ", " + $0 } ?? ""))
        accountButton.toolTip = name == nil ? "Sign in to Connect" : title + (company.map { " · " + $0 } ?? "") + " — Account settings"
    }

    private static func displayText(_ value: String?) -> String? {
        guard let value else { return nil }
        let result = value.split(whereSeparator: { $0.isNewline }).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? nil : result
    }

    @objc private func navigate(_ sender: NSButton) {
        guard let path = sender.identifier?.rawValue else { return }
        onNavigate?(path)
    }
    @objc private func account() { onAccount?() }
}

/// A native button retains macOS keyboard/VoiceOver behavior. Only its spacing
/// and quiet selection background differ from the default borderless control.
@MainActor
private final class SidebarButton: NSButton {
    var isCurrentRoute = false { didSet { updateAppearance() } }
    private var pointerInside = false
    private var pointerTracking: NSTrackingArea?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        configure()
    }
    required init?(coder: NSCoder) { super.init(coder: coder); configure() }

    private func configure() {
        cell = SidebarButtonCell(textCell: "")
        setButtonType(.momentaryChange)
        isBordered = false
        alignment = .left
        imageScaling = .scaleProportionallyDown
        cell?.lineBreakMode = .byTruncatingTail
        focusRingType = .exterior
        wantsLayer = true
        layer?.cornerRadius = 8
        updateAppearance()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let pointerTracking { removeTrackingArea(pointerTracking) }
        let tracking = NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect], owner: self)
        addTrackingArea(tracking)
        pointerTracking = tracking
    }
    override func mouseEntered(with event: NSEvent) { pointerInside = true; updateAppearance() }
    override func mouseExited(with event: NSEvent) { pointerInside = false; updateAppearance() }

    private func updateAppearance() {
        let fill = isCurrentRoute
            ? NSColor(srgbRed: 1, green: 0.42, blue: 0.043, alpha: 0.14)
            : (pointerInside ? NSColor.labelColor.withAlphaComponent(0.045) : NSColor.clear)
        layer?.backgroundColor = fill.cgColor
        contentTintColor = isCurrentRoute ? NSColor(srgbRed: 0.43, green: 0.22, blue: 0.08, alpha: 1) : .labelColor
        needsDisplay = true
    }
}

@MainActor
private final class SidebarButtonCell: NSButtonCell {
    override func drawingRect(forBounds rect: NSRect) -> NSRect {
        super.drawingRect(forBounds: rect).insetBy(dx: 10, dy: 0)
    }
}
