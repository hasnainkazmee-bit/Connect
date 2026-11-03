#ifndef AppVersion
  #error AppVersion must be supplied by package.ps1
#endif
#ifndef TargetRuntime
  #error TargetRuntime must be supplied by package.ps1
#endif

[Setup]
AppId={{64A65F58-92A4-4E8E-91BD-CA46D34F7E83}
AppName=Connect
AppVersion={#AppVersion}
AppPublisher=Sunhub
AppPublisherURL=https://sunhubapp.com
AppSupportURL=https://connect.sunhubapp.com
DefaultDirName={localappdata}\Programs\Sunhub\Connect
DefaultGroupName=Connect
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
MinVersion=10.0.19041
#if TargetRuntime == "win-arm64"
ArchitecturesAllowed=arm64
ArchitecturesInstallIn64BitMode=arm64
#else
ArchitecturesAllowed=x64compatible and not arm64
ArchitecturesInstallIn64BitMode=x64compatible
#endif
OutputDir={#OutputDir}
OutputBaseFilename=Connect-{#AppVersion}-{#TargetRuntime}-Setup
SetupIconFile={#AppIcon}
UninstallDisplayIcon={app}\Connect.exe
UninstallDisplayName=Connect
AppMutex=Local\Sunhub.Connect.Windows
CloseApplications=no
RestartApplications=no
WizardStyle=modern
WizardSizePercent=105
Compression=lzma2
SolidCompression=yes
UsePreviousAppDir=yes
UsePreviousTasks=yes
ChangesAssociations=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to Connect
WelcomeLabel2=Connect. Talk. Celebrate.%n%nSetup will install Connect for your Windows account. Save your work and quit Connect before upgrading.%n%nYour account data and preferences stay in place.
FinishedHeadingLabel=Connect is installed
FinishedLabel=Open Connect from the Start menu when you're ready.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BootstrapperPath}"; DestName: "MicrosoftEdgeWebView2Setup.exe"; Flags: dontcopy
Source: "Ensure-WebView2.ps1"; Flags: dontcopy

[Icons]
Name: "{autoprograms}\Connect"; Filename: "{app}\Connect.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Connect"; Filename: "{app}\Connect.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\Connect.exe"; Description: "Open Connect"; Flags: nowait postinstall skipifsilent unchecked

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  Parameters: String;
  InstalledVersion: Int64;
begin
  Result := '';
  if GetPackedVersion(ExpandConstant('{app}\Connect.exe'), InstalledVersion) and
    (ComparePackedVersion(InstalledVersion, PackVersionComponents({#VersionMajor}, {#VersionMinor}, {#VersionPatch}, 0)) > 0) then
  begin
    Result := 'A newer version of Connect is already installed. Use the latest Setup to update Connect.';
    exit;
  end;
  ExtractTemporaryFile('MicrosoftEdgeWebView2Setup.exe');
  ExtractTemporaryFile('Ensure-WebView2.ps1');
  Parameters := '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{tmp}\Ensure-WebView2.ps1') + '" -BootstrapperPath "' +
    ExpandConstant('{tmp}\MicrosoftEdgeWebView2Setup.exe') + '"';
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    Result := 'Connect could not check Microsoft WebView2. Please try Setup again.';
    exit;
  end;
  if ResultCode = 3010 then
    NeedsRestart := True
  else if ResultCode <> 0 then
    Result := 'Microsoft WebView2 could not be installed or verified. Check your internet connection, then try again.';
  if (Result = '') and CheckForMutexes('Local\Sunhub.Connect.Windows') then
    Result := 'Connect was opened while Setup was preparing. Save your work and quit Connect, then try again.';
end;
