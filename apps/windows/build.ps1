#requires -Version 7.0
[CmdletBinding()]
param(
    [ValidateSet('win-x64', 'win-arm64')]
    [string[]]$Runtime = @('win-x64', 'win-arm64'),
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'Connect.Windows/Connect.Windows.csproj'
if (-not (Test-Path $project)) { throw "Windows project not found: $project" }
& (Join-Path $PSScriptRoot 'tools/New-ConnectIcon.ps1')
$sdk = & dotnet --version
if ($LASTEXITCODE -ne 0 -or $sdk -notmatch '^10\.') { throw '.NET 10 SDK is required.' }
foreach ($rid in $Runtime) {
    $output = Join-Path $PSScriptRoot ".build/publish/$rid"
    if (Test-Path $output) { Remove-Item -LiteralPath $output -Recurse -Force }
    $publishArgs = @('publish', $project, '--configuration', $Configuration, '--runtime', $rid,
        '--self-contained', 'true', '--output', $output, '-p:EnableWindowsTargeting=true',
        '-p:PublishSingleFile=false', '-p:PublishTrimmed=false', '-p:DebugType=None', '-p:DebugSymbols=false')
    & dotnet @publishArgs
    if ($LASTEXITCODE -ne 0) { throw "Publish failed for $rid." }
    if (-not (Test-Path (Join-Path $output 'Connect.exe'))) { throw 'Connect.exe is missing.' }
    if (-not (Test-Path (Join-Path $output 'coreclr.dll'))) { throw 'The .NET runtime was not bundled.' }
    Write-Host "Published self-contained $rid app to $output"
}
