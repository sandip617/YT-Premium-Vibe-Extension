# YT Premium Vibe - download helper for Chrome/Edge/Brave on Windows.
#
# Chrome starts host.exe (relay.cs) for every chrome.runtime.sendNativeMessage call; it
# passes the message here as base64 JSON in $args[0], and sends our UTF-8 JSON stdout back.
# It speaks the same commands as the Mac app (SafariWebExtensionHandler.swift):
#   check, download, status, cancel, reveal.  backup/restore are Mac-only (Safari wipes
#   storage, Chrome doesn't), so they answer ok:false and the extension carries on.
#
# A download runs as its own process (started through WMI, so it outlives this script
# and Chrome's process job). It writes its output to jobs\<id>.log, its exit code to
# jobs\<id>.exit and the final file path to jobs\<id>.path; "status" just reads them.

$MessageB64 = $args[0]
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Bin = Join-Path $Root 'bin'
$Jobs = Join-Path $Root 'jobs'
$YtDlp = Join-Path $Bin 'yt-dlp.exe'
$Ffmpeg = Join-Path $Bin 'ffmpeg.exe'
New-Item -ItemType Directory -Force -Path $Jobs | Out-Null

# Small log for troubleshooting on a friend's PC (%LOCALAPPDATA%\YTPremiumVibe\host.log), kept under ~200 KB.
$LogFile = Join-Path $Root 'host.log'
function Log([string]$text) {
  try {
    if ((Test-Path -LiteralPath $LogFile) -and (Get-Item -LiteralPath $LogFile).Length -gt 200KB) { Remove-Item -LiteralPath $LogFile -Force }
    Add-Content -LiteralPath $LogFile -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $text) -Encoding UTF8
  } catch {}
}

# ---------------------------------------------------------------- messaging

function Read-Message {
  if (-not $script:MessageB64) { Log 'no message'; return $null }
  return ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($script:MessageB64)) | ConvertFrom-Json)
}

# Raw UTF-8 bytes (not Write-Output), so non-English file names survive; host.exe adds the length.
function Write-Message($obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress -Depth 5))
  $out = [Console]::OpenStandardOutput()
  $out.Write($bytes, 0, $bytes.Length)
  $out.Flush()
}

# ---------------------------------------------------------------- helpers

function Job-File([string]$id, [string]$ext) { Join-Path $Jobs "$id.$ext" }

function Test-JobId($id) {
  $g = [guid]::Empty
  return ($id -is [string]) -and [guid]::TryParse($id, [ref]$g)
}

