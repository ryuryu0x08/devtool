// Keeping only the last minutes of a log. Each line the app writes starts with the time
// ("2026-11-04 20:15:03.123 +0800"); lines without one (a build's output) belong to the timed
// line before them and go with it.
import Foundation

public enum LogTrim {
  /// The part of `text` written at or after `since`; "" if none of it was. Lines before the first
  /// timed one are dropped (whose they are isn't known).
  public static func keep(_ text: String, since: Date) -> String {
    var out: [Substring] = []
    var keeping = false
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
      if let t = time(line) { keeping = t >= since }
      if keeping { out.append(line) }
    }
    // A text that ended with a newline keeps it (split leaves an empty last piece for it).
    while out.last == "" { out.removeLast() }
    return out.isEmpty ? "" : out.joined(separator: "\n") + "\n"
  }

  private static let format: DateFormatter = {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS Z"
    return f
  }()
  private static let lock = NSLock()

  /// The time a line starts with, if it starts with one.
  static func time(_ line: Substring) -> Date? {
    guard line.count >= 29 else { return nil }
    let head = line.prefix(29)
    guard head.first?.isNumber == true, head.dropFirst(4).first == "-" else { return nil }
    lock.lock()
    defer { lock.unlock() }
    return format.date(from: String(head))
  }
}
