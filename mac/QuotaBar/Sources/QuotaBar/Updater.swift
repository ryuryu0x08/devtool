// Checks for a newer version and installs it: from the git clone the app was built from (build.sh
// writes its folder and commit into Info.plist), on the branch CI moves after the tests passed.
// Installing is build.sh --install, which quits this app and opens the new one.
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
      state = .failed("源码目录不在了：\(source.path)")
      return
    }
    state = .checking
    let u = SourceUpdate(dir: source)
    do {
      let r = try await Task.detached { try u.newer(than: commit) }.value
      lastCheck = Date()
      state = r.count > 0 ? .available(count: r.count, subject: r.subject) : .upToDate
      if r.count > 0 && install { await self.install() }
    } catch {
      state = .failed("检查失败：" + error.localizedDescription)
    }
  }

  /// Moves the clone forward and runs build.sh --install (about a minute); the new app replaces
  /// this one. If the build fails, this one stays as it is.
  func install() async {
    guard let source, state != .installing else { return }
    state = .installing
    let u = SourceUpdate(dir: source)
    let log = Self.log
    do {
      try await Task.detached { try u.fastForward() }.value
    } catch {
      state = .failed("更新失败：" + error.localizedDescription)
      return
    }
    do {
      _ = try await Task.detached { try SourceUpdate.run(["bash", "build.sh", "--install"], in: source, timeout: 900, log: log) }.value
      // build.sh quits this app before installing; reaching here means it didn't.
      state = .upToDate
    } catch {
      state = .failed("编译失败，详见日志")
    }
  }
}
