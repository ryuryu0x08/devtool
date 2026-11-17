// The saved settings (config.json), and the small types the app's state is made of.
import Foundation
import QuotaCore

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

/// What the menu bar item shows besides its icon: narrower when the menu bar is crowded (macOS
/// hides the items that don't fit, from the left).
enum BarStyle: String, Codable, CaseIterable {
  case full, amount, icon

  var label: String {
    switch self {
    case .full: return "名字和额度"
    case .amount: return "只显示额度"
    case .icon: return "只显示图标"
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
  var barStyle = BarStyle.full
  /// Gateways beside the company's (the model API), in order: the requests for the models one
  /// lists go to the first that lists them (the company's comes before all), with its key. With
  /// one set, Claude Code and Desktop go through the forwarder. Only the company's has a usage API.
  var gateways: [GatewayConfig] = []
  /// Models sent on as others (Desktop offers only the models it knows: one of them can stand
  /// for a model of another gateway).
  var modelMap: [ModelMapping] = []
  /// When the key a request goes with has no quota left (the readings say so, or the company's
  /// gateway answers 403), send it to gateway `fallbackGateway` as `fallbackModel` instead.
  var autoFallback = false
  var fallbackGateway = ""
  var fallbackModel = ""

  /// The mappings filled in, by the model asked for (the first one for a model counts).
  var renames: [String: ModelRoutes.Rename] {
    var out: [String: ModelRoutes.Rename] = [:]
    for m in modelMap where m.complete && out[m.from.trimmingCharacters(in: .whitespaces)] == nil {
      out[m.from.trimmingCharacters(in: .whitespaces)] = ModelRoutes.Rename(gateway: m.gateway, model: m.to.trimmingCharacters(in: .whitespaces))
    }
    return out
  }

  static var detectedClaudeDir: String {
    ProcessInfo.processInfo.environment["CLAUDE_CONFIG_DIR"].flatMap { $0.isEmpty ? nil : $0 } ?? "~/.claude"
  }
  static let detectedDesktopDir = "~/Library/Application Support/Claude-3p"

  var settingsPath: String { ((claudeDir.isEmpty ? Config.detectedClaudeDir : claudeDir) as NSString).appendingPathComponent("settings.json") }
  var desktopRoot: String { desktopDir.isEmpty ? Config.detectedDesktopDir : desktopDir }
  var desktopLibrary: String { ((desktopDir.isEmpty ? Config.detectedDesktopDir : desktopDir) as NSString).appendingPathComponent("configLibrary") }

  init() {}

  private enum CodingKeys: String, CodingKey {
    case url, interval, people, retired, settingsPath, claudeDir, desktopDir, baseURL, desktopRestart, forward, forwardPort, ours, desktopPrevious, swapKeys, desktopPerson, cookieSync, cookieBrowser, cookieURL, barStyle, otherURL, otherKey, gateways, modelMap, autoFallback, fallbackGateway, fallbackModel, keys
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
    barStyle = (try? c.decodeIfPresent(BarStyle.self, forKey: .barStyle)) ?? .full
    if let g = try? c.decodeIfPresent([GatewayConfig].self, forKey: .gateways) {
      gateways = g
    } else {
      // Earlier versions had one other gateway: it becomes the first, with the id the mappings
      // and the fallback of those versions meant (GatewayConfig.firstID).
      let u = try c.decodeIfPresent(String.self, forKey: .otherURL) ?? "", k = try c.decodeIfPresent(String.self, forKey: .otherKey) ?? ""
      if !u.isEmpty || !k.isEmpty { gateways = [GatewayConfig(id: GatewayConfig.firstID, name: "其他网关", url: u, key: k)] }
    }
    modelMap = (try? c.decodeIfPresent([ModelMapping].self, forKey: .modelMap)) ?? []
    autoFallback = try c.decodeIfPresent(Bool.self, forKey: .autoFallback) ?? false
    fallbackGateway = try c.decodeIfPresent(String.self, forKey: .fallbackGateway) ?? GatewayConfig.firstID
    fallbackModel = try c.decodeIfPresent(String.self, forKey: .fallbackModel) ?? ""
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
    try c.encode(barStyle, forKey: .barStyle)
    try c.encode(gateways, forKey: .gateways)
    try c.encode(modelMap, forKey: .modelMap)
    try c.encode(autoFallback, forKey: .autoFallback)
    try c.encode(fallbackGateway, forKey: .fallbackGateway)
    try c.encode(fallbackModel, forKey: .fallbackModel)
    try c.encode(baseURL, forKey: .baseURL)
    try c.encode(desktopRestart, forKey: .desktopRestart)
  }
}

/// A gateway besides the company's: its name, address, key (sent as Bearer), and models typed in
/// for it (for a gateway whose model list can't be read, or leaves some out).
struct GatewayConfig: Codable, Equatable, Identifiable {
  /// The id the one other gateway of earlier versions gets.
  static let firstID = "other"

  var id = UUID().uuidString
  var name = ""
  var url = ""
  var key = ""
  /// Typed in: names separated by commas, spaces or new lines.
  var models = ""

  /// Its name, or a stand-in while it has none.
  var label: String {
    let n = name.trimmingCharacters(in: .whitespaces)
    return n.isEmpty ? (URL(string: url)?.host ?? "未命名网关") : n
  }

  /// The models typed in, each once.
  var typedModels: [String] {
    var seen = Set<String>()
    return models.split(whereSeparator: { $0 == "," || $0 == "，" || $0.isWhitespace }).map(String.init).filter { seen.insert($0).inserted }
  }

  init(id: String = UUID().uuidString, name: String = "", url: String = "", key: String = "", models: String = "") {
    self.id = id
    self.name = name
    self.url = url
    self.key = key
    self.models = models
  }

  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
    name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
    url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
    key = try c.decodeIfPresent(String.self, forKey: .key) ?? ""
    models = try c.decodeIfPresent(String.self, forKey: .models) ?? ""
  }
}

/// A model Desktop (or Claude Code) asks for, sent on as `to`, to gateway `gateway` (nil: the
/// company's).
struct ModelMapping: Codable, Equatable, Identifiable {
  var id = UUID().uuidString
  var from = ""
  var gateway: String? = GatewayConfig.firstID
  var to = ""

