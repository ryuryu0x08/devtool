// Updates come from the git clone the app was built from: the repository is private, and the
// clone already has the access (the user's own git credentials). The app follows the
// quotabar-stable branch, which CI moves only after a version built and passed its tests on a Mac.
import Foundation

public struct SourceUpdate: Sendable {
  public static let branch = "quotabar-stable"
  /// The folder build.sh is in (mac/QuotaBar inside the clone).
  public let dir: URL
  /// git runs with what the user's shell sets (its ssh agent, proxy, PATH): an app opened from
  /// Finder doesn't have them, and git over ssh then has no key ("Permission denied (publickey)").
  public var shellEnv: Bool

  public init(dir: URL, shellEnv: Bool = false) {
    self.dir = dir
    self.shellEnv = shellEnv
  }

  public struct Failed: Error, LocalizedError, Equatable {
    public let message: String
    public var errorDescription: String? { message }
  }

  private var remoteRef: String { "refs/remotes/origin/\(Self.branch)" }

  /// Fetches the stable branch; how many of its commits change the app (this folder) since
  /// `commit`, and the newest one's subject.
  public func newer(than commit: String) throws -> (count: Int, subject: String?) {
    try fetch()
    let n = Int(try git(["rev-list", "--count", "\(commit)..\(remoteRef)", "--", "."]).trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
    guard n > 0 else { return (0, nil) }
    let s = try git(["log", "-1", "--format=%s", remoteRef, "--", "."]).trimmingCharacters(in: .whitespacesAndNewlines)
    return (n, s.isEmpty ? nil : s)
  }

  /// Fetches the stable branch from origin. A GitHub ssh address wants a key even for a public
  /// repository: if that fails, the same repository over https (no key needed when public).
  func fetch() throws {
    let spec = "+refs/heads/\(Self.branch):\(remoteRef)"
    do {
      try git(["fetch", "--quiet", "--no-tags", "origin", spec], timeout: 90)
    } catch {
      let origin = (try? git(["remote", "get-url", "origin"]))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      guard let https = Self.https(for: origin) else { throw error }
      do {
        try git(["-c", "credential.interactive=never", "fetch", "--quiet", "--no-tags", https, spec], timeout: 90)
      } catch let second {
        throw Failed(message: error.localizedDescription + "；改用 \(https) 也失败：" + second.localizedDescription)
      }
    }
  }

  /// The https address of a GitHub ssh address (git@github.com:o/r.git, ssh://git@github.com/o/r);
  /// nil for anything else.
  public static func https(for remote: String) -> String? {
    var path: Substring
    if remote.hasPrefix("git@github.com:") {
      path = remote.dropFirst("git@github.com:".count)
    } else if let r = remote.range(of: "github.com/"), remote.hasPrefix("ssh://") {
      path = remote[r.upperBound...]
    } else {
      return nil
    }
    while path.hasPrefix("/") { path = path.dropFirst() }
    guard !path.isEmpty else { return nil }
    return "https://github.com/" + path
  }

  /// Moves the checkout forward to the fetched stable branch (only forward: local commits or
  /// changes in the way stop it, with git's reason).
  public func fastForward() throws {
    try git(["merge", "--ff-only", "--quiet", remoteRef], timeout: 60)
  }

  @discardableResult
  public func git(_ args: [String], timeout: TimeInterval = 30) throws -> String {
    try Self.run(["git"] + args, in: dir, timeout: timeout, extra: shellEnv ? ShellEnv.values : [:])
  }

  /// Runs a command (found on the usual paths; an app opened from Finder has a short PATH),
  /// without prompts: git fails rather than wait for a password nobody can type.
  @discardableResult
  public static func run(_ cmd: [String], in dir: URL, timeout: TimeInterval, log: URL? = nil, extra: [String: String] = [:]) throws -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    p.arguments = cmd
    p.currentDirectoryURL = dir
    var env = ProcessInfo.processInfo.environment
    env.merge(extra) { _, new in new }
    env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin" + (env["PATH"].map { ":" + $0 } ?? "")
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_SSH_COMMAND"] = env["GIT_SSH_COMMAND"] ?? "ssh -o BatchMode=yes"
    p.environment = env
    let out = Pipe()
    let file: FileHandle?
    if let log {
      try? FileManager.default.createDirectory(at: log.deletingLastPathComponent(), withIntermediateDirectories: true)
      FileManager.default.createFile(atPath: log.path, contents: nil)
      file = try FileHandle(forWritingTo: log)
    } else {
      file = nil
    }
    p.standardOutput = file ?? out
    p.standardError = file ?? out
    p.standardInput = FileHandle.nullDevice
    // Read as it comes (a full pipe would stop the command).
    let box = Box()
    if file == nil {
      out.fileHandleForReading.readabilityHandler = { h in box.append(h.availableData) }
    }
    try p.run()
    let deadline = Date().addingTimeInterval(timeout)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.05) }
    if p.isRunning {
      p.terminate()
      p.waitUntilExit()
      out.fileHandleForReading.readabilityHandler = nil
      throw Failed(message: "\(cmd.first ?? "") 超时")
    }
    p.waitUntilExit()
    out.fileHandleForReading.readabilityHandler = nil
    if file == nil { box.append(out.fileHandleForReading.readDataToEndOfFile()) }
    try? file?.close()
    var text = String(decoding: box.data, as: UTF8.self)
    if let log, file != nil { text = (try? String(contentsOf: log, encoding: .utf8)) ?? "" }
    guard p.terminationStatus == 0 else {
      let why = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.prefix(3).joined(separator: " ")
      throw Failed(message: why.isEmpty ? "\(cmd.joined(separator: " ")) 失败（\(p.terminationStatus)）" : why)
    }
    return text
  }

  private final class Box: @unchecked Sendable {
    private let lock = NSLock()
    private var d = Data()
    func append(_ x: Data) { lock.lock(); d.append(x); lock.unlock() }
    var data: Data { lock.lock(); defer { lock.unlock() }; return d }
  }
}

