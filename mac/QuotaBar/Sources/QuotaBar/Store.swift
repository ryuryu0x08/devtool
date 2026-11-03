// The app's state: the config (the API, the people and their keys), the latest reading of every
// person, the history, and which key Claude Code is set to. Kept in
// ~/Library/Application Support/QuotaBar (readable by the owner only: it holds the keys).
import AppKit
import Foundation
import Observation
import QuotaCore
import SwiftUI

/// After Claude Desktop got a new key: whether to relaunch it (it reads its key at launch only).
enum DesktopRestart: String, Codable, CaseIterable {
  case ask, always, never

  var label: String {
    switch self {
    case .ask: return "每次询问"
    case .always: return "自动重启"
    case .never: return "不重启"
    }
  }
}

struct Config: Codable, Equatable {
  static let defaultURL = "http://api-ai-coding.bilibili.co/api/v1/billing/usage"
  static let defaultBaseURL = "http://api-ai-coding.bilibili.co/api"

  /// The usage API.
  var url = Config.defaultURL
  /// Seconds between refreshes.
  var interval = 60
  var people: [Person] = []
  /// Keys that were replaced by a newer one (not added back from Claude Code's settings).
  var retired: [String] = []
  /// Claude Code's folder (its settings.json is in it); empty: found by itself.
  var claudeDir = ""
  /// Claude Desktop's third-party folder (configLibrary is in it); empty: found by itself.
  var desktopDir = ""
  /// The model API Claude Code and Claude Desktop are to use (ANTHROPIC_BASE_URL).
  var baseURL = Config.defaultBaseURL
  var desktopRestart = DesktopRestart.ask
  /// Forward Desktop to an http model API through 127.0.0.1 (Desktop takes http only there).
  var forward = false
  /// The forwarder's port, kept so that Desktop's address stays the same.
  var forwardPort = Int(LocalForwarder.defaultPort)
  /// Addresses this app gave Desktop (its forwarders, its model APIs): replaced without asking.
  var ours: [String] = []

  static var detectedClaudeDir: String {
    ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"].flatMap { $0.isEmpty ? nil : $0 } ?? "~/.claude"
  }
  static let detectedDesktopDir = "~/Library/Application Support/Claude-3p"

  var settingsPath: String { ((claudeDir.isEmpty ? Config.detectedClaudeDir : claudeDir) as NSString).appendingPathComponent("settings.json") }
  var desktopLibrary: String { ((desktopDir.isEmpty ? Config.detectedDesktopDir : desktopDir) as NSString).appendingPathComponent("configLibrary") }

  init() {}

  private enum CodingKeys: String, CodingKey {
    case url, interval, people, retired, settingsPath, claudeDir, desktopDir, baseURL, desktopRestart, forward, forwardPort, ours, keys
  }
  private struct OldKey: Decodable { var id: String; var key: String }

  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    let u = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
    url = u.isEmpty ? Config.defaultURL : u
    interval = try c.decodeIfPresent(Int.self, forKey: .interval) ?? 60
    retired = try c.decodeIfPresent([String].self, forKey: .retired) ?? []
    if let d = try c.decodeIfPresent(String.self, forKey: .claudeDir) {
      claudeDir = d
    } else if let old = try c.decodeIfPresent(String.self, forKey: .settingsPath), old != ClaudeSettings.defaultPath {
      // Earlier versions kept the settings file's path.
      claudeDir = (old as NSString).deletingLastPathComponent
    }
    desktopDir = try c.decodeIfPresent(String.self, forKey: .desktopDir) ?? ""
    forward = try c.decodeIfPresent(Bool.self, forKey: .forward) ?? false
    forwardPort = try c.decodeIfPresent(Int.self, forKey: .forwardPort) ?? Int(LocalForwarder.defaultPort)
    ours = try c.decodeIfPresent([String].self, forKey: .ours) ?? []
    let b = try c.decodeIfPresent(String.self, forKey: .baseURL) ?? ""
    baseURL = b.isEmpty ? Config.defaultBaseURL : b
    desktopRestart = (try? c.decodeIfPresent(DesktopRestart.self, forKey: .desktopRestart)) ?? .ask
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
    try c.encode(claudeDir, forKey: .claudeDir)
    try c.encode(desktopDir, forKey: .desktopDir)
    try c.encode(forward, forKey: .forward)
    try c.encode(forwardPort, forKey: .forwardPort)
    try c.encode(ours, forKey: .ours)
    try c.encode(baseURL, forKey: .baseURL)
    try c.encode(desktopRestart, forKey: .desktopRestart)
  }
}

