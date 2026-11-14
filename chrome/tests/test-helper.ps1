# End-to-end test of the Windows download helper, run by .github/workflows/windows-helper.yml.
# Installs the helper, then talks to it exactly like Chrome does: starts the registered
# host.bat, writes one framed JSON message to stdin, reads one framed reply from stdout.
# Not shipped in the Chrome zip.

$ErrorActionPreference = 'Stop'
$HostName = 'com.ytpremiumvibe.app'
$Dest = Join-Path $env:LOCALAPPDATA 'YTPremiumVibe'
$failures = 0

function Assert($cond, [string]$what) {
  if ($cond) { Write-Host "PASS  $what" -ForegroundColor Green }
  else { Write-Host "FAIL  $what" -ForegroundColor Red; $script:failures++ }
}

# Same launch Chrome does: the path from the registered manifest, through cmd.exe.
function Send-Native($obj) {
  $manifestPath = (Get-Item "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName").GetValue('')
  $hostPath = (Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json).path
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = "/d /c `"`"$hostPath`" chrome-extension://dcofaohpknfljeceeomhhdhophljdabo/`""
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [Diagnostics.Process]::Start($psi)
  $body = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
  $p.StandardInput.BaseStream.Write([BitConverter]::GetBytes([int]$body.Length), 0, 4)
  $p.StandardInput.BaseStream.Write($body, 0, $body.Length)
  $p.StandardInput.Close()
  $ms = New-Object IO.MemoryStream
  $p.StandardOutput.BaseStream.CopyTo($ms)
  $err = $p.StandardError.ReadToEnd()
  if (-not $p.WaitForExit(120000)) { $p.Kill(); throw 'host did not exit' }
  $bytes = $ms.ToArray()
  if ($bytes.Length -lt 4) {
    $log = Get-Content -Raw -LiteralPath (Join-Path $Dest 'host.log') -ErrorAction SilentlyContinue
    throw "No reply from host (exit $($p.ExitCode)). stderr: $err`nhost.log: $log"
  }
  $len = [BitConverter]::ToInt32($bytes, 0)
  if ($bytes.Length -ne 4 + $len) { throw "Reply framing is wrong: $($bytes.Length) bytes for length $len. stderr: $err" }
  return [Text.Encoding]::UTF8.GetString($bytes, 4, $len) | ConvertFrom-Json
}

function Wait-Job($jobId, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  $seen = @()
  while ((Get-Date) -lt $deadline) {
    $s = Send-Native @{ cmd = 'status'; jobId = $jobId }
    $seen += $s.state
    if ($s.state -in @('done', 'error', 'cancelled')) { return @{ last = $s; seen = $seen } }
    Start-Sleep -Seconds 1
  }
  return @{ last = $s; seen = $seen }
}

# ---- install
& (Join-Path $PSScriptRoot '..\download-helper\install.ps1')
Assert (Test-Path (Join-Path $Dest 'bin\yt-dlp.exe')) 'install: yt-dlp.exe present'
Assert (Test-Path (Join-Path $Dest 'bin\ffmpeg.exe')) 'install: ffmpeg.exe present'
foreach ($b in @('Google\Chrome', 'Microsoft\Edge', 'BraveSoftware\Brave-Browser')) {
  Assert (Test-Path "HKCU:\Software\$b\NativeMessagingHosts\$HostName") "install: registered for $b"
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $Dest "$HostName.json") | ConvertFrom-Json
Assert ($manifest.allowed_origins -contains 'chrome-extension://dcofaohpknfljeceeomhhdhophljdabo/') 'install: manifest allows the extension ID'
Assert (Test-Path -LiteralPath $manifest.path) 'install: manifest path exists'

# ---- check
$t = Measure-Command { $c = Send-Native @{ cmd = 'check' } }
Assert ($c.ok -and $c.version -match '^\d{4}\.\d') "check: yt-dlp $($c.version)"
Assert ($c.ffmpeg) 'check: ffmpeg found'
Write-Host ("INFO  one message round trip took {0:N0} ms" -f $t.TotalMilliseconds)

