//
//  SafariWebExtensionHandler.swift
//  YT Premium Vibe Extension
//
//  Native side of the Download feature. The web extension calls
//  browser.runtime.sendNativeMessage(...) and Safari delivers the message here.
//
//  Commands (message["cmd"]):
//    check    → is yt-dlp / ffmpeg installed? which version?
//    download → start yt-dlp in the background, returns a jobId right away
//    status   → progress of a job (percent, speed, ETA, final file)
//    cancel   → stop a job
//    reveal   → show the finished file in Finder
//
//  How a job runs: yt-dlp is started through /bin/sh, which writes its output
//  to a log file, its PID to a pid file, and its exit code to an exit file. All
//  of that lives in this extension's Caches folder. Each status call just reads
//  those files, so progress keeps working even if macOS restarts this extension
//  process between messages.
//

import AppKit
import CryptoKit
import SafariServices
import os.log

private let log = OSLog(subsystem: "com.ytpremiumvibe.app.Extension", category: "native")

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]

        let reply = Downloader.handle(message)

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: reply]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}

// MARK: - Downloader

enum Downloader {

    // MARK: Paths

    /// The user's real home folder. Inside the sandbox NSHomeDirectory()
    /// points to the extension's container, so we ask the system instead.
    static let realHome: String = {
        if let pw = getpwuid(getuid()), let dir = pw.pointee.pw_dir {
            return String(cString: dir)
        }
        return NSHomeDirectory()
    }()

