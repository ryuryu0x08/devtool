// The app's state: the config (the API, the people and their keys), the latest reading of every
// person, the history, and which key Claude Code is set to. Kept in
// ~/Library/Application Support/QuotaBar (readable by the owner only: it holds the keys).
import AppKit
import Foundation
import Observation
import QuotaCore
import SwiftUI

struct Config: Codable, Equatable {
  /// The usage API, e.g. http://host/api/v1/billing/usage.
  var url = ""
  /// Seconds between refreshes.
  var interval = 60
  var people: [Person] = []
  /// Keys that were replaced by a newer one (not added back from Claude Code's settings).
  var retired: [String] = []
  var settingsPath = ClaudeSettings.defaultPath

  init() {}

  private enum CodingKeys: String, CodingKey { case url, interval, people, retired, settingsPath, keys }
  private struct OldKey: Decodable { var id: String; var key: String }

  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
    interval = try c.decodeIfPresent(Int.self, forKey: .interval) ?? 60
    retired = try c.decodeIfPresent([String].self, forKey: .retired) ?? []
    settingsPath = try c.decodeIfPresent(String.self, forKey: .settingsPath) ?? ClaudeSettings.defaultPath
    if let ps = try c.decodeIfPresent([Person].self, forKey: .people) {
      people = ps
    } else {
      // The first version kept a list of keys (with names typed in); names now come from the API.
      people = (try c.decodeIfPresent([OldKey].self, forKey: .keys) ?? []).map { Person(id: $0.id, key: $0.key) }
    }
  }

  func encode(to e: Encoder) throws {
    var c = e.container(keyedBy: CodingKeys.self)
    try c.encode(url, forKey: .url)
    try c.encode(interval, forKey: .interval)
    try c.encode(people, forKey: .people)
    try c.encode(retired, forKey: .retired)
    try c.encode(settingsPath, forKey: .settingsPath)
  }
}

/// A short message after an action: shown for a while, red when something went wrong.
struct Notice: Equatable {
  var text: String
  var bad = false
  var id = UUID()
}

/// What a person's card shows.
enum Shown: Equatable {
  /// Not read yet.
  case waiting
  /// The newest reading.
  case ok(GoodReading)
  /// The last reading failed; the one before it (if any) is still shown.
  case failing(Failure, last: GoodReading?)
  /// The person's key went to someone else: a new one is needed.
  case noKey(last: GoodReading?)
}

extension Failure {
  /// What it means, in a few words; `detail` has the rest.
  var friendly: String {
    switch kind {
    case .keyRejected: return "这个 key 不能用了，可能已轮换。添加新 key 后会自动接上。"
    case .server: return "用量接口暂时出错，稍后自动重试。"
    case .network: return "连不上用量接口，稍后自动重试。"
    }
  }
}