/// A short message after an action: shown for a while, red when something went wrong.
struct Notice: Equatable {
  var text: String
  var bad = false
  /// Offer to relaunch Claude Desktop, which reads its key at launch only.
  var restartDesktop = false
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
    case .keyRejected: return "key 失效（可能已轮换），粘贴新 key 即可"
    case .server: return "接口出错，稍后重试"
    case .network: return "连不上接口，稍后重试"
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

  /// The local forwarder for Desktop: off, starting, on (its address), or why it couldn't start.
  enum ForwardState: Equatable { case off, starting, on(String), failed(String) }
  private(set) var forwardState = ForwardState.off
  @ObservationIgnored private var forwarder: LocalForwarder?

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
    Task { await startForwarder() }
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

  func saveSettings(url: String, baseURL: String, interval: Int, claudeDir: String, desktopDir: String) {
    let url = url.trimmingCharacters(in: .whitespaces)
    config.url = url.isEmpty ? Config.defaultURL : url
    let b = baseURL.trimmingCharacters(in: .whitespaces)
    let newBase = b.isEmpty ? Config.defaultBaseURL : b
    let baseChanged = newBase != config.baseURL
    config.baseURL = newBase
    config.interval = max(10, interval)
    config.claudeDir = claudeDir.trimmingCharacters(in: .whitespaces)
    config.desktopDir = desktopDir.trimmingCharacters(in: .whitespaces)
    saveConfig()
    readSettings()
    restart()
    if baseChanged { Task { await startForwarder() } }
  }

  // MARK: - Local forwarder

  /// The model API is http and not this machine: Desktop needs the forwarder for it.
  var forwardNeeded: Bool { LocalForwarder.needed(for: config.baseURL) }

  /// The address Desktop is to use: the forwarder's while it runs, else the model API.
  var desktopWant: String {
    if case .on(let u) = forwardState { return u }
    return config.baseURL
  }

  func setForward(_ on: Bool) {
    config.forward = on
    saveConfig()
    Task { await startForwarder() }
  }

  /// (Re)starts the forwarder as the config says, on the port it had (or the next free one).
  func startForwarder() async {
    forwarder?.stop()
    forwarder = nil
    guard config.forward, forwardNeeded, let target = URL(string: config.baseURL.trimmingCharacters(in: .whitespaces)) else {
      forwardState = .off
      syncDesktopAddress()
      return
    }
    forwardState = .starting
    do {
      let f = try LocalForwarder(target: target)
      let p = try await f.start(preferred: UInt16(clamping: config.forwardPort))
      forwarder = f
      config.forwardPort = Int(p)
      remember(LocalForwarder.url(port: p))
      saveConfig()
      withAnimation(.snappy) { forwardState = .on(LocalForwarder.url(port: p)) }
      syncDesktopAddress()
    } catch {
      config.forward = false
      saveConfig()
      withAnimation(.snappy) { forwardState = .failed(error.localizedDescription) }
    }
  }

  private func remember(_ url: String) {
    guard !config.ours.contains(where: { ClaudeSettings.sameURL($0, url) }) else { return }
    config.ours = Array((config.ours + [url]).suffix(20))
  }

  /// Desktop is on one of our addresses, not the one it is to use (the forwarder moved, was
  /// turned on or off): put it right without asking.
  private func syncDesktopAddress() {
    guard case .gateway(_, let current) = ClaudeDesktop.status(dir: config.desktopLibrary) else { return }
    let want = desktopWant
    guard DesktopURL.change(current: current, want: want, ours: config.ours + [config.baseURL]) == .replace else { return }
    do {
      guard try ClaudeDesktop.switchKey(nil, baseURL: want, dir: config.desktopLibrary) == .written else { return }
      remember(want)
      saveConfig()
      notice = Notice(text: "Desktop 已改用 \(want)" + (desktopRunning ? "，重启后生效" : ""))
      if desktopRunning { afterDesktopChanged() }
    } catch {
      notice = Notice(text: "Desktop 地址未改：" + error.localizedDescription, bad: true)
    }
  }