    static let jobsDir: URL = {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let dir = caches.appendingPathComponent("jobs", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    static func jobFile(_ id: String, _ ext: String) -> URL {
        jobsDir.appendingPathComponent("\(id).\(ext)")
    }

    static let toolDirs = ["/opt/homebrew/bin", "/usr/local/bin", "\(realHome)/.local/bin", "\(realHome)/bin", "/usr/bin"]

    /// Look for a Homebrew / pip / system install of a tool.
    static func find(_ tool: String) -> String? {
        toolDirs.map { "\($0)/\(tool)" }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// A Python 3.10+ interpreter (yt-dlp needs 3.10 or newer; macOS's own python3 is 3.9).
    static func findPython() -> String? {
        let fm = FileManager.default
        var candidates = ["/opt/homebrew/bin/python3", "/usr/local/bin/python3"]
        let local = "\(realHome)/.local/bin"
        let localPythons = ((try? fm.contentsOfDirectory(atPath: local)) ?? [])
            .filter { $0.range(of: #"^python3\.1\d+$"#, options: .regularExpression) != nil }
            .sorted { $0.compare($1, options: .numeric) == .orderedDescending }
        candidates += localPythons.map { "\(local)/\($0)" }
        let uv = "\(realHome)/.local/share/uv/python"
        for dir in ((try? fm.contentsOfDirectory(atPath: uv)) ?? []).sorted(by: >) where dir.hasPrefix("cpython-3.1") {
            candidates.append("\(uv)/\(dir)/bin/python3")
        }
        return candidates.first { fm.isExecutableFile(atPath: $0) }
    }

    /// How to run yt-dlp inside the sandbox.
    /// - Homebrew's yt-dlp is a Python script with an absolute shebang: run it directly.
    /// - The "zipapp" build (#!/usr/bin/env python3): run it with a Python 3.10+ we found.
    /// - The standalone macOS build (a PyInstaller binary) can't run in Safari's sandbox,
    ///   because it needs system semaphores the sandbox blocks. We report that clearly.
    enum YtDlp {
        case ok(exe: String, prefix: [String], path: String)
        case standalone(path: String)
        case missing
        case noPython
    }

    // MARK: Managed yt-dlp (downloaded automatically, so nothing needs installing by hand)

    static let managedYtDlp: URL = {
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = support.appendingPathComponent("yt-dlp", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("yt-dlp")
    }()

    static func fetch(_ url: String, timeout: TimeInterval) -> Data? {
        guard let u = URL(string: url) else { return nil }
        var result: Data?
        let sem = DispatchSemaphore(value: 0)
        var req = URLRequest(url: u, timeoutInterval: timeout)
        req.setValue("YT-Premium-Vibe", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: req) { data, resp, _ in
            if (resp as? HTTPURLResponse)?.statusCode == 200 { result = data }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + timeout + 5)
        return result
    }

    /// Download the official Python build of yt-dlp from GitHub and verify it
    /// against the release's SHA-256 checksums before keeping it.
    @discardableResult
    static func installManagedYtDlp() -> Bool {
        let base = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/"
        guard let data = fetch(base + "yt-dlp", timeout: 90),
              let sumsData = fetch(base + "SHA2-256SUMS", timeout: 30),
              let sums = String(data: sumsData, encoding: .utf8) else {
            os_log(.error, log: log, "yt-dlp download failed")
            return false
        }
        let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let verified = sums.split(separator: "\n").contains { line in
            let parts = line.split(separator: " ", omittingEmptySubsequences: true)
            return parts.count == 2 && parts[0] == hash && parts[1] == "yt-dlp"
        }
        guard verified else {
            os_log(.error, log: log, "yt-dlp checksum mismatch, not installing")
            return false
        }
        let tmp = managedYtDlp.appendingPathExtension("tmp")
        do {
            try data.write(to: tmp, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: tmp.path)
            _ = try? FileManager.default.removeItem(at: managedYtDlp)
            try FileManager.default.moveItem(at: tmp, to: managedYtDlp)
            os_log(.default, log: log, "installed managed yt-dlp")
            return true
        } catch {
            os_log(.error, log: log, "yt-dlp install failed: %{public}@", error.localizedDescription)
            return false
        }
    }

    /// The managed copy, downloading or refreshing it when needed (YouTube changes
    /// often, so copies older than 14 days are updated; an old copy is kept if the update fails).
    static func managedYtDlpPath(allowDownload: Bool) -> String? {
        let fm = FileManager.default
        let path = managedYtDlp.path
        if fm.fileExists(atPath: path) {
            let age = (try? fm.attributesOfItem(atPath: path)[.modificationDate] as? Date).map { -$0.timeIntervalSinceNow } ?? 0
            if allowDownload && age > 14 * 24 * 3600 { installManagedYtDlp() }
            return path
        }
        guard allowDownload else { return nil }
        return installManagedYtDlp() ? path : nil
    }

    static func locateYtDlp(allowDownload: Bool = true) -> YtDlp {
        var standalone: String?
        for dir in toolDirs {
            let path = "\(dir)/yt-dlp"
            guard FileManager.default.isExecutableFile(atPath: path),
                  let fh = FileHandle(forReadingAtPath: path) else { continue }
            let head = fh.readData(ofLength: 256)
            try? fh.close()
            guard head.starts(with: [0x23, 0x21]) else { // not "#!": a compiled binary
                standalone = standalone ?? path
                continue
            }
            let firstLine = String(decoding: head, as: UTF8.self).split(separator: "\n").first.map(String.init) ?? ""
            if firstLine.contains("/env ") {
                if let python = findPython() { return .ok(exe: python, prefix: [path], path: path) }
                continue
            }
            return .ok(exe: path, prefix: [], path: path)
        }
        // Nothing usable installed: use (or fetch) our own verified copy.
        if let python = findPython() {
            if let managed = managedYtDlpPath(allowDownload: allowDownload) {
                return .ok(exe: python, prefix: [managed], path: managed)
            }
            if let s = standalone { return .standalone(path: s) }
            return .missing
        }
        if let s = standalone { return .standalone(path: s) }
        return .noPython
    }

    static let zipappFix = "curl -fL -o ~/.local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp && chmod +x ~/.local/bin/yt-dlp"

    /// "~/Downloads" → "/Users/you/Downloads". Relative paths are put under home.
    static func expandFolder(_ raw: String?) -> String {
        var path = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if path.isEmpty { path = "~/Downloads" }
        if path == "~" { path = realHome }
        else if path.hasPrefix("~/") { path = realHome + String(path.dropFirst(1)) }
        else if !path.hasPrefix("/") { path = realHome + "/" + path }
        return (path as NSString).standardizingPath
    }

    static var environment: [String: String] {
        [
            "PATH": "/opt/homebrew/bin:/usr/local/bin:\(realHome)/.local/bin:/usr/bin:/bin",
            "HOME": realHome,
            "LANG": "en_US.UTF-8",          // keeps Bangla/Hindi titles intact in filenames
            "LC_ALL": "en_US.UTF-8",
            "PYTHONIOENCODING": "utf-8",
            "PYTHONDONTWRITEBYTECODE": "1",
            "TMPDIR": NSTemporaryDirectory()
        ]
    }

    // MARK: Router

    static func handle(_ msg: [String: Any]) -> [String: Any] {
        switch msg["cmd"] as? String {
        case "check": return check()
        case "download": return download(msg)
        case "status": return status(msg)
        case "cancel": return cancel(msg)
        case "reveal": return reveal(msg)
        default: return ["ok": false, "error": "unknown_command"]
        }
    }

    // MARK: check

    static func check() -> [String: Any] {
        let ffmpeg = find("ffmpeg")
        switch locateYtDlp() {
        case let .ok(exe, prefix, path):
            let out = run(exe, prefix + ["--version"], timeout: 30)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let works = out.range(of: #"^\d{4}\.\d"#, options: .regularExpression) != nil
            return ["ok": true, "ytdlp": path, "ffmpeg": ffmpeg ?? NSNull(),
                    "version": works ? out : "", "error": works ? NSNull() : (String(out.suffix(300)) as Any)]
        case let .standalone(path):
            return ["ok": true, "ytdlp": NSNull(), "standalone": path, "ffmpeg": ffmpeg ?? NSNull(), "fix": zipappFix]
        case .missing:
            return ["ok": true, "ytdlp": NSNull(), "ffmpeg": ffmpeg ?? NSNull(),
                    "error": "Couldn't download yt-dlp. Check your internet connection and try again."]
        case .noPython:
            return ["ok": true, "ytdlp": NSNull(), "ffmpeg": ffmpeg ?? NSNull(),
                    "error": "Python 3.10 or newer is needed to run yt-dlp."]
        }
    }

    /// Run a short command and return its output (used for --version).
    static func run(_ exe: String, _ args: [String], timeout: TimeInterval) -> String? {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: exe)
        p.arguments = args
        p.environment = environment
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        do { try p.run() } catch {
            os_log(.error, log: log, "run failed: %{public}@", error.localizedDescription)
            return nil
        }
        let deadline = Date().addingTimeInterval(timeout)
        while p.isRunning && Date() < deadline { usleep(50_000) }
        if p.isRunning { p.terminate(); return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        return String(data: data, encoding: .utf8)
    }

    // MARK: download

    static func download(_ msg: [String: Any]) -> [String: Any] {
        let exe: String
        let prefix: [String]
        switch locateYtDlp() {
        case let .ok(e, p, _): exe = e; prefix = p
        case .standalone:
            return ["ok": false, "error": "ytdlp_standalone", "fix": zipappFix,
                    "message": "This yt-dlp build can't run inside Safari's sandbox. Replace it with the Python version."]
        case .missing:
            return ["ok": false, "error": "ytdlp_missing",
                    "message": "Couldn't download yt-dlp automatically. Check your internet connection and try again."]
        case .noPython:
            return ["ok": false, "error": "python_missing",
                    "message": "Python 3.10 or newer is needed to run yt-dlp."]
        }
        // Only accept a plain YouTube watch URL, so nothing else can be passed to yt-dlp.
        guard let url = msg["url"] as? String,
              url.range(of: #"^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil
        else {
            return ["ok": false, "error": "bad_url", "message": "Not a YouTube video URL"]
        }

        let mode = (msg["mode"] as? String) == "audio" ? "audio" : "video"
        let audioFormat = (msg["audioFormat"] as? String) == "mp3" ? "mp3" : "m4a"
        let quicktime = msg["quicktime"] as? Bool ?? false
        let ffmpeg = find("ffmpeg")

        let folder = expandFolder(msg["folder"] as? String)
        do {
            try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        } catch {
            return ["ok": false, "error": "folder", "message": "Can't use folder \(folder): \(error.localizedDescription)"]
        }

        cleanupOldJobs()
        let id = UUID().uuidString

        var args = [
            "--newline", "--progress", "--no-playlist", "--no-cache-dir", "--no-mtime", "--no-colors",
            "-P", folder,
            "-o", "%(title).180B [%(id)s].%(ext)s",
            "--print-to-file", "after_move:filepath", jobFile(id, "path").path
        ]
        if let ffmpeg = ffmpeg { args += ["--ffmpeg-location", ffmpeg] }

        if mode == "audio" {
            if ffmpeg != nil {
                args += ["-f", "ba/b", "-x", "--audio-format", audioFormat]
                if audioFormat == "mp3" { args += ["--audio-quality", "0"] }
            } else {
                args += ["-f", "ba[ext=m4a]/ba"] // no ffmpeg: download the audio stream as-is
            }
        } else if ffmpeg == nil {
            args += ["-f", "b[ext=mp4]/b"] // no ffmpeg: best single file (usually ≤ 720p)
        } else if quicktime {
            args += ["-f", "bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b", "--merge-output-format", "mp4"]
        } else {
            args += ["-f", "bv*+ba/b", "--merge-output-format", "mp4"]
        }
        args += ["--", url]

        // $0 = yt-dlp, "$@" = its arguments. Output → log, PID → pid file, exit code → exit file.
        let script = """
        "$0" "$@" >"$YTPV_LOG" 2>&1 &
        pid=$!
        echo "$pid" >"$YTPV_PID"
        wait "$pid"
        echo "$?" >"$YTPV_EXIT"
        """
        var env = environment
        env["YTPV_LOG"] = jobFile(id, "log").path
        env["YTPV_PID"] = jobFile(id, "pid").path
        env["YTPV_EXIT"] = jobFile(id, "exit").path

        let meta: [String: Any] = ["mode": mode, "folder": folder, "url": url, "started": Date().timeIntervalSince1970]
        if let data = try? JSONSerialization.data(withJSONObject: meta) {
            try? data.write(to: jobFile(id, "json"))
        }

        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", script, exe] + prefix + args
        p.environment = env
        p.currentDirectoryURL = URL(fileURLWithPath: folder)
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        do {
            try p.run()
        } catch {
            os_log(.error, log: log, "launch failed: %{public}@", error.localizedDescription)
            return ["ok": false, "error": "launch", "message": "Couldn't start yt-dlp: \(error.localizedDescription)"]
        }
        os_log(.default, log: log, "started job %{public}@ (%{public}@)", id, mode)
        return ["ok": true, "jobId": id, "folder": folder]
    }

    // MARK: status

    static func status(_ msg: [String: Any]) -> [String: Any] {
        guard let id = msg["jobId"] as? String, UUID(uuidString: id) != nil else {
            return ["ok": false, "error": "bad_job"]
        }
        let logText = (try? String(contentsOf: jobFile(id, "log"), encoding: .utf8)) ?? ""

        // Finished?
        if let exitText = try? String(contentsOf: jobFile(id, "exit"), encoding: .utf8) {
            if FileManager.default.fileExists(atPath: jobFile(id, "cancelled").path) {
                return ["ok": true, "state": "cancelled"]
            }
            let code = Int(exitText.trimmingCharacters(in: .whitespacesAndNewlines)) ?? -1
            if code == 0 {
                let pathText = (try? String(contentsOf: jobFile(id, "path"), encoding: .utf8)) ?? ""
                let file = pathText.split(separator: "\n").last.map(String.init) ?? ""
                return ["ok": true, "state": "done", "percent": 100, "file": file]
            }
            let errorLine = logText.split(separator: "\n").last { $0.hasPrefix("ERROR:") }
                .map { String($0.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
            return ["ok": true, "state": "error", "message": errorLine ?? "yt-dlp stopped with code \(code)"]
        }

        // Still running: work out the progress from the log.
        let lines = logText.split(separator: "\n").map(String.init)
        var percent = 0.0
        var speed = ""
        var eta = ""
        if let line = lines.last(where: { $0.hasPrefix("[download]") && $0.contains("%") }) {
            percent = Double(firstMatch(#"([0-9.]+)%"#, in: line) ?? "") ?? 0
            speed = firstMatch(#"at\s+(\S+)"#, in: line) ?? ""
            eta = firstMatch(#"ETA\s+(\S+)"#, in: line) ?? ""
        }

        // Video + audio are downloaded as two files: show one combined percentage.
        let streams = lines.first(where: { $0.contains("Downloading") && $0.contains("format(s):") })
            .map { $0.components(separatedBy: "+").count } ?? 1
        let started = lines.filter { $0.hasPrefix("[download] Destination:") }.count
        if streams > 1 && started > 0 {
            percent = (Double(min(started, streams) - 1) * 100 + percent) / Double(streams)
        }

        let last = lines.last(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) ?? ""
        let processing = ["[Merger]", "[ExtractAudio]", "[Fixup", "[VideoConvertor]", "[MoveFiles]", "Deleting"]
            .contains { last.hasPrefix($0) }

        return [
            "ok": true,
            "state": processing ? "processing" : (lines.isEmpty ? "starting" : "downloading"),
            "percent": min(100, percent),
            "speed": speed,
            "eta": eta
        ]
    }

    static func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let re = try? NSRegularExpression(pattern: pattern),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              m.numberOfRanges > 1, let r = Range(m.range(at: 1), in: text) else { return nil }
        return String(text[r])
    }

    // MARK: cancel

    static func cancel(_ msg: [String: Any]) -> [String: Any] {
        guard let id = msg["jobId"] as? String, UUID(uuidString: id) != nil else {
            return ["ok": false, "error": "bad_job"]
        }
        FileManager.default.createFile(atPath: jobFile(id, "cancelled").path, contents: nil)
        if let pidText = try? String(contentsOf: jobFile(id, "pid"), encoding: .utf8),
           let pid = Int32(pidText.trimmingCharacters(in: .whitespacesAndNewlines)), pid > 1 {
            kill(pid, SIGTERM)
        }
        return ["ok": true]
    }

    // MARK: reveal

    static func reveal(_ msg: [String: Any]) -> [String: Any] {
        guard let path = msg["path"] as? String, FileManager.default.fileExists(atPath: path) else {
            return ["ok": false, "error": "not_found"]
        }
        DispatchQueue.main.async {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        }
        return ["ok": true]
    }

    // MARK: housekeeping

    /// Delete job files older than 2 days.
    static func cleanupOldJobs() {
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: jobsDir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        let cutoff = Date().addingTimeInterval(-2 * 24 * 3600)
        for f in files {
            let date = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
            if date < cutoff { try? fm.removeItem(at: f) }
        }
    }
}