@MainActor @Observable
final class Store {
  private(set) var config = Config()
  /// The failures of the last refresh, by person.
  private(set) var failures: [String: Failure] = [:]
  private(set) var history: [Sample] = []
  private(set) var lastRefresh: Date?
  private(set) var refreshing = false
  /// A key being added is being read.
  private(set) var adding = false
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
    adoptClaudeKey()
    restart()
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor in self?.restart() }
    }
  }

  var people: [Person] { config.people }
  var hasURL: Bool { usageURL != nil }
  var configured: Bool { !people.isEmpty && hasURL }

  var usageURL: URL? {
    guard let u = URL(string: config.url.trimmingCharacters(in: .whitespaces)), ["http", "https"].contains(u.scheme?.lowercased() ?? ""), u.host != nil else { return nil }
    return u
  }

  /// The person whose key Claude Code is set to.
  var active: Person? { people.first { !$0.key.isEmpty && $0.key == activeToken } }

  func shown(_ p: Person) -> Shown {
    if p.key.isEmpty { return .noKey(last: p.lastGood) }
    if let f = failures[p.id] { return .failing(f, last: p.lastGood) }
    if let g = p.lastGood { return .ok(g) }
    return .waiting
  }

  /// The newest reading that has the shared pool.
  var poolReading: Usage? {
    people.compactMap(\.lastGood).filter { ($0.usage.poolLimit ?? 0) > 0 }.max { $0.at < $1.at }?.usage
  }

  // MARK: - Config

  func saveSettings(url: String, interval: Int, settingsPath: String) {
    config.url = url.trimmingCharacters(in: .whitespaces)
    config.interval = max(10, interval)
    config.settingsPath = settingsPath.trimmingCharacters(in: .whitespaces).isEmpty ? ClaudeSettings.defaultPath : settingsPath
    saveConfig()
    readSettings()
    restart()
  }

  func remove(_ p: Person) {
    config.people.removeAll { $0.id == p.id }
    failures[p.id] = nil
    history.removeAll { $0.key == p.id }
    saveConfig()
    writeHistory()
  }

  private func load() {
    let dec = JSONDecoder()
    dec.dateDecodingStrategy = .secondsSince1970
    if let d = try? Data(contentsOf: configFile), let c = try? dec.decode(Config.self, from: d) { config = c }
    if let d = try? Data(contentsOf: historyFile), let h = try? dec.decode([Sample].self, from: d) { history = History.thin(h) }
  }

  private func saveConfig() { write(config, to: configFile) }
  private func writeHistory() { write(history, to: historyFile) }

  private func write<T: Encodable>(_ v: T, to url: URL) {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys]
    enc.dateEncodingStrategy = .secondsSince1970
    do {
      try FileManager.default.createDirectory(at: Self.dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      try enc.encode(v).write(to: url, options: .atomic)
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    } catch {
      notice = Notice(text: "无法保存 \(url.lastPathComponent)：\(error.localizedDescription)", bad: true)
    }
  }

  // MARK: - Adding keys

  /// Adds a pasted key and reads it right away: its name says whose it is.
  func add(_ text: String) async {
    var ps = config.people
    switch People.add(text, to: &ps) {
    case .empty:
      return
    case .exists(let id):
      let label = people.first { $0.id == id }?.label ?? ""
      notice = Notice(text: "这个 key 已经在列表里（\(label)）。")
      return
    case .added(let id):
      withAnimation(.snappy) { config.people = ps }
      saveConfig()
      guard let url = usageURL else {
        notice = Notice(text: "已添加。填写用量接口地址后会识别是谁的 key。")
        return
      }
      adding = true
      let key = ps.first { $0.id == id }!.key
      let r = await fetch(url: url, key: key)
      adding = false
      let at = Date()
      let b = apply(id: id, key: key, reply: r, at: at)
      saveConfig()
      writeHistory()
      if case .failed(let f, _) = r {
        notice = Notice(text: "已添加，但暂时识别不了：" + f.friendly, bad: true)
      } else if let b, let p = people.first(where: { $0.id == b.id }), notice?.bad != true {
        let claude = b.replaced != nil && activeToken == key ? "，Claude Code 也已改用新 key。" : "。"
        notice = Notice(text: b.merged != nil ? "已更新「\(p.label)」的 key" + claude : "已添加「\(p.label)」。")
      }
    }
  }

  /// Claude Code's current key, if it isn't in the list (and wasn't replaced): it is someone's.
  private func adoptClaudeKey() {
    guard let t = activeToken, !t.isEmpty, !config.retired.contains(t), !people.contains(where: { $0.key == t }) else { return }
    if case .added = People.add(t, to: &config.people) { saveConfig() }
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
    adoptClaudeKey()
    guard !refreshing, let url = usageURL else { return }
    let targets = people.filter { !$0.key.isEmpty }.map { ($0.id, $0.key) }
    guard !targets.isEmpty else { return }
    refreshing = true
    let replies = await withTaskGroup(of: (String, String, UsageReply).self) { group in
      for (id, key) in targets {
        group.addTask { [self] in (id, key, await self.fetch(url: url, key: key)) }
      }
      var out: [(String, String, UsageReply)] = []
      for await r in group { out.append(r) }
      return out
    }
    let at = Date()
    withAnimation(.snappy) {
      for (id, key, r) in replies { apply(id: id, key: key, reply: r, at: at) }
    }
    saveConfig()
    writeHistory()
    lastRefresh = at
    refreshing = false
  }

  nonisolated private func fetch(url: URL, key: String) async -> UsageReply {
    do {
      let (data, resp) = try await session.data(for: UsageAPI.request(url: url, key: key))
      return UsageAPI.parse(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, body: data)
    } catch {
      return .failed(Failure(.network, error.localizedDescription), title: nil)
    }
  }

  /// Takes in one reading of person `id`'s key `key`.
  @discardableResult
  private func apply(id: String, key: String, reply: UsageReply, at: Date) -> People.Bound? {
    // The key changed while it was being read: the reading is of a key no longer theirs.
    guard people.contains(where: { $0.id == id && $0.key == key }) else { return nil }
    switch reply {
    case .failed(let f, _):
      failures[id] = f
      return nil
    case .ok(let q, let title):
      failures[id] = nil
      guard let b = People.bind(id: id, name: title ?? "", reading: GoodReading(at: at, usage: q), in: &config.people) else { return nil }
      if let m = b.merged {
        // The entry the key came in on is gone: its points are the person's.
        for i in history.indices where history[i].key == m { history[i].key = b.id }
        failures[m] = nil
      }
      failures[b.id] = nil
      if let old = b.replaced { replaced(old, by: key, for: b.id) }
      history = History.thin(history + [Sample(t: at, key: b.id, daily: q.daily, over: q.over, pool: q.pool)], now: at)
      return b
    }
  }

  /// A person's key was replaced by a newer one. If Claude Code was using the old one, it gets
  /// the new one: the old one no longer works.
  private func replaced(_ old: String, by new: String, for id: String) {
    config.retired = Array((config.retired.filter { $0 != old } + [old]).suffix(50))
    guard activeToken == old else { return }
    let name = people.first { $0.id == id }?.label ?? ""
    do {
      _ = try ClaudeSettings.switchToken(new, path: config.settingsPath)
      readSettings()
      notice = Notice(text: "「\(name)」换了新 key，Claude Code 也已改用新 key。")
    } catch {
      notice = Notice(text: "「\(name)」换了新 key，但无法更新 Claude Code 的配置：" + error.localizedDescription, bad: true)
    }
  }

  // MARK: - Claude Code

  /// Reads which token settings.json sets now.
  func readSettings() {
    let path = (config.settingsPath as NSString).expandingTildeInPath
    let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
    activeToken = ClaudeSettings.currentToken(in: text)
    hasKeyHelper = ClaudeSettings.hasApiKeyHelper(in: text)
  }

  /// Sets Claude Code to use `p`'s key.
  func use(_ p: Person) {
    guard !p.key.isEmpty else { return }
    do {
      let r = try ClaudeSettings.switchToken(p.key, path: config.settingsPath)
      withAnimation(.snappy) { readSettings() }
      switch r {
      case .unchanged: notice = Notice(text: "Claude Code 已经在用「\(p.label)」的 key。")
      case .written: notice = Notice(text: "已切换到「\(p.label)」。新开的 Claude Code 会话使用这个 key；已经打开的可能要重开。")
      }
    } catch {
      notice = Notice(text: error.localizedDescription, bad: true)
    }
  }
}
