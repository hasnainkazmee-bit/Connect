# Connect for Windows

Connect is a native WPF desktop shell around the shared Connect workspace. The sidebar, window controls, menus, file dialogs, sign-in windows, and downloads use Windows components. Posts, profiles, conversations, and account workflows stay connected to the live service at https://connect.sunhubapp.com.

## Install

Download the Setup installer for the PC's processor:

- **Connect-0.1.1-win-x64-Setup.exe** for Intel and AMD PCs.
- **Connect-0.1.1-win-arm64-Setup.exe** for Windows on ARM, including Snapdragon PCs.

Use a supported Windows 11 release. The executable's technical minimum is Windows 10 build 19041; older Windows editions are not a substitute for an OS still supported by Microsoft.

The guided installer installs only for the current Windows account, at **%LOCALAPPDATA%\Programs\Sunhub\Connect**, without requesting administrator access. It adds Connect to the Start menu, offers an optional desktop shortcut, and registers uninstall in Settings → Apps → Installed apps. The finish screen offers an unchecked Open Connect option.

Setup checks for Microsoft WebView2 and installs the Evergreen runtime when it is missing. This first-time prerequisite needs an internet connection. Its bootstrapper is bundled from Microsoft's official download and its Microsoft Authenticode signature is checked both during packaging and immediately before execution. A pre-existing system Edge updater may manage the runtime centrally.

Quit Connect before updating. Setup uses the same app identity for upgrades, permits same-version repair, and prevents installing an older version over a newer one. It never forces Connect to close. User sessions, preferences, and WebView2 data live separately in **%LOCALAPPDATA%\Sunhub\Connect** and are preserved by repair, upgrade, and uninstall.

These initial installers and app executables are **unsigned**. Windows SmartScreen may identify them as an unrecognized app; there is no signed-publisher or Microsoft Store claim. The adjacent SHA-256 file verifies download integrity, not publisher identity.

## Build and package

Use Windows, PowerShell 7+, the [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0), and [Inno Setup 6.3 or newer in the 6.x series](https://jrsoftware.org/isdl.php). Set ISCC_PATH if Inno Setup is installed outside its standard location. Review Inno Setup's current license and commercial-use terms on its official site.

From the repository root:

    ./apps/windows/build.ps1
    ./apps/windows/package.ps1 -Runtime win-x64 -SkipBuild
    ./apps/windows/package.ps1 -Runtime win-arm64 -SkipBuild

The build produces separate self-contained .NET applications in apps/windows/.build/publish. End users do not need to install .NET. Installer outputs and their SHA-256 files are in apps/windows/artifacts. Packaging validates the published app version and executable architecture before naming an installer, so SkipBuild cannot silently package a stale or mismatched app.

The ICO helper wraps the original Connect PNG in an ICO container without changing its artwork bytes. Generated icons, published runtimes, installer prerequisites, and installers are ignored by Git. The WebView2 SDK is pinned in the native project; the installed Evergreen runtime receives Microsoft's updates.

## Validation

The Windows GitHub Actions workflow builds both architectures on windows-2025 and runs the platform-neutral navigation/security tests. On x64 it also installs the actual generated installer into the isolated CI account, compares installed binaries with the publish output, checks shortcuts and Apps & Features metadata, repairs the installation, uninstalls it, and verifies profile preservation.

The separate native smoke host uses real WPF/WebView2 windows, a temporary profile, and local fixture origins. It does not add a test login mode to the shipped app or sign in to production. CI retains its logs and screenshots. ARM64 is cross-compiled and packaged on the x64 runner; this does not claim a real ARM-device interaction test.

The installer execution test explicitly refuses to run outside GitHub Actions. It never installs Connect on the developer's Mac.

## Current scope

The app has its own persistent WebView2 session store, separate from Edge's normal browser profile. Native window changes require a new Setup installer; shared web changes arrive through the live service. App updates shows verified release download links; installing remains a user action.

After opting in from notification settings, Windows displays native notifications while Connect is running or minimized. The Windows App SDK runtime is bundled with the app. Fully quit delivery through WNS is not configured. The bridge requires the trusted main frame, an explicit user gesture for opt-in, and the current account for display and taps. Confirmed reads withdraw matching alerts and prevent delayed duplicates. Native smoke tests use fake delivery for permission/account/read races, plus real runtime initialization; they do not claim end-user OS banner delivery. There is no offline workspace.

Packaging references: [Microsoft WebView2 distribution](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution), [Inno Setup architecture rules](https://jrsoftware.org/ishelp/topic_setup_architecturesallowed.htm), [Inno Setup application mutex](https://jrsoftware.org/ishelp/topic_setup_appmutex.htm), and [GitHub Windows runner contents](https://github.com/actions/runner-images/blob/main/images/windows/Windows2025-Readme.md).