# Reads a file that yt-dlp may still be writing to.
function Read-Shared([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite, Delete')
  try { return (New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Dispose() }
}

function First-Match([string]$pattern, [string]$text) {
  $m = [regex]::Match($text, $pattern)
  if ($m.Success) { return $m.Groups[1].Value }
  return ''
}

# "~/Downloads" -> C:\Users\you\Downloads. Relative paths go under the user folder.
function Expand-Folder($raw) {
  $p = "$raw".Trim()
  if (-not $p) { $p = '~/Downloads' }
  $userHome = $env:USERPROFILE
  if ($p -eq '~') { $p = $userHome }
  elseif ($p -match '^~[\\/]') { $p = Join-Path $userHome $p.Substring(2) }
  elseif (-not [IO.Path]::IsPathRooted($p)) { $p = Join-Path $userHome $p }
  return [IO.Path]::GetFullPath($p)
}

# Quote one argument for a .cmd file: % must be doubled or cmd expands it.
function Quote-Cmd([string]$s) { '"' + ($s -replace '%', '%%') + '"' }

function Remove-OldJobs {
  $cutoff = (Get-Date).AddDays(-2)
  Get-ChildItem -LiteralPath $Jobs -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force -ErrorAction SilentlyContinue
}

# YouTube changes often: refresh yt-dlp when our copy is older than 14 days.
function Update-YtDlp {
  $item = Get-Item -LiteralPath $YtDlp
  if (((Get-Date) - $item.LastWriteTime).TotalDays -lt 14) { return }
  try { $null = & $YtDlp -U 2>&1 } catch {}
  try { (Get-Item -LiteralPath $YtDlp).LastWriteTime = Get-Date } catch {}
}

# ---------------------------------------------------------------- commands

function Cmd-Check {
  $ff = $null
  if (Test-Path -LiteralPath $Ffmpeg) { $ff = $Ffmpeg }
  if (-not (Test-Path -LiteralPath $YtDlp)) {
    return @{ ok = $true; ytdlp = $null; ffmpeg = $ff; error = 'yt-dlp is missing. Run INSTALL-DOWNLOAD-HELPER.bat again.' }
  }
  $v = ''
  try { $v = (& $YtDlp --version 2>&1 | Out-String).Trim() } catch { $v = $_.Exception.Message }
  if ($v -match '^\d{4}\.\d') { return @{ ok = $true; ytdlp = $YtDlp; ffmpeg = $ff; version = $v; error = $null } }
  return @{ ok = $true; ytdlp = $YtDlp; ffmpeg = $ff; version = ''; error = $v }
}

function Cmd-Download($msg) {
  if (-not (Test-Path -LiteralPath $YtDlp)) {
    return @{ ok = $false; error = 'ytdlp_missing'; message = 'The downloader (yt-dlp) is missing. Run INSTALL-DOWNLOAD-HELPER.bat again, then try again.' }
  }
  # Only accept a plain YouTube watch URL, so nothing else can be passed to yt-dlp.
  $url = "$($msg.url)"
  if ($url -notmatch '^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$') {
    return @{ ok = $false; error = 'bad_url'; message = 'Not a YouTube video URL' }
  }
  $mode = 'video'; if ($msg.mode -eq 'audio') { $mode = 'audio' }
  $audioFormat = 'm4a'; if ($msg.audioFormat -eq 'mp3') { $audioFormat = 'mp3' }
  $quicktime = [bool]$msg.quicktime
  $hasFfmpeg = Test-Path -LiteralPath $Ffmpeg

  try {
    $folder = Expand-Folder $msg.folder
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
  } catch {
    return @{ ok = $false; error = 'folder'; message = "Can't use folder $($msg.folder): $($_.Exception.Message)" }
  }

  Remove-OldJobs
  Update-YtDlp
  $id = [guid]::NewGuid().ToString()

  $a = @('--newline', '--progress', '--no-playlist', '--no-cache-dir', '--no-mtime', '--no-colors',
    '-P', $folder, '-o', '%(title).180B [%(id)s].%(ext)s',
    '--print-to-file', 'after_move:filepath', (Job-File $id 'path'))
  if ($hasFfmpeg) { $a += @('--ffmpeg-location', $Ffmpeg) }
  if ($mode -eq 'audio') {
    if ($hasFfmpeg) {
      $a += @('-f', 'ba/b', '-x', '--audio-format', $audioFormat)
      if ($audioFormat -eq 'mp3') { $a += @('--audio-quality', '0') }
    } else { $a += @('-f', 'ba[ext=m4a]/ba') }
  } elseif (-not $hasFfmpeg) { $a += @('-f', 'b[ext=mp4]/b') }
  elseif ($quicktime) { $a += @('-f', 'bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4') }
  else { $a += @('-f', 'bv*+ba/b', '--merge-output-format', 'mp4') }
  $a += @('--', $url)

  # One small .cmd per job: run yt-dlp, keep its output, then record the exit code.
  $cmdFile = Job-File $id 'cmd'
  $lines = @(
    '@echo off',
    'chcp 65001 >nul',
    'set PYTHONIOENCODING=utf-8',
    ((@($YtDlp) + $a | ForEach-Object { Quote-Cmd $_ }) -join ' ') + ' > ' + (Quote-Cmd (Job-File $id 'log')) + ' 2>&1',
    '>' + (Quote-Cmd (Job-File $id 'exit')) + ' echo %ERRORLEVEL%'
  )
  [IO.File]::WriteAllText($cmdFile, ($lines -join "`r`n") + "`r`n", (New-Object Text.UTF8Encoding $false))

  # WMI starts it outside Chrome's process job, hidden, so it keeps running after we exit.
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = 'cmd.exe /d /s /c ""' + $cmdFile + '""'
    CurrentDirectory = $folder
    ProcessStartupInformation = $startup
  }
  if ($r.ReturnValue -ne 0) {
    return @{ ok = $false; error = 'launch'; message = "Couldn't start yt-dlp (code $($r.ReturnValue))." }
  }
  Set-Content -LiteralPath (Job-File $id 'pid') -Value $r.ProcessId -Encoding ASCII
  return @{ ok = $true; jobId = $id; folder = $folder }
}

function Cmd-Status($msg) {
  $id = $msg.jobId
  if (-not (Test-JobId $id)) { return @{ ok = $false; error = 'bad_job' } }
  if (Test-Path -LiteralPath (Job-File $id 'cancelled')) { return @{ ok = $true; state = 'cancelled' } }

  $logText = Read-Shared (Job-File $id 'log')
  if ($null -eq $logText) { $logText = '' }
  $lines = @($logText -split "`r?`n" | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_.Trim() -ne '' })

  $exitText = Read-Shared (Job-File $id 'exit')
  if ($null -eq $exitText) {
    # No exit code but the process is gone: it was killed (e.g. sign-out or restart).
    $pidText = Read-Shared (Job-File $id 'pid')
    if ($pidText -and -not (Get-Process -Id ([int]$pidText.Trim()) -ErrorAction SilentlyContinue)) {
      Start-Sleep -Milliseconds 300
      $exitText = Read-Shared (Job-File $id 'exit')
      if ($null -eq $exitText) { return @{ ok = $true; state = 'error'; message = 'The download stopped unexpectedly. Try again.' } }
    }
  }

  if ($null -ne $exitText) {
    $code = -1
    [void][int]::TryParse($exitText.Trim(), [ref]$code)
    if ($code -eq 0) {
      $pathText = Read-Shared (Job-File $id 'path')
      $file = ''
      if ($pathText) { $file = @($pathText -split "`r?`n" | Where-Object { $_.Trim() -ne '' })[-1] }
      return @{ ok = $true; state = 'done'; percent = 100; file = $file }
    }
    $err = @($lines | Where-Object { $_.StartsWith('ERROR:') })
    $message = "yt-dlp stopped with code $code"
    if ($err.Count -gt 0) { $message = $err[-1].Substring(6).Trim() }
    return @{ ok = $true; state = 'error'; message = $message }
  }

  # Still running: work out the progress from the log.
  $percent = 0.0; $speed = ''; $eta = ''
  $prog = @($lines | Where-Object { $_.StartsWith('[download]') -and $_.Contains('%') })
  if ($prog.Count -gt 0) {
    $line = $prog[-1]
    [void][double]::TryParse((First-Match '([0-9.]+)%' $line), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$percent)
    $speed = First-Match 'at\s+(\S+)' $line
    $eta = First-Match 'ETA\s+(\S+)' $line
  }
  # Video + audio are downloaded as two files: show one combined percentage.
  $streams = 1
  $fmt = @($lines | Where-Object { $_.Contains('Downloading') -and $_.Contains('format(s):') })
  if ($fmt.Count -gt 0) { $streams = $fmt[0].Split('+').Count }
  $started = @($lines | Where-Object { $_.StartsWith('[download] Destination:') }).Count
  if ($streams -gt 1 -and $started -gt 0) {
    $percent = (([Math]::Min($started, $streams) - 1) * 100 + $percent) / $streams
  }
  $state = 'downloading'
  if ($lines.Count -eq 0) { $state = 'starting' }
  else {
    $last = $lines[-1]
    foreach ($p in @('[Merger]', '[ExtractAudio]', '[Fixup', '[VideoConvertor]', '[MoveFiles]', 'Deleting')) {
      if ($last.StartsWith($p)) { $state = 'processing' }
    }
  }
  return @{ ok = $true; state = $state; percent = [Math]::Min(100, $percent); speed = $speed; eta = $eta }
}

