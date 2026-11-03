#requires -Version 7.0
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$windowsRoot = Split-Path $PSScriptRoot -Parent
$repoRoot = Split-Path (Split-Path $windowsRoot -Parent) -Parent
$source = Join-Path $repoRoot 'apps/web/public/assets/connect-icon.png'
$destination = Join-Path $windowsRoot 'Connect.Windows/Assets/Connect.ico'
$png = [IO.File]::ReadAllBytes($source)
if ($png.Length -lt 33 -or [BitConverter]::ToString($png, 0, 8) -ne '89-50-4E-47-0D-0A-1A-0A') {
    throw 'The original Connect icon must be a PNG.'
}
function Read-BigEndianInt([int]$Offset) {
    $bytes = [byte[]]$png[$Offset..($Offset + 3)]
    [Array]::Reverse($bytes)
    return [BitConverter]::ToUInt32($bytes, 0)
}
$width = Read-BigEndianInt 16
$height = Read-BigEndianInt 20
if ($width -lt 1 -or $width -gt 256 -or $height -lt 1 -or $height -gt 256) {
    throw 'The PNG must fit a Windows ICO entry (at most 256px per dimension).'
}
[IO.Directory]::CreateDirectory((Split-Path $destination -Parent)) | Out-Null
$stream = [IO.File]::Create($destination)
$writer = [IO.BinaryWriter]::new($stream)
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]1)
    $writer.Write([byte]($width % 256)); $writer.Write([byte]($height % 256))
    $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$png.Length); $writer.Write([uint32]22)
    # ICO supports an embedded PNG. Preserve every original artwork byte.
    $writer.Write($png)
} finally {
    $writer.Dispose()
}
Write-Host "Generated Connect.ico from the original $width x $height PNG."
