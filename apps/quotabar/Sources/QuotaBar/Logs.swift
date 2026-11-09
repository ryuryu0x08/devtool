// The app's logs, under ~/Library/Logs/QuotaBar (local time; no keys in them). Only the last 10
// minutes are kept: every minute the older lines are removed (LogTrim), and so are files left
// there with nothing newer.
import Foundation
import QuotaCore

/// A log under ~/Library/Logs/QuotaBar, kept under 1 MB.
struct LogFile: Sendable {
  static let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/QuotaBar")
  /// How long a line is kept (seconds).
  static let keep: TimeInterval = 600

  let url: URL
  private static let queue = DispatchQueue(label: "QuotaBar.Log")

  /// "2026-11-04 20:15:03.123 +0800": this Mac's clock and time zone (not UTC).
  static func stamp(_ d: Date) -> String {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = .current
    f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS Z"
    return f.string(from: d)
  }

  init(_ name: String) {
    url = Self.dir.appendingPathComponent(name)
  }

  func write(_ line: String) {
    let text = Self.stamp(Date()) + " " + line + "\n"
    let url = self.url
    Self.queue.async {
      let fm = FileManager.default
      try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      if let size = try? fm.attributesOfItem(atPath: url.path)[.size] as? Int, size > 1_000_000 { try? fm.removeItem(at: url) }
      if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
      guard let h = try? FileHandle(forWritingTo: url) else { return }
      defer { try? h.close() }
      _ = try? h.seekToEnd()
      try? h.write(contentsOf: Data(text.utf8))
    }
  }
}

extension LogFile {
  /// Removes what is older than `keep` from every log in the folder (on the queue the logs are
  /// written on, so no line is lost to it); a file left with nothing is removed, and so is any
  /// other file there not changed within `keep`.
  static func trimAll(now: Date = Date()) {
    queue.async {
      let fm = FileManager.default
      let since = now.addingTimeInterval(-keep)
      guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.isRegularFileKey, .contentModificationDateKey]) else { return }
      for f in files {
        let v = try? f.resourceValues(forKeys: [.isRegularFileKey, .contentModificationDateKey])
        guard v?.isRegularFile == true else { continue }
        guard f.pathExtension == "log", let text = try? String(contentsOf: f, encoding: .utf8) else {
          if (v?.contentModificationDate ?? .distantPast) < since { try? fm.removeItem(at: f) }
          continue
        }
        let kept = LogTrim.keep(text, since: since)
        if kept.isEmpty {
          try? fm.removeItem(at: f)
        } else if kept != text {
          try? kept.write(to: f, atomically: true, encoding: .utf8)
        }
      }
    }
  }
}

/// The forwarder's log: ~/Library/Logs/QuotaBar/forwarder.log (request lines, the names of the
/// headers left out, reply statuses; no header values, so no keys).
enum ForwardLog {
  static let file = LogFile("forwarder.log")
  static var url: URL { file.url }

  static func write(_ line: String) {
    FileHandle.standardError.write(Data(("QuotaBar forwarder: " + line + "\n").utf8))
    file.write(line)
  }
}

/// Failed readings and when they pass again: ~/Library/Logs/QuotaBar/refresh.log (the person's
/// name and why; no keys).
enum RefreshLog {
  static let file = LogFile("refresh.log")
  static var url: URL { file.url }
  static func write(_ line: String) { file.write(line) }
}