/// What the user's login shell sets that git needs (read once, from `$SHELL -l -i`): the ssh
/// agent (keys added with ssh-add in a terminal, or another agent set up in .zshrc), the proxy,
/// PATH, git's own ssh setting.
public enum ShellEnv {
  static let wanted: Set<String> = [
    "SSH_AUTH_SOCK", "SSH_AGENT_PID", "PATH", "GIT_SSH", "GIT_SSH_COMMAND",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
  ]
  static let mark = "__QUOTABAR_ENV__"

  public static let values: [String: String] = {
    let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
    let out = try? SourceUpdate.run([shell, "-l", "-i", "-c", "printf '\\n\(mark)\\n'; /usr/bin/env; printf '\\n\(mark)\\n'"], in: FileManager.default.homeDirectoryForCurrentUser, timeout: 10)
    return parse(out ?? "")
  }()

  /// The wanted, non-empty variables printed between the two marks (what the shell's startup
  /// files print around them is left out).
  static func parse(_ out: String) -> [String: String] {
    let parts = out.components(separatedBy: "\n" + mark + "\n")
    guard parts.count >= 3 else { return [:] }
    var r: [String: String] = [:]
    for line in parts[1].split(separator: "\n") {
      guard let eq = line.firstIndex(of: "=") else { continue }
      let k = String(line[..<eq]), v = String(line[line.index(after: eq)...])
      if wanted.contains(k) && !v.isEmpty { r[k] = v }
    }
    return r
  }
}

/// Putting a newly built app where the running one is. The running app keeps going (its files
/// are open already); the next launch is the new one.
public enum AppSwap {
  /// Replaces the bundle at `app` with a copy of `built`, in one step (a copy beside it first, on
  /// the same disk, then swapped in): a failure leaves the old one where it was.
  public static func replace(_ app: URL, with built: URL) throws {
    let fm = FileManager.default
    guard fm.fileExists(atPath: built.appendingPathComponent("Contents/MacOS").path) else {
      throw SourceUpdate.Failed(message: "没有编译出的 app：\(built.path)")
    }
    let temp = app.deletingLastPathComponent().appendingPathComponent(".\(app.deletingPathExtension().lastPathComponent)-new-\(UUID().uuidString).app")
    try fm.copyItem(at: built, to: temp)
    do {
      if fm.fileExists(atPath: app.path) {
        _ = try fm.replaceItemAt(app, withItemAt: temp)
      } else {
        try fm.moveItem(at: temp, to: app)
      }
    } catch {
      try? fm.removeItem(at: temp)
      throw error
    }
  }

  /// "--after-update <pid>" among the arguments: the app that launched this one, which is to be
  /// gone before this one starts (it holds the forwarder's port).
  public static func previous(in args: [String]) -> pid_t? {
    guard let i = args.firstIndex(of: "--after-update"), i + 1 < args.count else { return nil }
    return pid_t(args[i + 1])
  }

  /// Waits (up to `limit`) for process `pid` to be gone.
  public static func wait(for pid: pid_t, limit: TimeInterval = 15) {
    let end = Date().addingTimeInterval(limit)
    while kill(pid, 0) == 0 && Date() < end { usleep(50_000) }
  }
}
