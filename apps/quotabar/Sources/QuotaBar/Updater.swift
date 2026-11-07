// Checks for a newer version and installs it: from the git clone the app was built from (build.sh
// writes its folder and commit into Info.plist), on the branch CI moves after the tests passed.
// Installing: build.sh builds it, this app puts the build in its own place and opens it (it
// waits for this one to quit), then quits. (build.sh --install would quit this app itself, and
// macOS ends what an app started when it quits: the install would stop half way.)
import AppKit
import Foundation
import Observation
import QuotaCore

@MainActor @Observable
final class Updater {
  static let shared = Updater()

  enum State: Equatable {
    case idle
    case checking
    case upToDate
    case available(count: Int, subject: String?)
    case installing
    case failed(String)
    /// Built some other way (no clone to update from).
    case unavailable
  }

  private(set) var state = State.idle
  private(set) var lastCheck: Date?

  var auto: Bool {
    didSet { UserDefaults.standard.set(auto, forKey: "autoUpdate") }
  }

  let source: URL?
  let commit: String?
  let built: String?

  static let log = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/QuotaBar/update.log")

  @ObservationIgnored private var loop: Task<Void, Never>?

  private init() {
    let info = Bundle.main.infoDictionary ?? [:]
    commit = info["QBCommit"] as? String
    built = info["QBBuilt"] as? String
    source = (info["QBSourceDir"] as? String).map { URL(fileURLWithPath: $0, isDirectory: true) }
    auto = UserDefaults.standard.object(forKey: "autoUpdate") as? Bool ?? true
    if source == nil || commit == nil { state = .unavailable }
  }

  /// "a1b2c3d · 11-04 12:05"
  var version: String {
    let c = commit.map { String($0.prefix(7)) } ?? "未知"
    guard let built, let d = ISO8601DateFormatter().date(from: built) else { return c }
    let f = DateFormatter()
    f.dateFormat = "MM-dd HH:mm"
    return c + " · " + f.string(from: d)
  }

  /// Checks a little after launch and then every 6 hours; installs by itself if `auto`.
  func start(_ store: Store) {
    let d = UserDefaults.standard
    if let commit, let was = d.string(forKey: "lastRunCommit"), was != commit {
      store.notice = Notice(text: "已更新到 \(version)")
    }
    if let commit { d.set(commit, forKey: "lastRunCommit") }
    guard state != .unavailable else { return }
    loop = Task { [weak self] in
      try? await Task.sleep(for: .seconds(30))
      while !Task.isCancelled {
        guard let self else { return }
        await self.check(install: self.auto)
        try? await Task.sleep(for: .seconds(6 * 3600))
      }
    }
  }

  func check(install: Bool = false) async {
    guard let source, let commit, state != .checking, state != .installing else { return }
    guard FileManager.default.fileExists(atPath: source.appendingPathComponent("build.sh").path) else {
      state = .failed("源码目录不在了: \(source.path)")
      return
    }
    state = .checking
    let u = SourceUpdate(dir: source, shellEnv: true)
    do {
      let r = try await Task.detached { try u.newer(than: commit) }.value
      lastCheck = Date()
      state = r.count > 0 ? .available(count: r.count, subject: r.subject) : .upToDate
      if r.count > 0 && install { await self.install() }
    } catch {
      state = .failed("检查失败: " + error.localizedDescription)
      let agent = await Task.detached { ShellEnv.values["SSH_AUTH_SOCK"] != nil }.value
      LogFile("update.log").write("检查失败 (\(source.path), 终端 ssh agent: \(agent ? "已读到" : "没读到")): " + error.localizedDescription)
    }
  }

  /// Moves the clone forward, builds (about a minute) and puts the new app in place of this one,
  /// which then quits for it. If the build fails, this one stays as it is.
  func install() async {
    guard let source, state != .installing else { return }
    state = .installing
    let u = SourceUpdate(dir: source, shellEnv: true)
    let log = Self.log
    do {
      try await Task.detached { try u.fastForward() }.value
    } catch {
      state = .failed("更新失败: " + error.localizedDescription)
      return
    }
    do {
      _ = try await Task.detached { try SourceUpdate.run(["bash", "build.sh"], in: source, timeout: 900, log: log) }.value
    } catch {
      state = .failed("编译失败, 详见日志")
      return
    }
    await reinstall(from: source.appendingPathComponent("build/QuotaBar.app"))
  }

  /// Puts `built` where this app is, opens it and quits.
  func reinstall(from built: URL) async {
    let me = Bundle.main.bundleURL
    do {
      try await Task.detached { try AppSwap.replace(me, with: built) }.value
    } catch {
      state = .failed("安装失败: " + error.localizedDescription)
      return
    }
    let c = NSWorkspace.OpenConfiguration()
    c.createsNewApplicationInstance = true
    c.activates = false
    c.arguments = ["--after-update", String(ProcessInfo.processInfo.processIdentifier)]
    // Not awaited: the new one waits for this one to quit before it finishes launching. This
    // one quits once the new one's process is there.
    NSWorkspace.shared.openApplication(at: me, configuration: c) { _, error in
      guard let error else { return }
      Task { @MainActor in Updater.shared.state = .failed("新版本已装好, 但没能打开: " + error.localizedDescription + ". 请手动重开") }
    }
    let mine = ProcessInfo.processInfo.processIdentifier
    let id = Bundle.main.bundleIdentifier ?? "local.quotabar"
    let log = LogFile("update.log")
    log.write("已装好新版本, 打开它 (本进程 \(mine))")
    for _ in 0..<200 {
      // Seen by the system as an app, or (sooner) as a process of that name.
      let listed = NSRunningApplication.runningApplications(withBundleIdentifier: id).contains { $0.processIdentifier != mine }
      let pids = (try? SourceUpdate.run(["pgrep", "-x", "QuotaBar"], in: me.deletingLastPathComponent(), timeout: 5)) ?? ""
      if listed || pids.split(separator: "\n").contains(where: { Int32($0) != nil && Int32($0) != mine }) {
        log.write("新版本已打开, 本进程退出")
        // If quitting is held up (a sheet, a window that doesn't close), quit anyway: the new one
        // waits for this one, and two would be in the menu bar.
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
          LogFile("update.log").write("正常退出没完成, 直接结束本进程")
          Thread.sleep(forTimeInterval: 0.3)
          exit(0)
        }
        NSApp.terminate(nil)
        return
      }
      if case .failed = state { return }
      try? await Task.sleep(for: .milliseconds(50))
    }
    log.write("10 秒内没看到新版本的进程")
    state = .failed("新版本已装好, 但没能打开, 请手动重开")
  }
}
