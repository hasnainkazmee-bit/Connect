#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$SetupPath,
    [string]$Version = '0.1.0'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true') {
    throw 'Installer execution tests are restricted to an isolated GitHub Actions Windows runner.'
}
$windowsRoot = Split-Path $PSScriptRoot -Parent
$output = Join-Path $windowsRoot '.build/installer-test'
[IO.Directory]::CreateDirectory($output) | Out-Null
$installDir = Join-Path $env:LOCALAPPDATA 'Programs/Sunhub/Connect'
$dataDir = Join-Path $env:LOCALAPPDATA 'Sunhub/Connect'
$marker = Join-Path $dataDir 'installer-preservation-test.txt'
$startShortcut = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/Connect.lnk'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Connect.lnk'
$registration = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{64A65F58-92A4-4E8E-91BD-CA46D34F7E83}_is1'
if ((Test-Path $installDir) -or (Test-Path $dataDir) -or (Test-Path $registration)) {
    throw 'The test requires a clean CI user; an existing Connect install or profile was found.'
}
$setup = (Resolve-Path -LiteralPath $SetupPath).Path
$checksum = ((Get-Content -LiteralPath "$setup.sha256" -Raw) -split '\s+')[0]
if ((Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash -ne $checksum) { throw 'Installer checksum mismatch.' }
if ((Get-Item $setup).VersionInfo.ProductName -ne 'Connect') { throw 'Installer product metadata mismatch.' }
[IO.Directory]::CreateDirectory($dataDir) | Out-Null
$markerContent = 'Keep the user profile across repair and uninstall.'
Set-Content -LiteralPath $marker -Value $markerContent -NoNewline

function Invoke-Installer([string]$Path, [string]$Phase, [switch]$Uninstall) {
    $log = Join-Path $output "$Phase.log"
    $arguments = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$log`"")
    if (-not $Uninstall) { $arguments += @('/SP-', '/CURRENTUSER', '/TASKS=desktopicon') }
    $process = Start-Process -FilePath $Path -ArgumentList $arguments -PassThru
    if (-not $process.WaitForExit(240000)) { throw "$Phase timed out; see $log" }
    if ($process.ExitCode -ne 0) { throw "$Phase failed with $($process.ExitCode); see $log" }
}
function Assert-ProfilePreserved {
    if (-not (Test-Path $marker) -or (Get-Content $marker -Raw) -ne $markerContent) { throw 'User profile was modified.' }
}
try {
    Invoke-Installer $setup 'install'
    $app = Join-Path $installDir 'Connect.exe'
    if (-not (Test-Path $app)) { throw 'Connect.exe was not installed at the per-user destination.' }
    if ((Get-Item $app).VersionInfo.FileVersion -ne "$Version.0") { throw 'Installed app version mismatch.' }
    foreach ($file in @('Connect.exe', 'Connect.dll', 'Connect.Core.dll', 'coreclr.dll', 'Microsoft.Web.WebView2.Wpf.dll')) {
        $source = Join-Path $windowsRoot ".build/publish/win-x64/$file"
        $installed = Join-Path $installDir $file
        if ((Get-FileHash $source).Hash -ne (Get-FileHash $installed).Hash) { throw "Installed payload differs: $file" }
    }
    if (-not (Test-Path $startShortcut) -or -not (Test-Path $desktopShortcut)) { throw 'Requested shortcuts are missing.' }
    if (-not (Test-Path $registration)) { throw 'Apps & Features registration is missing.' }
    $details = Get-ItemProperty -LiteralPath $registration
    if ($details.DisplayVersion -ne $Version -or $details.DisplayName -ne 'Connect') { throw 'Apps & Features metadata mismatch.' }
    if ((Get-Process -Name Connect -ErrorAction SilentlyContinue)) { throw 'Silent setup must not launch Connect.' }
    Assert-ProfilePreserved
    Invoke-Installer $setup 'repair'
    Assert-ProfilePreserved
    Invoke-Installer (Join-Path $installDir 'unins000.exe') 'uninstall' -Uninstall
    for ($attempt = 0; $attempt -lt 30 -and (Test-Path $app); $attempt++) { Start-Sleep -Milliseconds 200 }
    if ((Test-Path $app) -or (Test-Path $registration) -or (Test-Path $startShortcut) -or (Test-Path $desktopShortcut)) {
        throw 'Uninstall left app, registration, or shortcuts behind.'
    }
    Assert-ProfilePreserved
    Write-Host 'Installer checksum, metadata, payload, shortcuts, repair, uninstall, and profile preservation passed.'
} finally {
    # Never remove the profile directory; delete only the exact marker created by this isolated test.
    if (Test-Path $marker) { Remove-Item -LiteralPath $marker }
}
