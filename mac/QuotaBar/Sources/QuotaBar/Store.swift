// The app's state: the config, the latest reading of every key, the history, and which key
// Claude Code is set to. Kept in ~/Library/Application Support/QuotaBar (readable by the owner
// only: it holds the keys).
import AppKit
import Foundation
import Observation
import QuotaCore

struct KeyEntry: Codable, Identifiable, Hashable {
  var id = UUID().uuidString
  var name = ""
  var key = ""
}

struct Config: Codable, Equatable {
  /// The usage API, e.g. http://host/api/v1/billing/usage.
  var url = ""
  /// Seconds between refreshes.
  var interval = 60
  var keys: [KeyEntry] = []
  var settingsPath = ClaudeSettings.defaultPath

  init() {}
  // Fields added later read as their defaults from an older file.
  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
    interval = try c.decodeIfPresent(Int.self, forKey: .interval) ?? 60
    keys = try c.decodeIfPresent([KeyEntry].self, forKey: .keys) ?? []
    settingsPath = try c.decodeIfPresent(String.self, forKey: .settingsPath) ?? ClaudeSettings.defaultPath
  }
}

struct Reading {
  var at: Date
  var reply: UsageReply
}

/// A short message after an action: shown for a while, red when something went wrong.
struct Notice: Equatable {
  var text: String
  var bad = false
  var id = UUID()
}

@MainActor @Observable
final class Store {
  private(set) var config = Config()
  private(set) var latest: [String: Reading] = [:]
  private(set) var history: [Sample] = []
  private(set) var lastRefresh: Date?
  private(set) var refreshing = false
  /// The token settings.json sets now.
  private(set) var activeToken: String?
  /// settings.json also has an apiKeyHelper.
  private(set) var hasKeyHelper = false
  var notice: Notice?

  @ObservationIgnored private var loop: Task<Void, Never>?
  @ObservationIgnored private let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    c.timeoutIntervalForRequest = 15
    return URLSession(configuration: c)
  }()

  static let dir: URL = {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("QuotaBar", isDirectory: true)
  }()
  private var configFile: URL { Self.dir.appendingPathComponent("config.json") }
  private var historyFile: URL { Self.dir.appendingPathComponent("history.json") }

  init() {
    load()
    readSettings()
    restart()
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor in self?.restart() }
    }
  }

  var keys: [KeyEntry] { config.keys.filter { !$0.key.isEmpty } }
  var configured: Bool { !keys.isEmpty && usageURL != nil }

  var usageURL: URL? {
    guard let u = URL(string: config.url.trimmingCharacters(in: .whitespaces)), ["http", "https"].contains(u.scheme?.lowercased() ?? "") else { return nil }
    return u
  }

  /// The key Claude Code is set to, if it is one of ours.
  var activeKey: KeyEntry? { keys.first { $0.key == activeToken } }

  func title(_ k: KeyEntry) -> String {
    if !k.name.isEmpty { return k.name }
    if let t = latest[k.id]?.reply.title, !t.isEmpty { return t }
    return String(k.key.prefix(6)) + "…"
  }

  /// The newest successful reading that has the shared pool.
  var poolReading: Usage? {
    keys.compactMap { k -> (Date, Usage)? in
      guard let r = latest[k.id], case .ok(let q, _) = r.reply, (q.poolLimit ?? 0) > 0 else { return nil }
      return (r.at, q)
    }.max { $0.0 < $1.0 }?.1
  }

  // MARK: - Config

  func save(_ c: Config) {
    var c = c
    c.interval = max(10, c.interval)
    c.url = c.url.trimmingCharacters(in: .whitespaces)
    c.keys = c.keys.map { var k = $0; k.name = k.name.trimmingCharacters(in: .whitespaces); k.key = k.key.trimmingCharacters(in: .whitespacesAndNewlines); return k }.filter { !$0.key.isEmpty }
    config = c
    let ids = Set(c.keys.map(\.id))
    latest = latest.filter { ids.contains($0.key) }
    write(c, to: configFile)
    readSettings()
    restart()
  }

  private func load() {
    if let d = try? Data(contentsOf: configFile), let c = try? JSONDecoder().decode(Config.self, from: d) { config = c }
    let dec = JSONDecoder()
    dec.dateDecodingStrategy = .secondsSince1970
    if let d = try? Data(contentsOf: historyFile), let h = try? dec.decode([Sample].self, from: d) { history = History.thin(h) }
  }

  private func write<T: Encodable>(_ v: T, to url: URL, dates: Bool = false) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    if dates { enc.dateEncodingStrategy = .secondsSince1970 }
    do {
      try FileManager.default.createDirectory(at: Self.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try enc.encode(v).write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch {
      notice = Notice(text: "无法保存 \(url.lastPathComponent)：\(error.localizedDescription)", bad: true)
    }
  }

  // MARK: - Refreshing

  /// Refreshes now and then every `interval` seconds.
  func restart() {
    loop?.cancel()
    loop = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await self.refresh()
        try? await Task.sleep(for: .seconds(max(10, self.config.interval)))
      }
    }
  }

  func refresh() async {
    readSettings()
    guard !refreshing, !keys.isEmpty else { return }
    guard let url = usageURL else {
      let at = Date()
      for k in keys { latest[k.id] = Reading(at: at, reply: .failed("先在设置里填写用量接口地址（http:// 或 https://）", title: nil)) }
      return
    }
    refreshing = true
    let session = self.session
    let replies = await withTaskGroup(of: (String, UsageReply).self) { group in
      for k in keys {
        group.addTask {
          do {
            let (data, resp) = try await session.data(for: UsageAPI.request(url: url, key: k.key))
            return (k.id, UsageAPI.parse(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, body: data))
          } catch {
            return (k.id, .failed("连不上接口：" + error.localizedDescription, title: nil))
          }
        }
      }
      var out: [String: UsageReply] = [:]
      for await (id, r) in group { out[id] = r }
      return out
    }
    let at = Date()
    var added: [Sample] = []
    for (id, r) in replies {
      latest[id] = Reading(at: at, reply: r)
      if case .ok(let q, _) = r { added.append(Sample(t: at, key: id, daily: q.daily, over: q.over, pool: q.pool)) }
    }
    if !added.isEmpty {
      history = History.thin(history + added, now: at)
      write(history, to: historyFile, dates: true)
    }
    lastRefresh = at
    refreshing = false
  }

  // MARK: - Claude Code

  /// Reads which token settings.json sets now.
  func readSettings() {
    let path = (config.settingsPath as NSString).expandingTildeInPath
    let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
    activeToken = ClaudeSettings.currentToken(in: text)
    hasKeyHelper = ClaudeSettings.hasApiKeyHelper(in: text)
  }

  /// Sets Claude Code to use `k`.
  func use(_ k: KeyEntry) {
    do {
      let r = try ClaudeSettings.switchToken(k.key, path: config.settingsPath)
      readSettings()
      switch r {
      case .unchanged: notice = Notice(text: "Claude Code 已经在用「\(title(k))」")
      case .written: notice = Notice(text: "已切换到「\(title(k))」。新开的 Claude Code 会话使用这个 key；已经打开的可能要重开。")
      }
    } catch {
      notice = Notice(text: error.localizedDescription, bad: true)
    }
  }
}
