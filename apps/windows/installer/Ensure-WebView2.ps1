#requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$BootstrapperPath)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-WebView2Runtime {
    $client = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)) {
            $baseKey = $null; $key = $null
            try {
                $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
                $key = $baseKey.OpenSubKey($client)
                if ($null -ne $key) {
                    $version = $null
                    if ([Version]::TryParse([string]$key.GetValue('pv'), [ref]$version) -and $version -gt [Version]'0.0.0.0') {
                        return $true
                    }
                }
            } finally {
                if ($null -ne $key) { $key.Dispose() }
                if ($null -ne $baseKey) { $baseKey.Dispose() }
            }
        }
    }
    return $false
}
try {
    if (Test-WebView2Runtime) { exit 0 }
    $signature = Get-AuthenticodeSignature -LiteralPath $BootstrapperPath
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
        throw 'Microsoft WebView2 installer signature could not be verified.'
    }
    $process = Start-Process -FilePath $BootstrapperPath -ArgumentList '/silent', '/install' -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) { throw "WebView2 setup returned code $($process.ExitCode)." }
    if (-not (Test-WebView2Runtime)) { throw 'Microsoft WebView2 is still unavailable after setup.' }
    if ($process.ExitCode -eq 3010) { exit 3010 }
    exit 0
} catch {
    Write-Error $_
    exit 1
}
