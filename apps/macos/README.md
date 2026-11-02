# Connect for macOS

Connect for macOS uses a native AppKit sidebar and workspace controls around live Connect content from `https://connect.sunhubapp.com`. The native sidebar, context Back action, new-post control, notifications, and account controls give the Mac app its own navigation. Content and workflow improvements arrive through the shared web app; changes to the native host require a new app build. An internet connection is required.

The app supports macOS 13 or later. The default universal build runs on Apple silicon and Intel Macs. It uses the existing Connect artwork without cropping or stretching it.

## Using the app

Use the native sidebar to move between Home, Directory, My Network, and Messages. The native account/company control opens the existing account and company-switch workflow, preserving the same permissions and membership checks as the web app.

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

Full Xcode is not required for building and packaging. Install Apple's Command Line Tools if they are missing (`xcode-select --install`). The build has been prepared for Apple Swift 6; the development machine uses Swift 6.3.2.

From the repository root:

```sh
./apps/macos/build.sh
./apps/macos/package.sh --skip-build
```

Or build and package in one command:

```sh
./apps/macos/package.sh
```

The scripts use `swiftc`, `lipo`, `sips`, `iconutil`, `codesign`, `ditto`, and `hdiutil` supplied by macOS and its developer tools. Compilation uses a writable module cache inside `.build`. Bundle and installer staging uses the system temporary directory, keeping File Provider metadata from synced project folders out of signed archive payloads. No JavaScript package installation or web build is needed to package this live host.

Outputs are ignored by Git:

- `apps/macos/artifacts/Connect.app`
- `apps/macos/artifacts/Connect-0.1.0-macos-universal.dmg`
- `apps/macos/artifacts/Connect-0.1.0-macos-universal.zip`

For a single architecture, use `--arch arm64` or `--arch x86_64` on either script. The archive filename reflects the actual binary architectures. A failed cross-compile stops the universal build rather than delivering an incomplete universal app. `--skip-build` packages the existing signed app and derives its architecture from that binary.

The bundle includes the unmodified transparent Connect wordmark as `ConnectWordmark.png`; its contents are covered by the build fingerprint. The Mac layout adapter is deployed with the shared web app in `apps/web/src/mac-app.tsx` and `mac-app.css`, so no duplicate web styling or script is bundled into the app.

The bundle identifier is `com.sunhub.connect.macos`. Its version and minimum macOS version are in `Resources/Info.plist`. The compiler targets macOS 13 in `build.sh`; update both if the minimum version changes.

## Install a local test build

Open the DMG and drag **Connect.app** to **Applications**, then open it from Applications. The ZIP contains the same app bundle.

If the project lives in a synced Documents folder, its File Provider may repeatedly add Finder metadata to the loose `artifacts/Connect.app`, causing strict signature checks on that copy to fail. Install from the DMG or extract the ZIP into a normal local folder instead. The package payload is copied to non-synced temporary storage, cleaned of Finder/resource-fork metadata, and signature-verified before archiving; the original source artwork and quarantine attributes are never cleared.

By default, the app is **ad-hoc signed for local testing and is not notarized by Apple**. That signature verifies bundle integrity; it does not establish a trusted developer identity. macOS may block a downloaded copy. For a local build you trust, use **System Settings → Privacy & Security → Open Anyway** if macOS offers it. Do not disable Gatekeeper or remove quarantine as an installation requirement. A publicly distributed installer should be Developer ID signed and notarized.

Building or packaging never opens the app. The scripts do not submit anything to Apple unless `--notarize` is explicitly supplied.

## Developer ID signing and optional notarization

Use a **Developer ID Application** identity already installed in your Keychain:

```sh
SIGNING_IDENTITY='Developer ID Application: Your Organization (TEAMID)' \
  ./apps/macos/package.sh
```

This enables a secure timestamp and hardened runtime. It does not notarize the app. Certificate import, account setup, and Keychain access remain the developer's responsibility; the scripts do not read or print passwords, API keys, or private keys.

When a notarization profile has already been stored in Keychain, explicitly submit the signed installer:

```sh
NOTARYTOOL_PROFILE='your-existing-keychain-profile' \
  ./apps/macos/package.sh --skip-build --notarize
```

This opt-in command requires Apple's `notarytool` and `stapler`, rejects ad-hoc signed apps, submits the DMG, waits for Apple's result, and staples/validates the ticket. It also staples the app before producing the ZIP. A network connection and Apple Developer account are required for this step. If submission or stapling fails, the script exits with an error; do not distribute the output as notarized.

## Security boundary

The native host runs with App Sandbox and hardened runtime. Its entitlements allow outgoing network connections and files explicitly chosen through system open/save dialogs. It has no broad filesystem, camera, microphone, printing, inbound server, or JIT entitlement. WebKit manages web content in its own processes. There is no global App Transport Security exception.

The native host must keep its URL allowlist and external-link handling in place when adding features. The web layout adapter requires both the ConnectMac user agent and the native message handler, and it stays inactive in windows with an opener. Its bridge passes display state only, never authentication tokens. Credentials remain in the existing Connect/Sunhub authentication flow; packaging adds no embedded credentials or API secrets.

## Verify a package

```sh
xcrun lipo -archs apps/macos/artifacts/Connect.app/Contents/MacOS/Connect
codesign --verify --strict --verbose=2 apps/macos/artifacts/Connect.app
hdiutil verify apps/macos/artifacts/Connect-0.1.0-macos-universal.dmg
```

An ad-hoc build is expected to fail Gatekeeper's public-distribution assessment. For a Developer ID build intended for distribution, additionally verify its notarization ticket and Gatekeeper assessment before sharing it.

## Local regression checks

```sh
./apps/macos/test-policy.sh
./apps/macos/test-webkit.sh
```

The policy suite checks trusted origins, callback routes, external links, and safe restoration in debug and release configurations. The WebKit suite uses local fixtures to exercise the native host and popup lifecycle. Its scripted popup checks enable automatic JavaScript windows **only in the test fixture**; production keeps that preference disabled. Passing those checks does not establish that the real production sign-in gesture has been exercised. A release should also receive a manual sign-in and file-transfer check in the packaged app.