# ---- input validation
$r = Send-Native @{ cmd = 'download'; url = 'https://evil.example/watch?v=aaaaaaaaaaa'; mode = 'video' }
Assert (-not $r.ok -and $r.error -eq 'bad_url') 'download: rejects non-YouTube URL'
$r = Send-Native @{ cmd = 'status'; jobId = '..\..\x' }
Assert (-not $r.ok -and $r.error -eq 'bad_job') 'status: rejects bad job id'
$r = Send-Native @{ cmd = 'reveal'; path = 'C:\nope\missing.mp4' }
Assert (-not $r.ok) 'reveal: missing file is refused'
$r = Send-Native @{ cmd = 'restore' }
Assert (-not $r.ok) 'restore: answers (unsupported) without crashing'

# ---- download (short public video). GitHub's servers are sometimes blocked by YouTube's
# bot check; then the job must still end cleanly with that error reported.
# Spaces, % and non-ASCII (u-umlaut + a Bangla letter) in the folder name, written as char codes so
# Windows PowerShell 5.1 reads this file the same whatever its encoding.
$folder = Join-Path $env:RUNNER_TEMP ('ytpv dl test %TEMP% ' + [char]0x00FC + [char]0x09AC)
$r = Send-Native @{ cmd = 'download'; url = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; mode = 'video'; folder = $folder; audioFormat = 'm4a'; quicktime = $false }
Assert ($r.ok -and $r.jobId) 'download: job started'
$w = Wait-Job $r.jobId 300
$last = $w.last
Write-Host "INFO  states seen: $(($w.seen | Select-Object -Unique) -join ' -> ')"
if ($last.state -eq 'done') {
  Assert (Test-Path -LiteralPath $last.file) "download: file saved ($($last.file))"
  Assert ($last.file.StartsWith($folder)) 'download: saved in the requested folder (with spaces, % and non-ASCII)'
  $r = Send-Native @{ cmd = 'reveal'; path = $last.file }
  Assert ($r.ok) 'reveal: accepts the downloaded file'
} elseif ($last.state -eq 'error' -and $last.message -match 'bot|Sign in|confirm') {
  Write-Host "WARN  YouTube blocked this server ($($last.message)). Launch, logging and error reporting worked." -ForegroundColor Yellow
} else {
  Assert $false "download: finished ($($last | ConvertTo-Json -Compress))"
  Get-ChildItem (Join-Path $Dest 'jobs') | ForEach-Object { Write-Host "---- $($_.Name)"; Get-Content -LiteralPath $_.FullName -ErrorAction SilentlyContinue }
}

# ---- cancel
$r = Send-Native @{ cmd = 'download'; url = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; mode = 'video'; folder = $folder }
Assert ($r.ok) 'cancel: second job started'
Start-Sleep -Seconds 3
$pidFile = Join-Path $Dest "jobs\$($r.jobId).pid"
$procId = [int](Get-Content -Raw -LiteralPath $pidFile).Trim()
Assert ($null -ne (Get-Process -Id $procId -ErrorAction SilentlyContinue)) 'download: job keeps running after the host exits'
$c = Send-Native @{ cmd = 'cancel'; jobId = $r.jobId }
Assert ($c.ok) 'cancel: accepted'
Start-Sleep -Seconds 2
$s = Send-Native @{ cmd = 'status'; jobId = $r.jobId }
Assert ($s.state -eq 'cancelled') 'cancel: status says cancelled'
Assert ($null -eq (Get-Process -Id $procId -ErrorAction SilentlyContinue)) 'cancel: process stopped'
Assert (@(Get-Process yt-dlp -ErrorAction SilentlyContinue).Count -eq 0) 'cancel: no yt-dlp left running'

# ---- uninstall
& (Join-Path $PSScriptRoot '..\download-helper\uninstall.ps1')
Assert (-not (Test-Path $Dest)) 'uninstall: folder removed'
Assert (-not (Test-Path "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName")) 'uninstall: registration removed'

if ($failures -gt 0) { Write-Host "$failures check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'All checks passed' -ForegroundColor Green