  func setDesktopRestart(_ r: DesktopRestart) {
    config.desktopRestart = r
    saveConfig()
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
      notice = Notice(text: "已在列表：\(label)")
      return
    case .added(let id):
      withAnimation(.snappy) { config.people = ps }
      saveConfig()
      guard let url = usageURL else {
        notice = Notice(text: "已添加，填好用量接口后识别")
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
        notice = Notice(text: "已添加，未识别：" + f.friendly, bad: true)
      } else if let b, let p = people.first(where: { $0.id == b.id }), notice?.bad != true {
        let claude = b.replaced != nil && activeToken == key ? "，Claude Code 已同步" : ""
        notice = Notice(text: b.merged != nil ? "已更新「\(p.label)」的 key" + claude : "已添加「\(p.label)」")
      }
    }
  }

  /// Claude Code's current key, if it isn't in the list (and wasn't replaced): it is someone's.
  private func adoptClaudeKey() {
    guard let t = activeToken, !t.isEmpty, !config.retired.contains(t), !people.contains(where: { $0.key == t }) else { return }
    if case .added = People.add(t, to: &config.people) { saveConfig() }
  }

  // MARK: - Refreshing

  /// Refreshes now and then every `interval` seconds; after a reading failed for a reason other
  /// than the key (the network, the API), again after 15 seconds.
  func restart() {
    loop?.cancel()
    loop = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await self.refresh()
        let soon = self.failures.values.contains { $0.kind != .keyRejected }
        try? await Task.sleep(for: .seconds(soon ? min(15, max(10, self.config.interval)) : max(10, self.config.interval)))
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

  /// A person's key was replaced by a newer one. Claude Code and Claude Desktop, where they used
  /// the old one (which no longer works), get the new one; their addresses stay as they are.
  private func replaced(_ old: String, by new: String, for id: String) {
    config.retired = Array((config.retired.filter { $0 != old } + [old]).suffix(50))
    let code = activeToken == old
    var desktop = false
    if case .gateway(let k, _) = ClaudeDesktop.status(dir: config.desktopLibrary), k == old { desktop = true }
    guard code || desktop else { return }
    let name = people.first { $0.id == id }?.label ?? ""
    var problems: [String] = []
    if code {
      do { _ = try ClaudeSettings.switchToken(new, path: config.settingsPath); readSettings() }
      catch { problems.append("Claude Code：" + error.localizedDescription) }
    }
    var desktopChanged = false
    if desktop {
      do { desktopChanged = try ClaudeDesktop.switchKey(new, dir: config.desktopLibrary) == .written }
      catch { problems.append("Desktop：" + error.localizedDescription) }
    }
    if !problems.isEmpty {
      notice = Notice(text: "「\(name)」换了新 key，未能同步：" + problems.joined(separator: "；"), bad: true)
      return
    }
    notice = Notice(text: "「\(name)」换了新 key，已同步" + (desktopChanged ? "，Desktop 重启后生效" : ""),
                    restartDesktop: desktopChanged && desktopRunning && config.desktopRestart != .never)
    if desktopChanged && config.desktopRestart == .always && desktopRunning { restartDesktop() }
  }

  // MARK: - Claude Code

  /// Reads which token settings.json sets now.
  func readSettings() {
    let path = (config.settingsPath as NSString).expandingTildeInPath
    let text = (try? String(contentsOfFile: path, encoding: .utf8)) ?? ""
    activeToken = ClaudeSettings.currentToken(in: text)
    hasKeyHelper = ClaudeSettings.hasApiKeyHelper(in: text)
  }

  /// Sets Claude Code (if it has a settings file) and Claude Desktop (if it is on a gateway) to
  /// use `p`'s key. Where either points at another model API than the one set here, asks first
  /// whether to change that too.
  func use(_ p: Person) {
    guard !p.key.isEmpty else { return }
    let base = config.baseURL
    var cliFile: String?
    if let f = ClaudeSettings.file(config.settingsPath) { cliFile = (try? String(contentsOf: f, encoding: .utf8)) ?? "" }
    let desk = ClaudeDesktop.status(dir: config.desktopLibrary)
    var desktopURL: String?
    var onGateway = false
    if case .gateway(_, let u) = desk { onGateway = true; desktopURL = u }
    guard cliFile != nil || onGateway else {
      notice = Notice(text: "没有可切换的：无 \(config.settingsPath)，Desktop 未用网关", bad: true)
      return
    }

    // Another model API somewhere: change it too, or only the key?
    var others: [String] = []
    if let t = cliFile, !ClaudeSettings.sameURL(ClaudeSettings.currentEnv(ClaudeSettings.baseURLKey, in: t), base) {
      others.append("Claude Code：" + (ClaudeSettings.currentEnv(ClaudeSettings.baseURLKey, in: t) ?? "未设置（官方接口）"))
    }
    // Desktop is to use the forwarder while it runs; an address of ours is put right silently.
    let desktopWant = self.desktopWant
    let desktopChange = onGateway ? DesktopURL.change(current: desktopURL, want: desktopWant, ours: config.ours + [base]) : .same
    if desktopChange == .ask { others.append("Desktop：" + (desktopURL ?? "未设置")) }
    var setURL = false
    if !others.isEmpty {
      let wanted = desktopWant == base ? base : base + "\nDesktop 经本地转发：" + desktopWant
      switch Dialogs.otherAPI(current: others, wanted: wanted) {
      case .replace: setURL = true
      case .keyOnly: setURL = false
      case .cancel: return
      }
    }

    var parts: [String] = [], problems: [String] = []
    if cliFile != nil {
      do {
        let urlNow = cliFile.flatMap { ClaudeSettings.currentEnv(ClaudeSettings.baseURLKey, in: $0) }
        let wantURL = setURL && !ClaudeSettings.sameURL(urlNow, base) ? base : nil
        _ = try ClaudeSettings.switchToken(p.key, baseURL: wantURL, path: config.settingsPath)
        withAnimation(.snappy) { readSettings() }
        parts.append("Claude Code 已生效")
      } catch { problems.append("Claude Code：" + error.localizedDescription) }
    }
    var desktopChanged = false
    switch desk {
    case .gateway:
      do {
        let wantURL = desktopChange == .replace || desktopChange == .ask && setURL ? desktopWant : nil
        desktopChanged = try ClaudeDesktop.switchKey(p.key, baseURL: wantURL, dir: config.desktopLibrary) == .written
        if let wantURL { remember(wantURL); saveConfig() }
        parts.append(!desktopChanged ? "Desktop 已在用" : desktopRunning ? "Desktop 重启后生效" : "Desktop 下次打开生效")
        if LocalForwarder.needed(for: wantURL ?? desktopURL ?? "") { parts.append("Desktop 需开本地转发（设置 → 接口）") }
      } catch { problems.append("Desktop：" + error.localizedDescription) }
    case .managed:
      parts.append("Desktop 由公司管理，未改")
    case .notGateway:
      break
    }
    if !problems.isEmpty {
      notice = Notice(text: "切换到「\(p.label)」未完成：" + problems.joined(separator: "；"), bad: true)
      return
    }
    notice = Notice(text: "已切换到「\(p.label)」：" + parts.joined(separator: "，"))
    if desktopChanged && desktopRunning { afterDesktopChanged() }
  }

  /// Desktop got a new key while running: relaunch it, or not, as chosen (or ask).
  private func afterDesktopChanged() {
    var choice = config.desktopRestart
    if choice == .ask {
      let (now, remember) = Dialogs.restartDesktop()
      choice = now ? .always : .never
      if remember { setDesktopRestart(choice) }
    }
    if choice == .always { restartDesktop() }
    else { notice?.restartDesktop = true }
  }

  // MARK: - Claude Desktop

  private var desktopApps: [NSRunningApplication] {
    NSRunningApplication.runningApplications(withBundleIdentifier: ClaudeDesktop.bundleID)
  }

  var desktopRunning: Bool { !desktopApps.isEmpty }

  /// Quits Claude Desktop and opens it again, so that it reads its new key.
  func restartDesktop() {
    let apps = desktopApps
    let url = apps.first?.bundleURL ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: ClaudeDesktop.bundleID)
    notice = Notice(text: "正在重启 Desktop…")
    apps.forEach { $0.terminate() }
    Task {
      for _ in 0..<60 where apps.contains(where: { !$0.isTerminated }) {
        try? await Task.sleep(for: .milliseconds(250))
      }
      guard apps.allSatisfy(\.isTerminated) else {
        notice = Notice(text: "Desktop 未退出（可能在等确认），手动重开即可", bad: true)
        return
      }
      guard let url else { return }
      let c = NSWorkspace.OpenConfiguration()
      c.activates = false
      _ = try? await NSWorkspace.shared.openApplication(at: url, configuration: c)
      notice = Notice(text: "Desktop 已重启，新 key 生效")
    }
  }
}
