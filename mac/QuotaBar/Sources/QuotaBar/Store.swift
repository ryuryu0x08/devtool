// The app's state: the config (the API, the people and their keys), the latest reading of every
// person, the history, and which key Claude Code is set to. Kept in
// ~/Library/Application Support/QuotaBar (readable by the owner only: it holds the keys).
import AppKit
import Foundation
import Observation
import Network
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
  /// Desktop's configuration that was applied before the sign-in was chosen: applied again on
  /// the way back to the gateway.
  var desktopPrevious: String?
  /// Desktop goes through the forwarder, which sends the key of `desktopPerson`: switching
  /// changes it there, with no restart of Desktop.
  var swapKeys = false
  var desktopPerson: String?
  /// Read the rotating key from the browser's cookies (the portal's proxy-usage endpoint).
  var cookieSync = false
  /// Which browser to read the cookies from (a ChromeCookies.Browser name).
  var cookieBrowser = ChromeCookies.chrome.name
  /// The portal endpoint reached with the cookies.
  var cookieURL = ProxyUsageAPI.defaultURL

  static var detectedClaudeDir: String {
    ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"].flatMap { $0.isEmpty ? nil : $0 } ?? "~/.claude"
  }
  static let detectedDesktopDir = "~/Library/Application Support/Claude-3p"

  var settingsPath: String { ((claudeDir.isEmpty ? Config.detectedClaudeDir : claudeDir) as NSString).appendingPathComponent("settings.json") }
  var desktopRoot: String { desktopDir.isEmpty ? Config.detectedDesktopDir : desktopDir }
  var desktopLibrary: String { ((desktopDir.isEmpty ? Config.detectedDesktopDir : desktopDir) as NSString).appendingPathComponent("configLibrary") }

  init() {}

  private enum CodingKeys: String, CodingKey {
    case url, interval, people, retired, settingsPath, claudeDir, desktopDir, baseURL, desktopRestart, forward, forwardPort, ours, desktopPrevious, swapKeys, desktopPerson, cookieSync, cookieBrowser, cookieURL, keys
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
    desktopPrevious = try c.decodeIfPresent(String.self, forKey: .desktopPrevious)
    swapKeys = try c.decodeIfPresent(Bool.self, forKey: .swapKeys) ?? false
    desktopPerson = try c.decodeIfPresent(String.self, forKey: .desktopPerson)
    cookieSync = try c.decodeIfPresent(Bool.self, forKey: .cookieSync) ?? false
    cookieBrowser = try c.decodeIfPresent(String.self, forKey: .cookieBrowser) ?? ChromeCookies.chrome.name
    let cu = try c.decodeIfPresent(String.self, forKey: .cookieURL) ?? ""
    cookieURL = cu.isEmpty ? ProxyUsageAPI.defaultURL : cu
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
    try c.encodeIfPresent(desktopPrevious, forKey: .desktopPrevious)
    try c.encode(swapKeys, forKey: .swapKeys)
    try c.encodeIfPresent(desktopPerson, forKey: .desktopPerson)
    try c.encode(cookieSync, forKey: .cookieSync)
    try c.encode(cookieBrowser, forKey: .cookieBrowser)
    try c.encode(cookieURL, forKey: .cookieURL)
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
  /// Since when each person's readings have been failing (none: the last one was good).
  private(set) var failingSince: [String: Date] = [:]
  @ObservationIgnored private let network = NWPathMonitor()
  @ObservationIgnored private var lastCookieKick: Date?
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
  /// When this app last changed the address in Desktop's configuration: a Desktop opened before
  /// then still uses the old one (it reads it at launch).
  private(set) var desktopAddressChangedAt: Date?

  @ObservationIgnored private var loop: Task<Void, Never>?
  @ObservationIgnored private var cookieLoop: Task<Void, Never>?
  /// A cookie sync is running (the button shows it).
  private(set) var cookieSyncing = false
  /// How often the cookie sync runs by itself, once on; the key rotates at no set time.
  static let cookieInterval: TimeInterval = 10 * 60
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
    startCookieLoop()
    Task { await startForwarder() }
    // Just after waking the network is often not back yet: a moment first, and again as soon
    // as the network is there (Wi-Fi joining, a VPN connecting).
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor in
        self?.restart(after: 3)
        await self?.checkForwarder()
      }
    }
    // Desktop opened again (by hand too): once none is left from before the address change, the
    // settings say so.
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didLaunchApplicationNotification, object: nil, queue: .main) { [weak self] _ in
      Task { @MainActor in
        guard let self, self.desktopAddressChangedAt != nil, !self.desktopOnOldAddress else { return }
        self.desktopAddressChangedAt = nil
      }
    }
    network.pathUpdateHandler = { [weak self] path in
      guard path.status == .satisfied else { return }
      Task { @MainActor in self?.networkBack() }
    }
    network.start(queue: .main)
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
    readDesktop()
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

  /// The forwarder runs: Desktop needs it for an http model API, or it swaps the keys.
  var forwardWanted: Bool { config.swapKeys || config.forward && forwardNeeded }

  /// The key the forwarder sends in place of Desktop's: the chosen person's when swapping keys;
  /// otherwise the one in Desktop's configuration, which a Desktop opened earlier may not have
  /// read yet (so a key written there works at once, with no restart).
  var forwarderKey: String? {
    guard config.swapKeys else {
      if case .gateway(let k?, _) = ClaudeDesktop.status(dir: config.desktopLibrary) { return k }
      return nil
    }
    return people.first { $0.id == config.desktopPerson && !$0.key.isEmpty }?.key
  }

  /// The running Desktop goes through the running forwarder (it was opened on its address): the
  /// key the forwarder sends reaches it at once.
  var desktopOnForwarder: Bool {
    guard case .on(let u) = forwardState, case .gateway(_, let cur) = ClaudeDesktop.status(dir: config.desktopLibrary) else { return false }
    return ClaudeSettings.sameURL(cur, u) && !desktopOnOldAddress
  }

  /// The person whose key Desktop uses through the forwarder.
  var desktopPersonNow: Person? { config.swapKeys ? people.first { $0.id == config.desktopPerson } : nil }

  /// Desktop is on the running forwarder, which sends the key: a switch needs no restart.
  var desktopViaForwarder: Bool {
    guard config.swapKeys, case .on(let u) = forwardState, case .gateway(_, let cur) = ClaudeDesktop.status(dir: config.desktopLibrary) else { return false }
    return ClaudeSettings.sameURL(cur, u)
  }

  /// Swapping keys on: Desktop goes through the forwarder (one restart, to read the new address),
  /// which keeps the key Desktop has now. Off: Desktop gets that key in its own configuration.
  func setSwapKeys(_ on: Bool) {
    if on {
      var who: Person?
      if case .gateway(let k?, _) = ClaudeDesktop.status(dir: config.desktopLibrary) { who = people.first { $0.key == k } }
      config.desktopPerson = (who ?? active ?? people.first { !$0.key.isEmpty })?.id
      config.swapKeys = true
      saveConfig()
      Task { await startForwarder() }
    } else {
      let key = forwarderKey
      config.swapKeys = false
      saveConfig()
      Task { await startForwarder(desktopKey: key) }
    }
  }

  /// (Re)starts the forwarder as the config says, on the port it had (or the next free one);
  /// Desktop is put on its address (or back), and given `desktopKey` if there is one.
  /// `again`: a restart of a forwarder that stopped by itself; if it fails, the settings stay on
  /// (it is tried again at the next refresh) instead of being turned off.
  func startForwarder(desktopKey: String? = nil, again: Bool = false) async {
    forwarder?.stop()
    forwarder = nil
    guard forwardWanted, let target = URL(string: config.baseURL.trimmingCharacters(in: .whitespaces)) else {
      if forwardState != .off { ForwardLog.write("转发已关") }
      forwardState = .off
      syncDesktopAddress(key: desktopKey)
      return
    }
    forwardState = .starting
    do {
      let f = try LocalForwarder(target: target)
      f.log = { ForwardLog.write($0) }
      f.key = forwarderKey
      f.onStop = { [weak self, weak f] why in
        Task { @MainActor in
          guard let self, let f, self.forwarder === f else { return }
          self.forwarderStopped(why)
        }
      }
      let preferred = UInt16(clamping: config.forwardPort)
      await reclaimPort(preferred)
      let p = try await f.start(preferred: preferred)
      // Shown as on only once it really answers there.
      guard await Task.detached(operation: { LocalForwarder.accepting(p) }).value else {
        f.stop()
        throw LocalForwarder.Failure.notAnswering(p)
      }
      forwarder = f
      config.forwardPort = Int(p)
      remember(LocalForwarder.url(port: p))
      saveConfig()
      ForwardLog.write("转发已开：\(LocalForwarder.url(port: p)) → \(target.absoluteString)")
      withAnimation(.snappy) { forwardState = .on(LocalForwarder.url(port: p)) }
      syncDesktopAddress(key: desktopKey, taken: p != preferred ? preferred : nil)
    } catch {
      ForwardLog.write("转发没能启动：\(error.localizedDescription)")
      withAnimation(.snappy) { forwardState = .failed(error.localizedDescription) }
      if !again {
        config.forward = false
        config.swapKeys = false
        saveConfig()
        // Off now: Desktop, if it was on the forwarder's address, goes back to the model API.
        syncDesktopAddress(key: desktopKey, failed: true)
      }
    }
  }

  /// Desktop runs but was opened before its address was changed: it still uses the old one,
  /// and the forwarder is no use to it until it is restarted.
  var desktopOnOldAddress: Bool {
    guard let t = desktopAddressChangedAt else { return false }
    return desktopApps.contains { ($0.launchDate ?? .distantPast) < t }
  }

  /// The forwarder's port is held by another QuotaBar (an older one an update left running):
  /// that one is ended, so that the port, the one Desktop uses, stays the same.
  private func reclaimPort(_ p: UInt16) async {
    guard !LocalForwarder.free(p) else { return }
    let out = (try? await Task.detached { try SourceUpdate.run(["lsof", "-nP", "-t", "-iTCP:\(p)", "-sTCP:LISTEN"], in: URL(fileURLWithPath: "/"), timeout: 5) }.value) ?? ""
    let mine = ProcessInfo.processInfo.processIdentifier
    let others = out.split(separator: "\n").compactMap { pid_t($0.trimmingCharacters(in: .whitespaces)) }
      .filter { $0 != mine }
      .compactMap { NSRunningApplication(processIdentifier: $0) }
      .filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
    guard !others.isEmpty else { return }
    ForwardLog.write("端口 \(p) 被另一个 QuotaBar（\(others.map { String($0.processIdentifier) }.joined(separator: ", "))）占着，结束它")
    others.forEach { $0.terminate() }
    for _ in 0..<30 where others.contains(where: { !$0.isTerminated }) { try? await Task.sleep(for: .milliseconds(100)) }
    others.filter { !$0.isTerminated }.forEach { $0.forceTerminate() }
    for _ in 0..<20 where !LocalForwarder.free(p) { try? await Task.sleep(for: .milliseconds(100)) }
  }

  /// The forwarder stopped by itself (the system ended its listener): started again at once.
  private func forwarderStopped(_ why: String) {
    ForwardLog.write("转发停了（\(why)），重新启动")
    Task { await startForwarder(again: true) }
  }

  /// Checks that the forwarder, if it is to run, really answers on its port (at each refresh,
  /// after waking, when the network comes back); starts it again if not.
  func checkForwarder() async {
    switch forwardState {
    case .on:
      guard let p = forwarder?.port else { return forwarderStopped("没有在运行") }
      if !(await Task.detached(operation: { LocalForwarder.accepting(p) }).value) {
        // Still the same one, and still on (nothing restarted it meanwhile).
        guard case .on = forwardState, forwarder?.port == p else { return }
        forwarderStopped("端口 \(p) 连不上")
      }
    case .failed where forwardWanted:
      await startForwarder(again: true)
    default:
      break
    }
  }

  private func remember(_ url: String) {
    guard !config.ours.contains(where: { ClaudeSettings.sameURL($0, url) }) else { return }
    config.ours = Array((config.ours + [url]).suffix(20))
  }

  /// Desktop is on one of our addresses, not the one it is to use (the forwarder moved, was
  /// turned on or off): put right, and said why (and asked about the restart Desktop needs).
  /// `taken`: the port the forwarder wanted, held by another program. `failed`: the forwarder
  /// couldn't start, so is off.
  private func syncDesktopAddress(key: String? = nil, taken: UInt16? = nil, failed: Bool = false) {
    guard case .gateway(_, let current) = ClaudeDesktop.status(dir: config.desktopLibrary) else { return }
    let want = desktopWant
    let move = DesktopURL.change(current: current, want: want, ours: config.ours + [config.baseURL]) == .replace
    guard move || key != nil else { return }
    do {
      guard try ClaudeDesktop.switchKey(key, baseURL: move ? want : nil, dir: config.desktopLibrary) == .written else { return }
      if move {
        remember(want)
        desktopAddressChangedAt = Date()
      }
      saveConfig()
      readDesktop()
      var why: [String] = []
      if move {
        let short = want.replacingOccurrences(of: "http://", with: "")
        if case .on = forwardState {
          if let taken { why.append("端口 \(taken) 被其他程序占用，本地转发改用 \(short)") }
          else if current.map({ $0.contains("127.0.0.1") }) ?? false { why.append("本地转发的地址改为 \(short)") }
          else { why.append("Desktop 改为经本地转发（\(short)）访问模型接口") }
        } else {
          why.append((failed ? "本地转发没能启动" : "本地转发已关闭") + "，Desktop 改回直连模型接口（\(want)）")
        }
      }
      if let key {
        let name = people.first { $0.key == key }.map { "「\($0.label)」的" } ?? ""
        why.append("免重启切换已关闭，Desktop 改用配置里\(name) key")
      }
      changedDesktop(why.joined(separator: "；"), live: !move && desktopOnForwarder)
    } catch {
      notice = Notice(text: "Desktop 地址未改：" + error.localizedDescription, bad: true)
    }
  }

  /// Desktop is on the gateway but not on the running forwarder's address (one set elsewhere):
  /// the settings offer to put it there.
  var desktopOffForwarder: String? {
    guard case .on(let u) = forwardState, case .gateway(let cur) = desktopMode, !ClaudeSettings.sameURL(cur, u) else { return nil }
    return cur ?? "未设置"
  }

  /// Puts Desktop on the forwarder's address (asked for in the settings).
  func pointDesktopAtForwarder() {
    guard case .on(let u) = forwardState else { return }
    do {
      guard try ClaudeDesktop.switchKey(nil, baseURL: u, dir: config.desktopLibrary) == .written else { return readDesktop() }
      remember(u)
      desktopAddressChangedAt = Date()
      saveConfig()
      readDesktop()
      changedDesktop("Desktop 改为经本地转发（\(u.replacingOccurrences(of: "http://", with: ""))）访问模型接口")
    } catch {
      notice = Notice(text: "Desktop 地址未改：" + error.localizedDescription, bad: true)
    }
  }

  /// Says what changed in Desktop's configuration and why; if Desktop runs, it needs a restart
  /// for it (asked, done or offered, as set).
  /// `live`: only the key changed and Desktop goes through the forwarder, which sends it now.
  private func changedDesktop(_ why: String, live: Bool = false) {
    if live {
      notice = Notice(text: why + "，已生效，无需重启")
      return
    }
    notice = Notice(text: why + (desktopRunning ? "，重启 Desktop 后生效" : ""))
    if desktopRunning { afterDesktopChanged(why) }
  }


  /// How Desktop starts: on the gateway, at the Anthropic sign-in, or as the company set it.
  private(set) var desktopMode = ClaudeDesktop.Mode.signIn

  func readDesktop() {
    desktopMode = ClaudeDesktop.mode(root: config.desktopRoot)
    forwarder?.key = forwarderKey
  }

  /// The key to give Desktop: Claude Code's, else the first one there is.
  var desktopKeyPerson: Person? { active ?? people.first { !$0.key.isEmpty } }

  /// Desktop to start on the gateway (the model API, through the forwarder if it is on) with
  /// Claude Code's key, or at the Anthropic sign-in.
  func setDesktopMode(gateway: Bool) {
    do {
      var text: String
      if gateway {
        guard let p = desktopKeyPerson else {
          notice = Notice(text: "先添加 key", bad: true)
          return
        }
        let want = desktopWant
        try ClaudeDesktop.useGateway(key: p.key, baseURL: want, root: config.desktopRoot, previous: config.desktopPrevious)
        remember(want)
        if config.swapKeys { config.desktopPerson = p.id }
        text = "Desktop 改用网关（\(p.label) 的 key）"
        if LocalForwarder.needed(for: want) && !want.hasPrefix("http://127.0.0.1") { text += "，需开本地转发" }
      } else {
        if let was = try ClaudeDesktop.useSignIn(root: config.desktopRoot) { config.desktopPrevious = was }
        text = "Desktop 改用官方登录"
      }
      saveConfig()
      withAnimation(.snappy) { readDesktop() }
      changedDesktop(text)
    } catch {
      readDesktop()
      notice = Notice(text: "Desktop 未改：" + error.localizedDescription, bad: true)
    }
  }

  func setDesktopRestart(_ r: DesktopRestart) {
    config.desktopRestart = r
    saveConfig()
  }

  func remove(_ p: Person) {
    config.people.removeAll { $0.id == p.id }
    failures[p.id] = nil
    failingSince[p.id] = nil
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

  private func saveConfig() {
    write(config, to: configFile)
    forwarder?.key = forwarderKey
  }
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
  func restart(after delay: TimeInterval = 0) {
    loop?.cancel()
    loop = Task { [weak self] in
      if delay > 0 { try? await Task.sleep(for: .seconds(delay)) }
      while !Task.isCancelled {
        guard let self else { return }
        await self.refresh()
        let soon = self.failures.values.contains { $0.kind != .keyRejected }
        try? await Task.sleep(for: .seconds(soon ? min(15, max(10, self.config.interval)) : max(10, self.config.interval)))
      }
    }
  }

  /// Worth the "!" in the menu bar for `p` (see Failure.worthBar).
  func troubleInBar(_ p: Person) -> Bool {
    guard let f = failures[p.id] else { return p.key.isEmpty }
    return f.worthBar(hasReading: p.lastGood != nil, failingFor: Date().timeIntervalSince(failingSince[p.id] ?? Date()))
  }

  /// The network is there again: read now if readings failed for want of it.
  private func networkBack() {
    Task { await checkForwarder() }
    if failures.values.contains(where: { $0.kind == .network }) { restart() }
  }

  /// A key was turned down: the cookie sync, if on, fetches the new one now (once a minute at most).
  private func kickCookieSync() {
    guard config.cookieSync, lastCookieKick.map({ Date().timeIntervalSince($0) > 60 }) ?? true else { return }
    lastCookieKick = Date()
    Task { await syncFromCookies(interactive: false) }
  }

  func refresh() async {
    await checkForwarder()
    readSettings()
    readDesktop()
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
      if failingSince[id] == nil { failingSince[id] = at }
      let name = people.first(where: { $0.id == id })?.label ?? id
      RefreshLog.write(name + ": " + f.kind.rawValue + " " + f.detail)
      // A rotated key: the portal has the new one (when the cookie sync is on).
      if f.kind == .keyRejected { kickCookieSync() }
      return nil
    case .ok(let q, let title):
      failures[id] = nil
      if failingSince[id] != nil { RefreshLog.write((people.first(where: { $0.id == id })?.label ?? id) + ": ok again") }
      failingSince[id] = nil
      guard let b = People.bind(id: id, name: title ?? "", reading: GoodReading(at: at, usage: q), in: &config.people) else { return nil }
      if let m = b.merged {
        // The entry the key came in on is gone: its points are the person's.
        for i in history.indices where history[i].key == m { history[i].key = b.id }
        failures[m] = nil
        failingSince[m] = nil
      }
      failures[b.id] = nil
      failingSince[b.id] = nil
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
    if case .gateway(let k, _) = ClaudeDesktop.status(dir: config.desktopLibrary), k == old, !desktopViaForwarder { desktop = true }
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
      // Through the forwarder, which now sends the new key: nothing to restart.
      if desktopChanged && desktopOnForwarder {
        readDesktop()
        desktopChanged = false
      }
    }
    if !problems.isEmpty {
      notice = Notice(text: "「\(name)」换了新 key，未能同步：" + problems.joined(separator: "；"), bad: true)
      return
    }
    notice = Notice(text: "「\(name)」换了新 key，已同步" + (desktopChanged ? "，Desktop 重启后生效" : ""),
                    restartDesktop: desktopChanged && desktopRunning && config.desktopRestart != .never)
    if desktopChanged && config.desktopRestart == .always && desktopRunning { restartDesktop(why: "「\(name)」换了新 key") }
  }

  // MARK: - Cookie sync

  /// The browser the cookies come from, by the saved name.
  var cookieBrowser: ChromeCookies.Browser {
    ChromeCookies.all.first { $0.name == config.cookieBrowser } ?? ChromeCookies.chrome
  }

  func setCookieSync(_ on: Bool) {
    config.cookieSync = on
    saveConfig()
    startCookieLoop()
    if on { Task { await syncFromCookies(interactive: true) } }
  }

  func setCookieBrowser(_ name: String) {
    config.cookieBrowser = name
    saveConfig()
    if config.cookieSync { Task { await syncFromCookies(interactive: true) } }
  }

  /// Runs the cookie sync now and then every `cookieInterval`, while it is on.
  private func startCookieLoop() {
    cookieLoop?.cancel()
    guard config.cookieSync else { return }
    cookieLoop = Task { [weak self] in
      // A moment after launch, so the first reading and the keychain prompt don't collide.
      try? await Task.sleep(for: .seconds(3))
      while !Task.isCancelled {
        guard let self else { return }
        await self.syncFromCookies(interactive: false)
        try? await Task.sleep(for: .seconds(Self.cookieInterval))
      }
    }
  }

  /// Reads the browser's cookies, asks the portal for the current token, and upserts the person
  /// by nickname. A rotated token that Claude Code or Desktop still uses is synced too (as a
  /// pasted new key is). `interactive`: show why it failed; the periodic run stays quiet.
  func syncFromCookies(interactive: Bool) async {
    guard !cookieSyncing, let url = URL(string: config.cookieURL.trimmingCharacters(in: .whitespaces)) else { return }
    cookieSyncing = true
    defer { cookieSyncing = false }
    let browser = cookieBrowser
    let result: Result<ProxyUsage, Failure> = await Task.detached { () async -> Result<ProxyUsage, Failure> in
      do {
        let cookie = try ChromeCookies.header(domain: url.host ?? "ai-coding.bilibili.co", browser: browser)
        let (data, resp) = try await URLSession(configuration: .ephemeral).data(for: ProxyUsageAPI.request(url: url, cookie: cookie))
        return ProxyUsageAPI.parse(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, body: data)
      } catch let e as ChromeCookies.CookieError {
        return .failure(Failure(.network, e.errorDescription ?? "读取 cookie 失败"))
      } catch {
        return .failure(Failure(.network, error.localizedDescription))
      }
    }.value

    switch result {
    case .failure(let f):
      if interactive { notice = Notice(text: "Cookie 同步失败：" + f.detail, bad: true) }
    case .success(let u):
      guard let name = u.nickname, let token = u.token else {
        if interactive { notice = Notice(text: "Cookie 同步：没拿到 token（可能未登录）", bad: true) }
        return
      }
      let reading = GoodReading(at: Date(), usage: u.usage)
      let before = config.people.first { $0.name == name }?.key
      guard let b = withAnimation(.snappy, { People.upsert(name: name, key: token, reading: reading, in: &config.people) }) else { return }
      if let old = b.replaced {
        // replaced() syncs Claude Code / Desktop and sets its own, fuller notice.
        replaced(old, by: token, for: b.id)
      }
      saveConfig()
      writeHistory()
      if before != token {
        // The reading that failed was of the old key: read the new one now.
        failures[b.id] = nil
        failingSince[b.id] = nil
        Task { await self.refresh() }
      }
      if b.replaced == nil && notice?.bad != true {
        if before == token { if interactive { notice = Notice(text: "「\(name)」的 key 已是最新") } }
        else { notice = Notice(text: "Cookie 同步：已添加「\(name)」") }
      }
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
    case .gateway where desktopViaForwarder && desktopChange != .ask:
      // The forwarder sends the key: changed there, at once.
      config.desktopPerson = p.id
      saveConfig()
      parts.append("Desktop 已生效，无需重启")
    case .gateway:
      do {
        let wantURL = desktopChange == .replace || desktopChange == .ask && setURL ? desktopWant : nil
        desktopChanged = try ClaudeDesktop.switchKey(p.key, baseURL: wantURL, dir: config.desktopLibrary) == .written
        if let wantURL { remember(wantURL); saveConfig() }
        // Desktop goes through the forwarder, which now sends this key: nothing to restart.
        let live = desktopChanged && wantURL == nil && desktopOnForwarder
        if live { readDesktop() }
        parts.append(live ? "Desktop 已生效，无需重启" : !desktopChanged ? "Desktop 已在用" : desktopRunning ? "Desktop 重启后生效" : "Desktop 下次打开生效")
        if live { desktopChanged = false }
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
    readDesktop()
    notice = Notice(text: "已切换到「\(p.label)」：" + parts.joined(separator: "，"))
    if desktopChanged && desktopRunning { afterDesktopChanged("Desktop 改用「\(p.label)」的 key") }
  }

  /// Desktop's configuration changed (`why`) while it runs: relaunch it, or not, as chosen (or
  /// ask, saying why).
  private func afterDesktopChanged(_ why: String) {
    var choice = config.desktopRestart
    if choice == .ask {
      let (now, remember) = Dialogs.restartDesktop(why: why)
      choice = now ? .always : .never
      if remember { setDesktopRestart(choice) }
    }
    if choice == .always { restartDesktop(why: why) }
    else { notice?.restartDesktop = true }
  }

  // MARK: - Claude Desktop

  private var desktopApps: [NSRunningApplication] {
    NSRunningApplication.runningApplications(withBundleIdentifier: ClaudeDesktop.bundleID)
  }

  var desktopRunning: Bool { !desktopApps.isEmpty }

  /// Quits Claude Desktop and opens it again, so that it reads its new key.
  func restartDesktop(why: String? = nil) {
    let apps = desktopApps
    let url = apps.first?.bundleURL ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: ClaudeDesktop.bundleID)
    notice = Notice(text: "正在重启 Desktop" + (why.map { "：" + $0 } ?? "…"))
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
      desktopAddressChangedAt = nil
      notice = Notice(text: "Desktop 已重启，改动已生效")
    }
  }
}

/// A log under ~/Library/Logs/QuotaBar, kept under 1 MB.
struct LogFile: Sendable {
  let url: URL
  private static let queue = DispatchQueue(label: "QuotaBar.Log")

  init(_ name: String) {
    url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/QuotaBar/" + name)
  }

  func write(_ line: String) {
    let text = Date().formatted(.iso8601) + " " + line + "\n"
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
