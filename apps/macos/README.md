# Connect for macOS

Connect for macOS has a Swift/AppKit shell with a native sidebar, title bar, menus, and workspace controls around live Connect content from `https://connect.sunhubapp.com`. The shared feed, profiles, messages, and publishing workflows remain in WebKit. The unified native title bar aligns its traffic lights and sidebar toggle with the left pane, places Back above the content pane, and keeps notification and compose icons on the right. Both panes begin below the toolbar, so the sidebar logo and controls remain clear of the window buttons. The selected sidebar row supplies workspace context; the duplicate window title is visually hidden and there is no marketing subtitle. The underlying window title still tracks the route for the Window menu and accessibility. Content and workflow improvements arrive through the shared web app; changes to the native host require a new app build. An internet connection is required.

Version 0.1.4 (build 5) supports macOS 13 or later. The default universal build runs on Apple silicon and Intel Macs. It uses the existing Connect artwork without cropping or stretching it. The logo remains transparent in both appearances; dark mode lightens only its neutral lettering, preserving the orange symbol and original asset without a white badge behind it.

## Using the app

Use the native sidebar to move between Home, Directory, My Network, and Messages. When signed out, My Network and Messages first navigate to their destination and then show sign-in, keeping the sidebar selection aligned with the route. The native account/company control opens the existing account and company-switch workflow, preserving the same permissions and membership checks as the web app.

Directory filter dropdowns open native AppKit menus with standard selection, keyboard navigation, and Escape behavior. The web app still owns the filter values and results. Older Mac hosts and ordinary browsers keep their existing dropdowns.

When signed out, Create is disabled with a neutral appearance. Notifications opens sign-in and resumes after authentication. Publishing remains available only to accounts with the required company permissions. An available action clicked during the initial session check is held until that check finishes.

The sidebar and title bar use AppKit's system materials, including the current glass treatment on macOS 26 and the native fallback on earlier supported versions. Connect's controls use the same palette as the web app. Choose **View → Appearance → System, Light, or Dark** to set a saved device preference; changing it updates the native controls and live content without reloading the page.

Connect has its own persistent WebKit session store, separate from Safari. Sunhub sign-in opens in a native child window and returns to Connect. System file pickers handle attachments, and authenticated downloads use a native Save dialog.

Closing the main window hides it while keeping the process and current drafts alive. Click the Dock icon or choose **File → Show Connect** to return. **Quit Connect** ends the process; the app asks before abandoning an active upload, unsaved publisher changes, unsent messages, or a download. A saved session remains subject to the server's normal expiry and sign-out rules.

| Shortcut | Action |
| --- | --- |
| ⌘1–⌘4 | Home, Directory, My Network, Messages |
| ⌘N | Create a post |
| ⌃⌘S | Show / hide the sidebar |
| ⌘R | Reload |
| ⌘[ / ⌘] | Back / Forward |
| ⌘F | Find on the current page |
| ⌘+ / ⌘− / ⌘0 | Zoom in / out / actual size |
| ⌘W / ⌘Q | Close window / quit the app |

This version does not provide native push notifications, offline operation, or an automatic native binary updater. Interface improvements arrive through the live web app; native host upgrades still require a new app build.

## Build with Command Line Tools

Full Xcode is not required for building and packaging. Install Apple's current Command Line Tools if they are missing (`xcode-select --install`). Building requires Swift 6 and the macOS 26 SDK or newer; the development machine uses Swift 6.3.2 and SDK 26.5. The app still targets macOS 13 or later. Each architecture's embedded SDK and deployment target are verified before signing, so an older compatibility setting cannot silently disable the current native appearance.

From the repository root:

```sh
./apps/macos/build.sh
./apps/macos/package.sh --skip-build
```

Or build and package in one command:

```sh
./apps/macos/package.sh
```

The scripts use `swiftc`, `lipo`, `vtool`, `sips`, `iconutil`, `codesign`, `ditto`, `hdiutil`, `pkgbuild`, and `productbuild` supplied by macOS and its developer tools. Compilation uses a writable module cache inside `.build`. Bundle and installer staging uses the system temporary directory, keeping File Provider metadata from synced project folders out of signed archive payloads. No JavaScript package installation or web build is needed to package this live host.

Outputs are ignored by Git:

- `apps/macos/artifacts/Connect.app`
- `apps/macos/artifacts/Connect-0.1.4-macos-universal.pkg`
- `apps/macos/artifacts/Connect-0.1.4-macos-universal.dmg`
- `apps/macos/artifacts/Connect-0.1.4-macos-universal.zip`

For a single architecture, use `--arch arm64` or `--arch x86_64` on either script. The archive filename reflects the actual binary architectures. A failed cross-compile stops the universal build rather than delivering an incomplete universal app. `--skip-build` packages the existing signed app and derives its architecture from that binary.

The bundle includes the unmodified transparent Connect wordmark as `ConnectWordmark.png`; its contents are covered by the build fingerprint. The Mac layout adapter is deployed with the shared web app in `apps/web/src/mac-app.tsx` and `mac-app.css`, so no duplicate web styling or script is bundled into the app.

The bundle identifier is `com.sunhub.connect.macos`. Its version and minimum macOS version are in `Resources/Info.plist`. The compiler targets macOS 13 in `build.sh`; update both if the minimum version changes.

## Install with macOS Installer

Open **Connect-0.1.4-macos-universal.pkg**. Apple's Installer presents the Connect introduction, installation details, standard Install step, and completion screen. It installs **/Applications/Connect.app**; macOS may request authorization for that location. Open Connect from Applications or Spotlight after installation. The build scripts never install or launch the app themselves.