function Cmd-Cancel($msg) {
  $id = $msg.jobId
  if (-not (Test-JobId $id)) { return @{ ok = $false; error = 'bad_job' } }
  New-Item -ItemType File -Force -Path (Job-File $id 'cancelled') | Out-Null
  $pidText = Read-Shared (Job-File $id 'pid')
  $procId = 0
  if ($pidText -and [int]::TryParse($pidText.Trim(), [ref]$procId) -and $procId -gt 4) {
    # /T also stops yt-dlp and ffmpeg started by the job's cmd.exe
    $null = & taskkill.exe /PID $procId /T /F 2>&1
  }
  return @{ ok = $true }
}

function Cmd-Reveal($msg) {
  $path = "$($msg.path)"
  if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return @{ ok = $false; error = 'not_found' } }
  Start-Process -FilePath 'explorer.exe' -ArgumentList "/select,`"$path`""
  return @{ ok = $true }
}

# ---------------------------------------------------------------- main

try {
  $msg = Read-Message
  if ($null -eq $msg) { exit 0 }
  switch ("$($msg.cmd)") {
    'check'    { $reply = Cmd-Check }
    'download' { $reply = Cmd-Download $msg }
    'status'   { $reply = Cmd-Status $msg }
    'cancel'   { $reply = Cmd-Cancel $msg }
    'reveal'   { $reply = Cmd-Reveal $msg }
    'backup'   { $reply = @{ ok = $false; error = 'unsupported' } }
    'restore'  { $reply = @{ ok = $false; error = 'unsupported' } }
    default    { $reply = @{ ok = $false; error = 'unknown_command' } }
  }
} catch {
  $reply = @{ ok = $false; error = 'helper'; message = $_.Exception.Message }
  Log "error in '$($msg.cmd)': $($_.Exception.Message) at line $($_.InvocationInfo.ScriptLineNumber)"
}
if ($reply.ok -eq $false) { Log "'$($msg.cmd)' -> $($reply | ConvertTo-Json -Compress)" }
Write-Message $reply
