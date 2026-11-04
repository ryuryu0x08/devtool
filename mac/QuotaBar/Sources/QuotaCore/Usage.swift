// The usage API: one GET per key, with the key as a Bearer token. A successful reply is
// {"code": 0, "data": {"valid": true, "nick_name": …, "daily_usage": …, …}}.
import Foundation

/// The numbers the app uses from one reply. A number the reply leaves out (or that isn't a
/// number) is nil.
public struct Usage: Equatable, Codable, Sendable {
  /// Today's use, overflow included.
  public var daily: Double?
  public var dailyLimit: Double?
  /// The part of today's use beyond the daily limit, drawn from the shared pool.
  public var over: Double?
  public var overLimit: Double?
  /// What the API says the key can still draw as overflow (nil when it doesn't say).
  public var overAvail: Double?
  /// The shared pool, the same for every key.
  public var pool: Double?
  public var poolLimit: Double?

  public init(daily: Double? = nil, dailyLimit: Double? = nil, over: Double? = nil, overLimit: Double? = nil,
              overAvail: Double? = nil, pool: Double? = nil, poolLimit: Double? = nil) {
    self.daily = daily; self.dailyLimit = dailyLimit; self.over = over; self.overLimit = overLimit
    self.overAvail = overAvail; self.pool = pool; self.poolLimit = poolLimit
  }
}

/// Why a reading failed, and the details (HTTP status, the API's message, the system's error).
public struct Failure: Error, Equatable, Codable, Sendable {
  public enum Kind: String, Codable, Sendable {
    /// The API turned the key down: it was rotated, or stopped.
    case keyRejected
    /// The API answered, but with an error or something that isn't its usual reply.
    case server
    /// The API couldn't be reached.
    case network
  }

  public var kind: Kind
  public var detail: String

  public init(_ kind: Kind, _ detail: String) { self.kind = kind; self.detail = detail }

  /// How long the API may be unreachable (or erring) before the menu bar shows "!", while there
  /// is a reading to show: a failed reading is tried again within 15 s, and most pass then.
  public static let barGrace: TimeInterval = 120

  /// Worth the "!" in the menu bar: the key was turned down, there is nothing else to show, or
  /// the failing has gone on for `barGrace`.
  public func worthBar(hasReading: Bool, failingFor: TimeInterval) -> Bool {
    kind == .keyRejected || !hasReading || failingFor >= Self.barGrace
  }
}

/// One key's reading: the numbers, or why there are none. `title` is the account's nick_name.
public enum UsageReply: Equatable, Sendable {
  case ok(Usage, title: String?)
  case failed(Failure, title: String?)

  public var title: String? {
    switch self { case .ok(_, let t), .failed(_, let t): return t }
  }
}

public enum UsageAPI {
  public static func request(url: URL, key: String) -> URLRequest {
    var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
    r.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
    r.setValue("application/json", forHTTPHeaderField: "Accept")
    return r
  }

  /// Reads a reply: its HTTP status and body.
  public static func parse(status: Int, body: Data) -> UsageReply {
    guard let json = try? JSONSerialization.jsonObject(with: body, options: [.fragmentsAllowed]) else {
      let text = String(decoding: body.prefix(120), as: UTF8.self)
      return .failed(Failure(.server, "HTTP \(status): " + (text.isEmpty ? "(empty)" : text)), title: nil)
    }
    let obj = json as? [String: Any]
    let message = obj?["message"] as? String
    let data = obj?["data"] as? [String: Any]
    let title = data?["nick_name"] as? String
    guard (200..<300).contains(status) else {
      let kind: Failure.Kind = status == 401 || status == 403 ? .keyRejected : .server
      return .failed(Failure(kind, "HTTP \(status)" + (message.map { ": " + $0 } ?? "")), title: title)
    }
    guard number(obj?["code"]) == 0, let data, isTrue(data["valid"]) else {
      return .failed(Failure(.keyRejected, message ?? "返回不是成功"), title: title)
    }
    return .ok(pick(data), title: title)
  }

  static func pick(_ d: [String: Any]) -> Usage {
    Usage(daily: number(d["daily_usage"]), dailyLimit: number(d["daily_limit"]),
          over: number(d["overflow_usage"]), overLimit: number(d["overflow_limit"]),
          overAvail: number(d["overflow_available"]),
          pool: number(d["pool_usage"]), poolLimit: number(d["pool_limit"]))
  }

  /// A JSON number (not true/false, which JSONSerialization also gives as NSNumber), if finite.
  static func number(_ v: Any?) -> Double? {
    guard let n = v as? NSNumber, !isBool(n) else { return nil }
    let d = n.doubleValue
    return d.isFinite ? d : nil
  }

  static func isTrue(_ v: Any?) -> Bool {
    guard let n = v as? NSNumber, isBool(n) else { return false }
    return n.boolValue
  }

  static func isBool(_ n: NSNumber) -> Bool {
    CFGetTypeID(n) == CFBooleanGetTypeID()
  }
}

/// The usage portal's proxy-usage endpoint, reached with the browser's own cookies: it answers
/// with the signed-in person's current token, which rotates. Same number fields as UsageAPI,
/// plus "nickname" and "token".
public struct ProxyUsage: Equatable, Sendable {
  public var nickname: String?
  public var token: String?
  public var usage: Usage
  public init(nickname: String?, token: String?, usage: Usage) {
    self.nickname = nickname; self.token = token; self.usage = usage
  }
}

public enum ProxyUsageAPI {
  public static let defaultURL = "https://ai-coding.bilibili.co/ai-coding/user/proxy-usage"

  public static func request(url: URL, cookie: String) -> URLRequest {
    var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
    r.setValue(cookie, forHTTPHeaderField: "Cookie")
    r.setValue("application/json", forHTTPHeaderField: "Accept")
    r.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36", forHTTPHeaderField: "User-Agent")
    if let base = url.host.map({ (url.scheme ?? "https") + "://" + $0 }) {
      r.setValue(base + "/coding", forHTTPHeaderField: "Referer")
    }
    return r
  }

  public static func parse(status: Int, body: Data) -> Result<ProxyUsage, Failure> {
    guard let json = try? JSONSerialization.jsonObject(with: body, options: [.fragmentsAllowed]) else {
      let text = String(decoding: body.prefix(120), as: UTF8.self)
      return .failure(Failure(.server, "HTTP \(status): " + (text.isEmpty ? "(empty)" : text)))
    }
    let obj = json as? [String: Any]
    let message = obj?["message"] as? String
    let data = obj?["data"] as? [String: Any]
    guard (200..<300).contains(status) else {
      // The portal answers 200 with a redirect page when the cookie is stale; a 401/403 too.
      let kind: Failure.Kind = status == 401 || status == 403 ? .keyRejected : .server
      return .failure(Failure(kind, "HTTP \(status)" + (message.map { ": " + $0 } ?? "")))
    }
    guard UsageAPI.number(obj?["code"]) == 0, let data, UsageAPI.isTrue(data["success"]) else {
      return .failure(Failure(.keyRejected, message?.isEmpty == false ? message! : "未登录或 cookie 失效"))
    }
    let nick = (data["nickname"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    let token = (data["token"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    return .success(ProxyUsage(nickname: nick, token: token, usage: UsageAPI.pick(data)))
  }
}
