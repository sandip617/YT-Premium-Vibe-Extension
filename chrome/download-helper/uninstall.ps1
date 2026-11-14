# Removes the YT Premium Vibe download helper: stops running downloads, removes the
# Chrome/Edge/Brave registrations and deletes %LOCALAPPDATA%\YTPremiumVibe.
# Downloaded videos in your Downloads folder are not touched.

$HostName = 'com.ytpremiumvibe.app'
$Dest = Join-Path $env:LOCALAPPDATA 'YTPremiumVibe'

# Stop any download still running, so its files can be deleted.
Get-ChildItem -LiteralPath (Join-Path $Dest 'jobs') -Filter '*.pid' -ErrorAction SilentlyContinue | ForEach-Object {
  $procId = 0
  if ([int]::TryParse((Get-Content -LiteralPath $_.FullName -Raw).Trim(), [ref]$procId) -and $procId -gt 4) {
    $null = & cmd.exe /d /c "taskkill /PID $procId /T /F >nul 2>&1"
  }
}

foreach ($browser in @('Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser', 'Chromium')) {
  Remove-Item -Path "HKCU:\Software\$browser\NativeMessagingHosts\$HostName" -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath $Dest -Recurse -Force -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $Dest) {
  Write-Host "Couldn't delete $Dest completely. Close Chrome and run this again." -ForegroundColor Yellow
} else {
  Write-Host 'Removed. Chrome will show the "Copy yt-dlp command" option again instead of downloading.' -ForegroundColor Green
}
