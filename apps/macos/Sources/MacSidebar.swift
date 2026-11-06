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
        setAccessibilityElement(false)
        setAccessibilityLabel("Connect sidebar")

        let brand: NSView
        if let image = NSImage(named: "ConnectWordmark") {
            brand = WordmarkView(image: image)
        } else {
            let wordmark = NSTextField(labelWithString: "Connect")
            wordmark.font = .systemFont(ofSize: 23, weight: .semibold)
            wordmark.textColor = ConnectAppearance.text
            brand = wordmark
        }

        let navigation = NSStackView()
        navigation.orientation = .vertical
        navigation.alignment = .leading
        navigation.spacing = 3
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
            button.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
            button.imagePosition = .imageLeading
            button.imageHugsTitle = true
            button.toolTip = title
            button.setAccessibilityLabel(title)
            button.target = self
            button.action = #selector(navigate(_:))
            button.identifier = NSUserInterfaceItemIdentifier(path)
            navigation.addArrangedSubview(button)
            button.widthAnchor.constraint(equalTo: navigation.widthAnchor).isActive = true
            button.heightAnchor.constraint(equalToConstant: 34).isActive = true
            routeButtons.append((path, button))
        }

        let separator = NSBox()
        separator.boxType = .separator
        accountButton.image = NSImage(systemSymbolName: "person.crop.circle", accessibilityDescription: nil)
        accountButton.symbolConfiguration = NSImage.SymbolConfiguration(pointSize: 23, weight: .regular)
        accountButton.imagePosition = .imageLeading
        accountButton.imageHugsTitle = true
        accountButton.cell?.usesSingleLineMode = false
        accountButton.target = self
        accountButton.action = #selector(account)

        for view in [brand, navigation, separator, accountButton] {
            view.translatesAutoresizingMaskIntoConstraints = false
            addSubview(view)
        }
        NSLayoutConstraint.activate([
            brand.topAnchor.constraint(equalTo: safeAreaLayoutGuide.topAnchor, constant: 16),
            brand.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 20),
            brand.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -18),
            brand.widthAnchor.constraint(equalToConstant: 132),
            brand.heightAnchor.constraint(equalToConstant: 28),

            navigation.topAnchor.constraint(equalTo: brand.bottomAnchor, constant: 22),
            navigation.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            navigation.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),

            separator.topAnchor.constraint(greaterThanOrEqualTo: navigation.bottomAnchor, constant: 24),
            separator.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 18),
            separator.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -18),
            separator.bottomAnchor.constraint(equalTo: accountButton.topAnchor, constant: -8),
            accountButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            accountButton.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            accountButton.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -12),
            accountButton.heightAnchor.constraint(equalToConstant: 48),
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
            .foregroundColor: ConnectAppearance.text,
            .paragraphStyle: paragraph,
        ])
        if name != nil {
            text.append(NSAttributedString(string: "\n" + (company ?? "Personal account"), attributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: ConnectAppearance.secondaryText,
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

/// Keep the supplied transparent artwork. Only its neutral black lettering
/// changes to Connect's pale text color in dark mode; the orange symbol and
/// original file remain untouched.
@MainActor
private final class WordmarkView: NSView {
    private let sourceImage: NSImage
    private let darkImage: NSImage
    private let imageView: NSImageView

    init(image: NSImage) {
        sourceImage = image
        darkImage = Self.darkWordmark(from: image) ?? image
        imageView = NSImageView(image: image)
        super.init(frame: .zero)
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.setAccessibilityLabel("Connect")
        imageView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(imageView)
        NSLayoutConstraint.activate([
            imageView.leadingAnchor.constraint(equalTo: leadingAnchor),
            imageView.trailingAnchor.constraint(equalTo: trailingAnchor),
            imageView.topAnchor.constraint(equalTo: topAnchor),
            imageView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        updateImage()
    }
    required init?(coder: NSCoder) { fatalError("Use init(image:)") }

    private func updateImage() {
        imageView.image = effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? darkImage : sourceImage
    }

    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        updateImage()
    }

    private static func darkWordmark(from image: NSImage) -> NSImage? {
        guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: source.width, height: source.height,
                                      bitsPerComponent: 8, bytesPerRow: source.width * 4,
                                      space: colorSpace,
                                      bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue),
              let bytes = context.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
        context.draw(source, in: CGRect(x: 0, y: 0, width: source.width, height: source.height))
        for offset in stride(from: 0, to: source.width * source.height * 4, by: 4) {
            let alpha = Int(bytes[offset + 3])
            guard alpha > 0 else { continue }
            let channels = (Int(bytes[offset]), Int(bytes[offset + 1]), Int(bytes[offset + 2]))
            let maximum = max(channels.0, channels.1, channels.2)
            let minimum = min(channels.0, channels.1, channels.2)
            // Work in premultiplied space so anti-aliased edges retain their
            // exact opacity, and colored artwork never becomes a template.
            guard maximum * 5 <= alpha, (maximum - minimum) * 20 <= alpha else { continue }
            bytes[offset] = UInt8((242 * alpha + 127) / 255)
            bytes[offset + 1] = UInt8((247 * alpha + 127) / 255)
            bytes[offset + 2] = UInt8((252 * alpha + 127) / 255)
        }
        guard let result = context.makeImage() else { return nil }
        return NSImage(cgImage: result, size: image.size)
    }
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
    override func viewDidChangeEffectiveAppearance() { super.viewDidChangeEffectiveAppearance(); updateAppearance() }

    private func updateAppearance() {
        let fill = isCurrentRoute
            ? ConnectAppearance.selection
            : (pointerInside ? ConnectAppearance.text.withAlphaComponent(0.06) : NSColor.clear)
        effectiveAppearance.performAsCurrentDrawingAppearance { layer?.backgroundColor = fill.cgColor }
        contentTintColor = isCurrentRoute ? ConnectAppearance.selectionText : ConnectAppearance.text
        needsDisplay = true
    }
}

@MainActor
private final class SidebarButtonCell: NSButtonCell {
    override func drawingRect(forBounds rect: NSRect) -> NSRect {
        super.drawingRect(forBounds: rect).insetBy(dx: 10, dy: 0)
    }
}