  /// Both names filled in, and different: in use.
  var complete: Bool {
    let f = from.trimmingCharacters(in: .whitespaces), t = to.trimmingCharacters(in: .whitespaces)
    return !f.isEmpty && !t.isEmpty && f != t
  }

  init() {}

  private enum CodingKeys: String, CodingKey { case id, from, gateway, toOther, to }

  init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self)
    id = try c.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
    from = try c.decodeIfPresent(String.self, forKey: .from) ?? ""
    to = try c.decodeIfPresent(String.self, forKey: .to) ?? ""
    if c.contains(.gateway) {
      gateway = try c.decodeIfPresent(String.self, forKey: .gateway)
    } else {
      // Earlier versions: the other gateway, or the company's.
      gateway = (try c.decodeIfPresent(Bool.self, forKey: .toOther) ?? true) ? GatewayConfig.firstID : nil
    }
  }

  func encode(to e: Encoder) throws {
    var c = e.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(from, forKey: .from)
    // Written even when nil (the company's), so that it isn't read as an earlier version's.
    try c.encode(gateway, forKey: .gateway)
    try c.encode(to, forKey: .to)
  }
}

/// The gateways' models as last read: what the settings show.
struct GatewayModels: Equatable {
  /// The company's models (nil: not read yet, or it couldn't be).
  var company: [String]?
  /// Each other gateway's, by its id, as read with the ones typed in (absent: not read yet).
  var lists: [String: [String]] = [:]
  /// Why a gateway's list couldn't be read, by its id.
  var errors: [String: String] = [:]
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
    case .keyRejected: return "key 失效 (可能已轮换), 粘贴新 key"
    case .server: return "接口出错, 稍后重试"
    case .network: return "连不上接口, 稍后重试"
    }
  }
}
