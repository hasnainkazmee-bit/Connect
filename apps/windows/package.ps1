#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('win-x64', 'win-arm64')][string]$Runtime = 'win-x64',
    [switch]$SkipBuild
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows installer compilation requires Windows.' }
if (-not $SkipBuild) { & (Join-Path $PSScriptRoot 'build.ps1') -Runtime $Runtime }
$projectPath = Join-Path $PSScriptRoot 'Connect.Windows/Connect.Windows.csproj'
[xml]$project = Get-Content -LiteralPath $projectPath -Raw
$versionNode = $project.SelectSingleNode('/Project/PropertyGroup/Version')
if ($null -eq $versionNode) { throw 'The project Version is missing.' }
$version = $versionNode.InnerText
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'The project must declare a three-part Version.' }
$publishDir = Join-Path $PSScriptRoot ".build/publish/$Runtime"
$app = Join-Path $publishDir 'Connect.exe'
if (-not (Test-Path $app)) { throw "Build $Runtime before packaging." }
$fileVersion = (Get-Item -LiteralPath $app).VersionInfo
$expectedVersion = [Version]$version
if ($fileVersion.FileMajorPart -ne $expectedVersion.Major -or
    $fileVersion.FileMinorPart -ne $expectedVersion.Minor -or
    $fileVersion.FileBuildPart -ne $expectedVersion.Build -or $fileVersion.FilePrivatePart -ne 0) {
    throw 'Published app version does not match the project. Rebuild before packaging.'
}
$reader = [IO.BinaryReader]::new([IO.File]::OpenRead($app))
try {
    $reader.BaseStream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    if ($peOffset -lt 64 -or $peOffset -gt $reader.BaseStream.Length - 6) { throw 'Invalid Windows executable.' }
    $reader.BaseStream.Position = $peOffset
    if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Invalid PE signature.' }
    $machine = $reader.ReadUInt16()
    $expectedMachine = if ($Runtime -eq 'win-x64') { 0x8664 } else { 0xaa64 }
    if ($machine -ne $expectedMachine) { throw 'Published app architecture does not match the requested installer.' }
} finally { $reader.Dispose() }
if (-not (Test-Path (Join-Path $publishDir 'coreclr.dll'))) { throw 'Expected a self-contained .NET payload.' }
$artifacts = Join-Path $PSScriptRoot 'artifacts'
$toolsDir = Join-Path $PSScriptRoot '.build/tools'
[IO.Directory]::CreateDirectory($artifacts) | Out-Null
[IO.Directory]::CreateDirectory($toolsDir) | Out-Null
$compilerCandidates = @(
    $env:ISCC_PATH,
    (Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Inno Setup 6/ISCC.exe'),
    (Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'Inno Setup 6/ISCC.exe')
)
$compiler = $compilerCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $compiler) { throw 'Install Inno Setup 6 from https://jrsoftware.org/isdl.php or set ISCC_PATH.' }
$compilerVersion = (Get-Item -LiteralPath $compiler).VersionInfo
if ($compilerVersion.FileMajorPart -ne 6 -or $compilerVersion.FileMinorPart -lt 3) {
    throw 'Inno Setup 6.3 or later in the 6.x series is required.'
}
# Download only from Microsoft's official Evergreen bootstrapper link.
$bootstrapper = Join-Path $toolsDir 'MicrosoftEdgeWebView2Setup.exe'
Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $bootstrapper
$signature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
    $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw 'The WebView2 bootstrapper must have a valid Microsoft signature.'
}
$icon = Join-Path $PSScriptRoot 'Connect.Windows/Assets/Connect.ico'
$compilerArgs = @("/DAppVersion=$version", "/DTargetRuntime=$Runtime", "/DPublishDir=$publishDir",
    "/DVersionMajor=$($expectedVersion.Major)", "/DVersionMinor=$($expectedVersion.Minor)", "/DVersionPatch=$($expectedVersion.Build)",
    "/DOutputDir=$artifacts", "/DBootstrapperPath=$bootstrapper", "/DAppIcon=$icon",
    (Join-Path $PSScriptRoot 'installer/Connect.iss'))
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed for $Runtime." }
$setup = Join-Path $artifacts "Connect-$version-$Runtime-Setup.exe"
if (-not (Test-Path $setup)) { throw 'Expected Setup.exe was not produced.' }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($setup))" | Set-Content -LiteralPath "$setup.sha256" -Encoding ascii
Write-Host "Installer: $setup"
Write-Host 'Unsigned local release: Windows SmartScreen may show an unrecognized-app warning.'
