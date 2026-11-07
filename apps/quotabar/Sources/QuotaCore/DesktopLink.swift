// How Claude Desktop and the local forwarder go together: which address Desktop is to have, which
// key the forwarder sends, whether a change reaches the running Desktop at once, and why it is
// made. Only the rules, from what is known now (no files, no processes): QuotaBar reads the
// state, asks this, and writes what it says.
import Foundation

public struct DesktopLink: Equatable, Sendable {
  /// Desktop's configuration now.
  public var desktop: ClaudeDesktop.Status
  /// The running forwarder's address (nil: it doesn't run).
  public var forwarder: String?
  /// The model API.
  public var baseURL: String
  /// Addresses this app gave Desktop (earlier forwarders, model APIs): replaced without asking.
  public var ours: [String]
  /// The forwarder sends the chosen person's key (`chosenKey`), whatever Desktop sends.
  public var swapKeys: Bool
  public var chosenKey: String?
  /// The running Desktop was opened before its address was last changed: it still uses the old one.
  public var desktopOnOldAddress: Bool

  public init(desktop: ClaudeDesktop.Status, forwarder: String?, baseURL: String, ours: [String], swapKeys: Bool, chosenKey: String?, desktopOnOldAddress: Bool) {
    self.desktop = desktop
    self.forwarder = forwarder
    self.baseURL = baseURL
    self.ours = ours
    self.swapKeys = swapKeys
    self.chosenKey = chosenKey
    self.desktopOnOldAddress = desktopOnOldAddress
  }

  /// A change to make in Desktop's configuration.
  public struct Change: Equatable, Sendable {
    /// The new address (nil: it stays).
    public var url: String?
    /// The new key (nil: it stays).
    public var key: String?
    /// What changed and why, in a few words (for the message and the restart question).
    public var why: String
    /// The running Desktop gets it at once (only the key changed, and Desktop goes through the
    /// forwarder, which sends the configured key): no restart.
    public var live: Bool
  }

  /// The address Desktop is to use: the forwarder's while it runs, else the model API.
  public var want: String { forwarder ?? baseURL }

  /// Desktop's configured address, when it is on a gateway.
  public var desktopURL: String? {
    if case .gateway(_, let u) = desktop { return u }
    return nil
  }

  /// The key the forwarder sends in place of Desktop's: the chosen person's when swapping keys;
  /// otherwise the one in Desktop's configuration, which a Desktop opened earlier may not have
  /// read yet (so a key written there works at once). nil: Desktop's own goes on (a sealed key
  /// can't be read here).
  public var forwarderKey: String? {
    if swapKeys { return chosenKey.flatMap { $0.isEmpty ? nil : $0 } }
    if case .gateway(let k?, _) = desktop { return k }
    return nil
  }

  /// The running Desktop goes through the running forwarder: the key it sends reaches Desktop at once.
  public var throughForwarder: Bool {
    guard let forwarder, case .gateway(_, let cur) = desktop else { return false }
    return ClaudeSettings.sameURL(cur, forwarder) && !desktopOnOldAddress
  }

  /// Desktop is configured on the forwarder, and the forwarder swaps the keys: switching the
  /// person changes it there only.
  public var swapping: Bool {
    guard swapKeys, let forwarder, case .gateway(_, let cur) = desktop else { return false }
    return ClaudeSettings.sameURL(cur, forwarder)
  }

  /// Desktop is on a gateway but not on the running forwarder (an address set elsewhere): that
  /// address, to show it; nil otherwise.
  public static func offForwarder(forwarder: String?, desktop: ClaudeDesktop.Mode) -> String? {
    guard let forwarder, case .gateway(let cur) = desktop, !ClaudeSettings.sameURL(cur, forwarder) else { return nil }
    return cur ?? "未设置"
  }

  /// After the forwarder started, moved or stopped: Desktop follows if it is on one of our
  /// addresses. `key`: to be written too (the key that was swapped in, when swapping was turned
  /// off; `owner` its person's name). `taken`: the port the forwarder wanted, held by another
  /// program. `failed`: it stopped because it couldn't start. nil: nothing to change.
  public func afterForwarder(key: String? = nil, owner: String? = nil, taken: UInt16? = nil, failed: Bool = false) -> Change? {
    guard case .gateway(let curKey, let current) = desktop else { return nil }
    let move = DesktopURL.change(current: current, want: want, ours: ours + [baseURL]) == .replace
    let newKey = key.flatMap { $0.isEmpty || $0 == curKey ? nil : $0 }
    guard move || newKey != nil else { return nil }
    var why: [String] = []
    if move {
      if forwarder != nil {
        if let taken { why.append("端口 \(taken) 被其他程序占用, 本地转发改用 \(Self.short(want))") }
        else if Self.isLocal(current) { why.append("本地转发的地址改为 \(Self.short(want))") }
        else { why.append("Desktop 改经本地转发 (\(Self.short(want))) 访问模型接口") }
      } else {
        why.append((failed ? "本地转发没能启动" : "本地转发已关闭") + ", Desktop 改回直连模型接口 (\(want))")
      }
    }
    if newKey != nil {
      why.append("免重启切换已关闭, Desktop 改用配置里" + (owner.map { " \"\($0)\" 的" } ?? "的") + " key")
    }
    return Change(url: move ? want : nil, key: newKey, why: why.joined(separator: "; "), live: !move && throughForwarder)
  }

