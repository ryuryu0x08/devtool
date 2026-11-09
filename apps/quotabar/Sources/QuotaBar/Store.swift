// The app's state: the config (the API, the people and their keys), the latest reading of every
// person, the history, and which key Claude Code is set to. Kept in
// ~/Library/Application Support/QuotaBar (readable by the owner only: it holds the keys).
import AppKit
import Foundation
import Observation
import Network
import QuotaCore
import SwiftUI

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
  @ObservationIgnored private let forwarding = Forwarding()
  /// Counts startForwarder calls (see there).
  @ObservationIgnored private var forwardGen = 0
  /// What the running Desktop read at its launch (nil: Desktop doesn't run). Compared with the
  /// configuration now, it tells what a restart would bring (`desktopLacks`).
  private(set) var desktopSeen: DesktopSeen?
  /// What the running Desktop lacks of its configuration now (empty: nothing to restart for).
  private(set) var desktopLacks: [String] = []
  /// Both gateways' model lists, when a other gateway is set.
  private(set) var gatewayModels = GatewayModels()
  /// The company's gateway answered 403 (quota used up): requests go to the other gateway until then.
  private(set) var fallingBackUntil: Date?

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
    forwarding.onStop = { [weak self] why in self?.forwarderStopped(why) }
    forwarding.onRequest = { [weak self] in self?.heardDesktop() }
    forwarding.onModels = { [weak self] mine, theirs in self?.setModels(company: mine, other: theirs) }
    forwarding.onFallback = { [weak self] until in self?.fellBack(until: until) }
    load()
    applyRoutes()
    findDesktop()
    readSettings()
    adoptClaudeKey()
    restart()
    startCookieLoop()
    Task { await startForwarder() }
    // The logs keep their last 10 minutes only.
    LogFile.trimAll()
    Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { _ in LogFile.trimAll() }
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
    // Desktop opened again (by hand too) or quit: what it hadn't read yet, it reads at launch.
    for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
      NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] n in
        let app = n.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
        guard app?.bundleIdentifier == ClaudeDesktop.bundleID else { return }
        Task { @MainActor in self?.desktopOpenedOrQuit() }
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
    // Saved as it is typed: a half-typed address ("ht", "https:") is not taken (it would move
    // Desktop onto it and turn the forwarder off); the one before stays until it is whole.
    let newBase = b.isEmpty ? Config.defaultBaseURL : Self.usable(b) ? b : config.baseURL
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

  /// An http(s) address with a host.
  static func usable(_ s: String) -> Bool {
    guard let u = URL(string: s.trimmingCharacters(in: .whitespaces)), ["http", "https"].contains(u.scheme?.lowercased() ?? ""), let h = u.host, !h.isEmpty else { return false }
    return true
  }

  // MARK: - Local forwarder

  /// The model API is http and not this machine: Desktop needs the forwarder for it.
  var forwardNeeded: Bool { LocalForwarder.needed(for: config.baseURL) }

  /// The running forwarder's address.
  var forwarderURL: String? {
    if case .on(let u) = forwardState { return u }
    return nil
  }

  /// The address Desktop is to use: the forwarder's while it runs, else the model API.
  var desktopWant: String { link.want }

  /// Desktop and the forwarder as they are now, for the rules in DesktopLink.
  var link: DesktopLink {
    DesktopLink(desktop: ClaudeDesktop.status(dir: config.desktopLibrary), forwarder: forwarderURL, baseURL: config.baseURL,
                ours: config.ours, swapKeys: config.swapKeys,
                chosenKey: people.first { $0.id == config.desktopPerson }?.key, desktopOnOldAddress: desktopOnOldAddress)
  }

  func setForward(_ on: Bool) {
    config.forward = on
    saveConfig()
    Task { await startForwarder() }
  }

  /// The forwarder runs: Desktop needs it for an http model API, it swaps the keys, or it sends
  /// the other gateway's models there.
  var forwardWanted: Bool { config.swapKeys || config.forward && forwardNeeded || otherGateway != nil }

  /// The key the forwarder sends in place of Desktop's (see DesktopLink.forwarderKey).
  var forwarderKey: String? { link.forwarderKey }

  /// The person whose key Desktop uses through the forwarder.
  var desktopPersonNow: Person? { config.swapKeys ? people.first { $0.id == config.desktopPerson } : nil }

  /// Desktop is on the running forwarder, which swaps the keys: a switch needs no restart.
  var desktopViaForwarder: Bool { link.swapping }

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
    // Starts and stops can overlap (a toggle clicked twice, a refresh and a wake at once): only
    // the latest one sets the state and the settings.
    forwardGen += 1
    let gen = forwardGen
    forwarding.stop()
    guard forwardWanted, let target = URL(string: config.baseURL.trimmingCharacters(in: .whitespaces)) else {
      if forwardState != .off { ForwardLog.write("转发已关") }
      forwardState = .off
      syncDesktopAddress(key: desktopKey)
      syncCLIAddress()
      // What the running Desktop lacks depends on the forwarder too (it sends the key).
      readDesktop()
      return
    }
    forwardState = .starting
    do {
      let preferred = UInt16(clamping: config.forwardPort)
      let p = try await forwarding.start(target: target, preferred: preferred, key: forwarderKey)
      guard gen == forwardGen else { return }
      config.forwardPort = Int(p)
      remember(LocalForwarder.url(port: p))
      saveConfig()
      ForwardLog.write("转发已开: \(LocalForwarder.url(port: p)) → \(target.absoluteString)")
      withAnimation(.snappy) { forwardState = .on(LocalForwarder.url(port: p)) }
      // Its key again, now that it is on (Desktop's configured key is read with it running).
      forwarding.key = forwarderKey
      syncDesktopAddress(key: desktopKey, taken: p != preferred ? preferred : nil)
      syncCLIAddress()
      readDesktop()
      await refreshModels()
    } catch is CancellationError {
      // Another start (or a stop) came meanwhile: that one says how it is.
      return
    } catch {
      guard gen == forwardGen else { return }
      ForwardLog.write("转发没能启动: \(error.localizedDescription)")
      withAnimation(.snappy) { forwardState = .failed(error.localizedDescription) }
      if !again {
        config.forward = false
        config.swapKeys = false
        saveConfig()
        // Off now: Desktop, if it was on the forwarder's address, goes back to the model API.
        syncDesktopAddress(key: desktopKey, failed: true)
        syncCLIAddress()
      }
      readDesktop()
    }
  }

  /// Desktop runs but was opened before its address was changed: it still uses the old one,
  /// and the forwarder is no use to it until it is restarted.
  var desktopOnOldAddress: Bool {
    guard let seen = desktopSeen, case .gateway(_, let now) = ClaudeDesktop.status(dir: config.desktopLibrary) else { return false }
    return !((seen.url ?? "").isEmpty && (now ?? "").isEmpty) && !ClaudeSettings.sameURL(seen.url, now)
  }

  /// The forwarder stopped by itself (the system ended its listener): started again at once.
  private func forwarderStopped(_ why: String) {
    ForwardLog.write("转发停了 (\(why)), 重新启动")
    Task { await startForwarder(again: true) }
  }

  /// Checks that the forwarder, if it is to run, really answers on its port (at each refresh,
  /// after waking, when the network comes back); starts it again if not.
  func checkForwarder() async {
    switch forwardState {
    case .on:
      guard let p = forwarding.port else { return forwarderStopped("没有在运行") }
      if !(await Forwarding.answers(p)) {
        // Still the same one, and still on (nothing restarted it meanwhile).
        guard case .on = forwardState, forwarding.port == p else { return }
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

  /// After the forwarder started, moved or stopped: Desktop follows if it is on one of our
  /// addresses (see DesktopLink.afterForwarder), and it is said why. `key`: the swapped key, to
  /// be written when swapping was turned off.
  private func syncDesktopAddress(key: String? = nil, taken: UInt16? = nil, failed: Bool = false) {
    let owner = key.flatMap { k in people.first { $0.key == k }?.label }
    guard let c = link.afterForwarder(key: key, owner: owner, taken: taken, failed: failed) else { return }
    writeDesktop(c)
  }

  /// Desktop is on the gateway but not on the running forwarder's address (one set elsewhere):
  /// the settings offer to put it there.
  var desktopOffForwarder: String? { DesktopLink.offForwarder(forwarder: forwarderURL, desktop: desktopMode) }

  /// Puts Desktop on the forwarder's address (asked for in the settings).
  func pointDesktopAtForwarder() {
    guard let c = link.toForwarder() else { return readDesktop() }
    writeDesktop(c)
  }

  /// Writes a change into Desktop's configuration and says what changed and why.
  private func writeDesktop(_ c: DesktopLink.Change) {
    do {
      guard try ClaudeDesktop.switchKey(c.key, baseURL: c.url, dir: config.desktopLibrary) == .written else { return readDesktop() }
      if let u = c.url { remember(u) }
      saveConfig()
      readDesktop()
      announceDesktop(why: c.why)
    } catch {
      notice = Notice(text: "Desktop 未改: " + error.localizedDescription, bad: true)
    }
  }

  /// The one place a change to Desktop's configuration is told: what changed and why (`text`,
  /// else `why`), and, when the running Desktop lacks something of it now (`desktopLacks`), the
  /// restart as set (done, asked with `why`, or offered by the message's button). A change
  /// that the running Desktop has anyway (undone before a restart, or a key the forwarder
  /// sends) asks nothing. `changed`: false when nothing was written (the message only).
  private func announceDesktop(why: String, text: String? = nil, changed: Bool = true) {
    readDesktop()
    let restart = changed && desktopRunning && !desktopLacks.isEmpty
    var t = text ?? why
    if text == nil && changed && desktopRunning { t += restart ? ", 重启 Desktop 后生效" : ", 已生效, 无需重启" }
    let n = Notice(text: t)
    notice = n
    guard restart else { return }
    // After this turn: a question asked in the middle of a refresh or an animation would hold
    // them up.
    Task { @MainActor in self.restartAsSet(why: why, notice: n.id) }
  }

  /// A restart question is open.
  @ObservationIgnored private var askingRestart = false

  /// Desktop was opened (it reads its configuration now) or quit (it will at its next launch).
  private func desktopOpenedOrQuit() {
    if DesktopApp.running { sawDesktop() } else { forgetDesktop() }
    readDesktop()
  }

  /// The running Desktop read the configuration as it is now (just opened, or found running
  /// with nothing known of what it read): kept, also for the next start of this app.
  private func sawDesktop() {
    keep(DesktopSeen(mode: ClaudeDesktop.mode(root: config.desktopRoot), status: ClaudeDesktop.status(dir: config.desktopLibrary)))
  }

  /// Keeps what the running Desktop has, also for the next start of this app.
  private func keep(_ seen: DesktopSeen) {
    desktopSeen = seen
    if let d = try? JSONEncoder().encode(SeenSaved(launched: Self.desktopLaunched, seen: seen)) { UserDefaults.standard.set(d, forKey: "desktopSeen") }
  }

  /// When the running Desktop was opened (its first process).
  private static var desktopLaunched: TimeInterval {
    DesktopApp.apps.compactMap(\.launchDate).min()?.timeIntervalSince1970 ?? 0
  }

  private func forgetDesktop() {
    desktopSeen = nil
    UserDefaults.standard.removeObject(forKey: "desktopSeen")
  }

  /// A request came through the forwarder while Desktop runs: Desktop is on the forwarder's
  /// address now. What it was thought to have read is corrected if it said otherwise (it was
  /// changed while this app didn't run, or by hand); checked again then.
  private func heardDesktop() {
    guard let seen = desktopSeen, let url = forwarderURL else { return }
    let heard = seen.heard(on: url)
    guard heard.mode != seen.mode || !ClaudeSettings.sameURL(heard.url, seen.url) else { return }
    keep(heard)
    readDesktop()
  }

  /// What Desktop read, with its launch time (still the same Desktop when this app starts again).
  private struct SeenSaved: Codable {
    var launched: TimeInterval
    var seen: DesktopSeen
  }

  /// At this app's start: what the running Desktop read, kept from before if it is the same
  /// Desktop, else taken as it is now.
  private func findDesktop() {
    guard DesktopApp.running else { return forgetDesktop() }
    if let d = UserDefaults.standard.data(forKey: "desktopSeen"), let s = try? JSONDecoder().decode(SeenSaved.self, from: d), abs(s.launched - Self.desktopLaunched) < 1 {
      desktopSeen = s.seen
    } else {
      sawDesktop()
    }
  }

  /// Relaunches Desktop, asks first, or leaves a button for it in the message, as set.
  private func restartAsSet(why: String, notice id: UUID) {
    // Quit meanwhile (it reads the change when opened), or the change undone: nothing to do.
    readDesktop()
    guard desktopRunning, !desktopLacks.isEmpty else { return }
    var choice = config.desktopRestart
    if choice == .ask && (askingRestart || Dialogs.isOpen) {
      // A question is open already (its restart covers this change too): the button only.
      if notice?.id == id { notice?.restartDesktop = true }
      return
    }
    if choice == .ask {
      askingRestart = true
      defer { askingRestart = false }
      let (now, remember) = Dialogs.restartDesktop(why: why)
      choice = now ? .always : .never
      if remember { setDesktopRestart(choice) }
    }
    if choice == .always {
      restartDesktop(why: why)
    } else if notice?.id == id {
      notice?.restartDesktop = true
    } else {
      notice = Notice(text: why + ", 重启 Desktop 后生效", restartDesktop: true)
    }
  }


  /// How Desktop starts: on the gateway, at the Anthropic sign-in, or as the company set it.
  private(set) var desktopMode = ClaudeDesktop.Mode.signIn

  func readDesktop() {
    desktopMode = ClaudeDesktop.mode(root: config.desktopRoot)
    forwarding.key = forwarderKey
    if desktopSeen == nil && DesktopApp.running { sawDesktop() }
    if desktopSeen != nil && !DesktopApp.running { forgetDesktop() }
    let now = DesktopSeen(mode: desktopMode, status: ClaudeDesktop.status(dir: config.desktopLibrary))
    let lacks = desktopSeen?.lacks(now, forwarder: forwarderURL) { k in self.people.first { $0.key == k }?.label } ?? []
    if lacks != desktopLacks { withAnimation(.snappy) { desktopLacks = lacks } }
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
        text = "Desktop 改用网关 (\(p.label) 的 key)"
        if LocalForwarder.needed(for: want) && !want.hasPrefix("http://127.0.0.1") { text += ", 需开本地转发" }
      } else {
        if let was = try ClaudeDesktop.useSignIn(root: config.desktopRoot) { config.desktopPrevious = was }
        text = "Desktop 改用官方登录"
      }
      saveConfig()
      withAnimation(.snappy) { readDesktop() }
      announceDesktop(why: text)
    } catch {
      readDesktop()
      notice = Notice(text: "Desktop 未改: " + error.localizedDescription, bad: true)
    }
  }

  func setDesktopRestart(_ r: DesktopRestart) {
    config.desktopRestart = r
    saveConfig()
  }

  func setBarStyle(_ s: BarStyle) {
    config.barStyle = s
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
    if let d = try? Data(contentsOf: configFile) {
      do {
        config = try dec.decode(Config.self, from: d)
      } catch {
        // Unreadable (edited by hand, or written by another version): kept aside before anything
        // is saved over it, since it holds the keys.
        let aside = Self.dir.appendingPathComponent("config.unreadable-\(Int(Date().timeIntervalSince1970)).json")
        try? FileManager.default.copyItem(at: configFile, to: aside)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: aside.path)
        notice = Notice(text: "设置文件读不出, 已另存为 \(aside.lastPathComponent), 现用默认设置", bad: true)
      }
    }
    if let d = try? Data(contentsOf: historyFile), let h = try? dec.decode([Sample].self, from: d) { history = History.thin(h) }
  }

  private func saveConfig() {
    write(config, to: configFile)
    forwarding.key = forwarderKey
    forwarding.second = otherGateway
    forwarding.keyNames = keyNames
    forwarding.fallback = fallbackModelNow
    forwarding.fallbackFor = TimeInterval(config.fallbackMinutes * 60)
    if fallbackModelNow == nil { fallingBackUntil = nil }
  }

  /// The model the forwarder falls back to on a 403, when that is on and can be done.
  var fallbackModelNow: String? {
    let m = config.fallbackModel.trimmingCharacters(in: .whitespaces)
    return config.autoFallback && otherGateway != nil && !m.isEmpty ? m : nil
  }

  /// Saves the fallback (on or off, the model, the minutes before the company's is tried again).
  func setFallback(on: Bool, model: String, minutes: Int) {
    let minutes = min(60, max(1, minutes))
    guard on != config.autoFallback || model != config.fallbackModel || minutes != config.fallbackMinutes else { return }
    config.autoFallback = on
    config.fallbackModel = model
    config.fallbackMinutes = minutes
    saveConfig()
  }

  /// A 403 from the company's gateway started the fallback: said once, shown until `until`.
  private func fellBack(until: Date) {
    let first = fallingBackUntil == nil
    fallingBackUntil = until
    if first, let m = fallbackModelNow {
      notice = Notice(text: "公司额度用尽 (403), 已改用其他网关的 \(m); \(until.formatted(date: .omitted, time: .shortened)) 再试公司网关", bad: true)
    }
    // Back to the company's once the time is up (the next 403 starts it again).
    Task { [weak self] in
      try? await Task.sleep(for: .seconds(max(0, until.timeIntervalSinceNow) + 1))
      guard let self, let u = self.fallingBackUntil, u <= Date() else { return }
      self.fallingBackUntil = nil
    }
  }

  /// Who each key is, for the request log: people by name, the other gateway's as such.
  private var keyNames: [String: String] {
    var names: [String: String] = [:]
    for p in people where !p.key.isEmpty { names[p.key] = p.label }
    if let g = otherGateway { names[g.key] = "其他网关的 key" }
    return names
  }

  /// The requests through the forwarder in the last 10 minutes, newest first.
  func recentRequests() -> [RequestRecord] { forwarding.requests.recent() }
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
      notice = Notice(text: "无法保存 \(url.lastPathComponent): \(error.localizedDescription)", bad: true)
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
      notice = Notice(text: "已在列表: \(label)")
      return
    case .added(let id):
      withAnimation(.snappy) { config.people = ps }
      saveConfig()
      guard let url = usageURL else {
        notice = Notice(text: "已添加, 填好用量接口后识别")
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
        notice = Notice(text: "已添加, 未识别: " + f.friendly, bad: true)
      } else if let b, let p = people.first(where: { $0.id == b.id }), notice?.bad != true {
        let claude = b.replaced != nil && activeToken == key ? ", Claude Code 已同步" : ""
        notice = Notice(text: b.merged != nil ? "已更新 \"\(p.label)\" 的 key" + claude : "已添加 \"\(p.label)\"")
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
    Task { await refreshModels() }
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
      catch { problems.append("Claude Code: " + error.localizedDescription) }
    }
    var desktopChanged = false
    if desktop {
      do { desktopChanged = try ClaudeDesktop.switchKey(new, dir: config.desktopLibrary) == .written }
      catch { problems.append("Desktop: " + error.localizedDescription) }
    }
    readDesktop()
    if !problems.isEmpty {
      notice = Notice(text: "\"\(name)\" 换了新 key, 未能同步: " + problems.joined(separator: "; "), bad: true)
      return
    }
    announceDesktop(why: "\"\(name)\" 换了新 key, Desktop 改用新 key",
                    text: "\"\(name)\" 换了新 key, 已同步" + (desktopChanged && desktopRunning && !desktopLacks.isEmpty ? ", Desktop 重启后生效" : ""),
                    changed: desktopChanged)
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
    let result = await CookieSync.fetch(url: url, browser: browser)

    switch result {
    case .failure(let f):
      if interactive { notice = Notice(text: "Cookie 同步失败: " + f.detail, bad: true) }
    case .success(let u):
      guard let name = u.nickname, let token = u.token else {
        if interactive { notice = Notice(text: "Cookie 同步: 没拿到 token (可能未登录)", bad: true) }
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
        if before == token { if interactive { notice = Notice(text: "\"\(name)\" 的 key 已是最新") } }
        else { notice = Notice(text: "Cookie 同步: 已添加 \"\(name)\"") }
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
      notice = Notice(text: "无可切换: 没有 \(config.settingsPath), Desktop 未用网关", bad: true)
      return
    }

    // Another model API somewhere: change it too, or only the key?
    var others: [String] = []
    // Claude Code goes through the forwarder too while it sends the other gateway's models there; an
    // address of ours is put right silently.
    let cliWant = self.cliWant
    if let t = cliFile {
      let now = ClaudeSettings.currentEnv(ClaudeSettings.baseURLKey, in: t)
      if !ClaudeSettings.sameURL(now, cliWant) && !isOurs(now) { others.append("Claude Code: " + (now ?? "未设置 (官方接口)")) }
    }
    // Desktop is to use the forwarder while it runs; an address of ours is put right silently.
    let desktopWant = self.desktopWant
    let desktopChange = onGateway ? DesktopURL.change(current: desktopURL, want: desktopWant, ours: config.ours + [base]) : .same
    if desktopChange == .ask { others.append("Desktop: " + (desktopURL ?? "未设置")) }
    var setURL = false
    if !others.isEmpty {
      var wanted = base
      if cliWant != base { wanted += "\nClaude Code 经本地转发: " + cliWant }
      if desktopWant != base { wanted += "\nDesktop 经本地转发: " + desktopWant }
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
        let wantURL = (setURL || isOurs(urlNow)) && !ClaudeSettings.sameURL(urlNow, cliWant) ? cliWant : nil
        _ = try ClaudeSettings.switchToken(p.key, baseURL: wantURL, path: config.settingsPath)
        withAnimation(.snappy) { readSettings() }
        parts.append("Claude Code 已生效")
      } catch { problems.append("Claude Code: " + error.localizedDescription) }
    }
    var desktopChanged = false
    switch desk {
    case .gateway where desktopViaForwarder && desktopChange != .ask:
      // The forwarder sends the key: changed there, at once.
      config.desktopPerson = p.id
      saveConfig()
      parts.append("Desktop 已生效, 无需重启")
    case .gateway:
      do {
        let wantURL = desktopChange == .replace || desktopChange == .ask && setURL ? desktopWant : nil
        desktopChanged = try ClaudeDesktop.switchKey(p.key, baseURL: wantURL, dir: config.desktopLibrary) == .written
        if let wantURL { remember(wantURL); saveConfig() }
        // What the running Desktop has of it (through the forwarder a key is there at once).
        readDesktop()
        parts.append(!desktopChanged ? "Desktop 已在用" : !desktopRunning ? "Desktop 下次打开生效" : desktopLacks.isEmpty ? "Desktop 已生效, 无需重启" : "Desktop 重启后生效")
        if LocalForwarder.needed(for: wantURL ?? desktopURL ?? "") { parts.append("Desktop 需开本地转发 (设置 → Desktop)") }
      } catch { problems.append("Desktop: " + error.localizedDescription) }
    case .managed:
      parts.append("Desktop 由公司管理, 未改")
    case .notGateway:
      break
    }
    if !problems.isEmpty {
      notice = Notice(text: "切换到 \"\(p.label)\" 未完成: " + problems.joined(separator: "; "), bad: true)
      return
    }
    readDesktop()
    announceDesktop(why: "Desktop 改用 \"\(p.label)\" 的 key", text: "已切换到 \"\(p.label)\": " + parts.joined(separator: ", "), changed: desktopChanged)
  }

  // MARK: - The other gateway

  /// The other gateway, when its address and key are both set.
  var otherGateway: LocalForwarder.Gateway? {
    let u = config.otherURL.trimmingCharacters(in: .whitespaces), k = config.otherKey.trimmingCharacters(in: .whitespaces)
    guard Self.usable(u), !k.isEmpty, let url = URL(string: u) else { return nil }
    return try? LocalForwarder.Gateway(url: url, key: k)
  }

  /// Saves the other gateway as typed: with one set (or none any more) the forwarder starts
  /// (or stops), and Claude Code and Desktop follow it.
  func saveOtherGateway(url: String, key: String) {
    let was = otherGateway
    config.otherURL = url.trimmingCharacters(in: .whitespaces)
    config.otherKey = key.trimmingCharacters(in: .whitespaces)
    guard otherGateway != was else { return saveConfig() }
    saveConfig()
    if (was == nil) != (otherGateway == nil) {
      Task { await startForwarder() }
    } else {
      Task { await refreshModels() }
    }
  }

  /// Reads both model lists (the model API's with the key in use, the other gateway's with its own),
  /// so that requests go where their model is listed, and the settings show it.
  func refreshModels() async {
    guard let g = otherGateway else {
      gatewayModels = GatewayModels()
      applyRoutes()
      return
    }
    let companyKey = forwarderKey ?? activeToken ?? people.first { !$0.key.isEmpty }?.key
    let mineURL = URL(string: config.baseURL.trimmingCharacters(in: .whitespaces)).flatMap(ModelLists.listURL)
    async let mine = Self.ids(mineURL, key: companyKey)
    async let theirs = Self.ids(ModelLists.listURL(g.url), key: g.key)
    let (m, t) = await (mine, theirs)
    // The gateway changed meanwhile: that one's reading counts.
    guard otherGateway == g else { return }
    var next = gatewayModels
    if let m { next.company = m }
    if let t { next.other = t }
    next.error = t == nil ? "读不到其他网关的模型列表 (地址或 key 不对, 或连不上)" : nil
    show(next)
  }

  /// A gateway's model ids; a gateway with no model list (404) lists none; nil if unreadable.
  nonisolated private static func ids(_ url: URL?, key: String?) async -> [String]? {
    guard let url, let r = await ModelLists.get(url, auth: key.map { "Bearer " + $0 }) else { return nil }
    if r.status == 404 { return [] }
    return (200..<300).contains(r.status) ? ModelRoutes.ids(in: r.body) : nil
  }

  /// Both lists as the forwarder read them for a client.
  private func setModels(company: [String], other theirs: [String]) {
    guard otherGateway != nil else { return }
    show(GatewayModels(company: company, other: theirs, error: nil))
  }

  /// The lists go to the forwarder (where requests go) and the settings; models both list are
  /// told once, when they appear.
  private func show(_ m: GatewayModels) {
    let before = gatewayModels.conflicts
    withAnimation(.snappy) { gatewayModels = m }
    applyRoutes()
    if !m.conflicts.isEmpty && m.conflicts != before {
      notice = Notice(text: "两个网关都有: " + m.conflicts.joined(separator: ", ") + ", 用这些模型会报错", bad: true)
    }
  }

  /// Where each model goes: by the lists read, and the mappings set.
  private func applyRoutes() {
    forwarding.routes = ModelRoutes(company: gatewayModels.company ?? [], second: gatewayModels.other ?? [], renames: config.renames)
  }

  /// Saves the model mappings as edited; the forwarder uses them at once.
  func saveModelMap(_ list: [ModelMapping]) {
    guard list != config.modelMap else { return }
    config.modelMap = list
    saveConfig()
    applyRoutes()
  }

  // MARK: - Claude Code's address

  /// The address Claude Code is to use: the forwarder's while it sends the other gateway's models
  /// there, else the model API.
  var cliWant: String {
    if otherGateway != nil, let u = forwarderURL { return u }
    return config.baseURL
  }

  /// One of the addresses this app set up (the model API, its forwarders).
  private func isOurs(_ url: String?) -> Bool {
    (config.ours + [config.baseURL]).contains { ClaudeSettings.sameURL(url, $0) }
  }

  /// After the forwarder started or stopped: Claude Code follows if it is on one of our
  /// addresses (its key stays). Its new sessions use the new address.
  private func syncCLIAddress() {
    guard let f = ClaudeSettings.file(config.settingsPath), let text = try? String(contentsOf: f, encoding: .utf8),
          let token = ClaudeSettings.currentToken(in: text) else { return }
    let now = ClaudeSettings.currentEnv(ClaudeSettings.baseURLKey, in: text)
    let want = cliWant
    guard !ClaudeSettings.sameURL(now, want), isOurs(now) else { return }
    do {
      _ = try ClaudeSettings.switchToken(token, baseURL: want, path: config.settingsPath)
      readSettings()
      let what = want == config.baseURL ? "Claude Code 改回直连模型接口" : "Claude Code 改经本地转发 (\(DesktopLink.short(want)))"
      ForwardLog.write(what)
      notice = Notice(text: what + ", 新会话生效")
    } catch {
      notice = Notice(text: "Claude Code 未改: " + error.localizedDescription, bad: true)
    }
  }

  // MARK: - Claude Desktop

  var desktopRunning: Bool { DesktopApp.running }

  /// Desktop is being relaunched.
  private(set) var restartingDesktop = false

  /// Quits Claude Desktop and opens it again, so that it reads its new configuration.
  func restartDesktop(why: String? = nil) {
    // Clicked again, or asked for twice: the one under way does it.
    guard !restartingDesktop else { return }
    restartingDesktop = true
    notice = Notice(text: "正在重启 Desktop" + (why.map { ": " + $0 } ?? "..."))
    Task {
      defer { restartingDesktop = false }
      switch await DesktopApp.relaunch() {
      case .didNotQuit:
        notice = Notice(text: "Desktop 未退出 (可能在等确认), 请手动重开", bad: true)
      case .notFound:
        notice = Notice(text: "Desktop 已退出, 但找不到它, 请手动打开", bad: true)
      case .done:
        sawDesktop()
        readDesktop()
        notice = Notice(text: "Desktop 已重启, 改动已生效")
      }
    }
  }
}