Save your work and **Quit Connect (⌘Q)** before upgrading. Closing its window keeps the app running. Installer checks for a running Connect and asks you to close it before proceeding. An upgrade replaces only the existing application bundle at `/Applications/Connect.app`; user data, preferences, and sessions remain in their existing locations. The bundle identifier remains `com.sunhub.connect.macos`, and the stable package receipt identifier is `com.sunhub.connect.macos.pkg`.

The package uses version checking and an atomic bundle replacement. It will not overwrite a newer installed version, relocate to a copy in Downloads, or run installation scripts. It supports the system Applications destination only. The DMG and ZIP remain available as optional manual-install formats containing the same app.

If the project lives in a synced Documents folder, its File Provider may repeatedly add Finder metadata to the loose `artifacts/Connect.app`, causing strict signature checks on that copy to fail. Install from the DMG or extract the ZIP into a normal local folder instead. The package payload is copied to non-synced temporary storage, cleaned of Finder/resource-fork metadata, and signature-verified before archiving; the original source artwork and quarantine attributes are never cleared.

By default, the app is **ad-hoc signed for local testing**, while the **PKG installer is unsigned**. Neither is notarized by Apple. The app signature verifies bundle integrity; it does not establish a trusted developer identity. macOS may block a downloaded copy. For a local build you trust, use **System Settings → Privacy & Security → Open Anyway** if macOS offers it. Do not disable Gatekeeper or remove quarantine as an installation requirement. A publicly distributed installer should be Developer ID signed and notarized.

Building or packaging never opens the app. The scripts do not submit anything to Apple unless `--notarize` is explicitly supplied.

## Developer ID signing and optional notarization

Use separate **Developer ID Application** and **Developer ID Installer** identities already installed in your Keychain:

```sh
SIGNING_IDENTITY='Developer ID Application: Your Organization (TEAMID)' \
  INSTALLER_SIGNING_IDENTITY='Developer ID Installer: Your Organization (TEAMID)' \
  ./apps/macos/package.sh
```

The application identity signs the app with hardened runtime; the installer identity signs the PKG. Both use secure timestamps. Signing does not notarize either artifact. Certificate import, account setup, and Keychain access remain the developer's responsibility; the scripts do not read or print passwords, API keys, or private keys.

When a notarization profile has already been stored in Keychain, explicitly submit the signed installer:

```sh
NOTARYTOOL_PROFILE='your-existing-keychain-profile' \
  INSTALLER_SIGNING_IDENTITY='Developer ID Installer: Your Organization (TEAMID)' \
  ./apps/macos/package.sh --skip-build --notarize
```

This opt-in command requires Apple's `notarytool` and `stapler`, rejects ad-hoc signed apps or a missing installer identity, and submits both PKG and DMG. It waits for Apple's results and staples/validates their tickets. It also staples the app before producing the ZIP and PKG. A network connection and Apple Developer account are required for this step. If submission or stapling fails, the script exits without promoting the new artifacts; do not distribute them as notarized.

## Security boundary

The native host runs with App Sandbox and hardened runtime. Its entitlements allow outgoing network connections and files explicitly chosen through system open/save dialogs. It has no broad filesystem, camera, microphone, printing, inbound server, or JIT entitlement. WebKit manages web content in its own processes. There is no global App Transport Security exception.

The native host must keep its URL allowlist and external-link handling in place when adding features. The web layout adapter requires both the ConnectMac user agent and the native message handler, and it stays inactive in windows with an opener. Its bridge passes UI display state and bounded menu selections, never authentication tokens. Native menus require the current trusted main-frame document and do not change account permissions. Credentials remain in the existing Connect/Sunhub authentication flow; packaging adds no embedded credentials or API secrets.

## Verify a package

```sh
xcrun lipo -archs apps/macos/artifacts/Connect.app/Contents/MacOS/Connect
codesign --verify --strict --verbose=2 apps/macos/artifacts/Connect.app
hdiutil verify apps/macos/artifacts/Connect-0.1.4-macos-universal.dmg
./apps/macos/test-package.sh apps/macos/artifacts/Connect-0.1.4-macos-universal.pkg
```

An ad-hoc build is expected to fail Gatekeeper's public-distribution assessment. For a Developer ID build intended for distribution, additionally verify its notarization ticket and Gatekeeper assessment before sharing it.

`test-package.sh` expands the PKG into temporary storage without installing it. It checks the app signature, architectures, minimum OS, fixed destination, bundle upgrade/version rules, absence of scripts, and branded resources. `package.sh` runs this verification before publishing its artifacts. Native Installer screens and package authorization are defined using Apple's [Distribution XML format](https://developer.apple.com/library/archive/documentation/DeveloperTools/Reference/DistributionDefinitionRef/Chapters/Distribution_XML_Ref.html).

The macOS CI workflow uses GitHub's standard `macos-26` runner and reports the selected Xcode, Swift, and SDK versions. The build enforces SDK 26 or newer. GitHub documents this runner as generally available in its [macOS 26 runner announcement](https://github.blog/changelog/2026-02-26-macos-26-is-now-generally-available-for-github-hosted-runners/).

## Local regression checks

```sh
./apps/macos/test-policy.sh
./apps/macos/test-webkit.sh
```

The policy suite checks trusted origins, callback routes, external links, and safe restoration in debug and release configurations. The WebKit suite uses local fixtures to exercise the native host and popup lifecycle. Its scripted popup checks enable automatic JavaScript windows **only in the test fixture**; production keeps that preference disabled. Passing those checks does not establish that the real production sign-in gesture has been exercised. A release should also receive a manual sign-in and file-transfer check in the packaged app.