  /// Desktop onto the running forwarder (asked for in the settings); nil: it is there already,
  /// or there is no forwarder or gateway.
  public func toForwarder() -> Change? {
    guard let forwarder, case .gateway(_, let cur) = desktop, !ClaudeSettings.sameURL(cur, forwarder) else { return nil }
    return Change(url: forwarder, key: nil, why: "Desktop 改经本地转发 (\(Self.short(forwarder))) 访问模型接口", live: false)
  }

  /// A new key written to Desktop's configuration (and no new address) reaches it at once.
  public var keyChangeIsLive: Bool { throughForwarder }

  /// "127.0.0.1:47831" for "http://127.0.0.1:47831".
  public static func short(_ url: String) -> String {
    url.hasPrefix("http://") ? String(url.dropFirst("http://".count)) : url
  }

  static func isLocal(_ url: String?) -> Bool {
    guard let h = url.flatMap({ URL(string: $0.trimmingCharacters(in: .whitespaces)) })?.host?.lowercased() else { return false }
    return ["127.0.0.1", "localhost", "::1", "[::1]"].contains(h)
  }
}

/// Desktop's configuration as one Desktop read it (at its launch), or as it is now: what is
/// compared to tell whether the running Desktop has what is configured.
public struct DesktopSeen: Codable, Equatable, Sendable {
  public enum Mode: String, Codable, Sendable { case gateway, signIn, managed }
  public var mode: Mode
  public var url: String?
  /// nil: sealed (unreadable here) or none.
  public var key: String?

  public init(mode: Mode, url: String?, key: String?) {
    self.mode = mode
    self.url = url
    self.key = key
  }

  public init(mode: ClaudeDesktop.Mode, status: ClaudeDesktop.Status) {
    switch mode {
    case .managed: self.init(mode: .managed, url: nil, key: nil)
    case .signIn: self.init(mode: .signIn, url: nil, key: nil)
    case .gateway(let u):
      if case .gateway(let k, _) = status { self.init(mode: .gateway, url: u, key: k) } else { self.init(mode: .gateway, url: u, key: nil) }
    }
  }

  /// Corrected by what Desktop was seen doing: its requests reach the forwarder at `url`, so it
  /// is on the gateway at that address, whatever was thought it read. (Its key isn't taken from
  /// them: through the forwarder the key doesn't count.)
  public func heard(on url: String) -> DesktopSeen {
    DesktopSeen(mode: .gateway, url: url, key: mode == .gateway ? key : nil)
  }

  /// What a Desktop that read `self` lacks of the configuration `now`, in a few words each;
  /// empty: it has it all (it needs no restart). `forwarder`: the running forwarder's address:
  /// a Desktop going through it gets the configured key from it, so the key doesn't count then.
  /// `name`: whose a key is.
  public func lacks(_ now: DesktopSeen, forwarder: String?, name: (String) -> String? = { _ in nil }) -> [String] {
    if mode != now.mode {
      switch now.mode {
      case .gateway: return ["启动方式改为第三方网关"]
      case .signIn: return ["启动方式改为官方登录"]
      case .managed: return []
      }
    }
    guard now.mode == .gateway else { return [] }
    var out: [String] = []
    let sameURL = (url ?? "").isEmpty && (now.url ?? "").isEmpty || ClaudeSettings.sameURL(url, now.url)
    if !sameURL {
      if let f = forwarder, ClaudeSettings.sameURL(now.url, f) {
        out.append("改经本地转发 (\(DesktopLink.short(f)))")
      } else if let u = now.url, !u.isEmpty {
        out.append((DesktopLink.isLocal(url) ? "改回直连 " : "地址改为 ") + u)
      } else {
        out.append("地址已清空")
      }
    }
    let viaForwarder = forwarder.map { ClaudeSettings.sameURL(url, $0) } ?? false
    if !viaForwarder, let a = key, let b = now.key, a != b {
      out.append("key 改为 " + (name(b).map { "\"\($0)\"" } ?? "新 key"))
    }
    return out
  }
}
