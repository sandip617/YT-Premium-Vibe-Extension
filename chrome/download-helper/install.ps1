# Installs the YT Premium Vibe download helper for Chrome, Edge and Brave on Windows.
# Run it through INSTALL-DOWNLOAD-HELPER.bat (no admin needed: everything goes in your user folder).
#   1. copies the helper to %LOCALAPPDATA%\YTPremiumVibe
#   2. registers it with Chrome/Edge/Brave (HKCU registry) for this extension only
#   3. downloads yt-dlp.exe and ffmpeg, checking their SHA-256 checksums

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is very slow with the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$HostName = 'com.ytpremiumvibe.app'
# Fixed by the "key" that make-chrome-package.sh puts in the Chrome manifest.json.
$ExtensionId = 'dcofaohpknfljeceeomhhdhophljdabo'

$Src = $PSScriptRoot
$Dest = Join-Path $env:LOCALAPPDATA 'YTPremiumVibe'
$Bin = Join-Path $Dest 'bin'
New-Item -ItemType Directory -Force -Path $Bin | Out-Null

function Step($text) { Write-Host ''; Write-Host "==> $text" -ForegroundColor Cyan }

function Get-Verified([string]$url, [string]$sumsUrl, [string]$name, [string]$outFile) {
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $outFile
  $sums = (Invoke-WebRequest -UseBasicParsing -Uri $sumsUrl).Content
  if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $outFile).Hash.ToLower()
  $ok = $false
  foreach ($line in ($sums -split "`r?`n")) {
    $parts = $line.Trim() -split '\s+'
    if ($parts.Count -eq 2 -and $parts[0].ToLower() -eq $hash -and $parts[1].TrimStart('*') -eq $name) { $ok = $true }
  }
  if (-not $ok) { Remove-Item -LiteralPath $outFile -Force; throw "Checksum mismatch for $name. Nothing was installed from it." }
}

try {
  Step 'Copying the helper'
  Copy-Item -Force -LiteralPath (Join-Path $Src 'host.ps1'), (Join-Path $Src 'host.bat') -Destination $Dest
  Get-ChildItem -LiteralPath $Dest -File | Unblock-File

  Step 'Registering it with Chrome, Edge and Brave'
  $manifestPath = Join-Path $Dest "$HostName.json"
  $manifest = [ordered]@{
    name            = $HostName
    description     = 'YT Premium Vibe download helper'
    path            = (Join-Path $Dest 'host.bat')
    type            = 'stdio'
    allowed_origins = @("chrome-extension://$ExtensionId/")
  }
  [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
  foreach ($browser in @('Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', 'Chromium')) {
    $key = "HKCU:\Software\$browser\NativeMessagingHosts\$HostName"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $manifestPath
  }

  Step 'Downloading yt-dlp'
  $yt = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
  Get-Verified ($yt + 'yt-dlp.exe') ($yt + 'SHA2-256SUMS') 'yt-dlp.exe' (Join-Path $Bin 'yt-dlp.exe')

  Step 'Downloading ffmpeg (about 150 MB, needed for 1080p and higher, may take a few minutes)'
  try {
    $ff = 'https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/'
    $zipName = 'ffmpeg-master-latest-win64-gpl.zip'
    $tmp = Join-Path $env:TEMP 'ytpv-ffmpeg'
    Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp $zipName
    Get-Verified ($ff + $zipName) ($ff + 'checksums.sha256') $zipName $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    foreach ($exe in @('ffmpeg.exe', 'ffprobe.exe')) {
      $found = Get-ChildItem -LiteralPath $tmp -Recurse -Filter $exe | Select-Object -First 1
      if ($found) { Copy-Item -Force -LiteralPath $found.FullName -Destination $Bin }
    }
    Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
  } catch {
    Write-Host "Couldn't install ffmpeg: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host 'Downloads will still work, but videos max out at 720p. Run this installer again to retry.' -ForegroundColor Yellow
  }

  Get-ChildItem -LiteralPath $Bin -File | Unblock-File
  Write-Host ''
  Write-Host 'Done! Restart Chrome (close every Chrome window, then open it again),' -ForegroundColor Green
  Write-Host 'then click Download under any YouTube video.' -ForegroundColor Green
} catch {
  Write-Host ''
  Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'Check your internet connection and run INSTALL-DOWNLOAD-HELPER.bat again.' -ForegroundColor Red
}
