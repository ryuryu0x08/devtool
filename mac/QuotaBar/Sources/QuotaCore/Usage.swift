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

/// One key's reading: the numbers, or why there are none. `title` is the account's nick_name.
public enum UsageReply: Equatable, Sendable {
  case ok(Usage, title: String?)
  case failed(String, title: String?)

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
      return .failed("HTTP \(status): " + (text.isEmpty ? "(empty)" : text), title: nil)
    }
    let obj = json as? [String: Any]
    let message = obj?["message"] as? String
    let data = obj?["data"] as? [String: Any]
    let title = data?["nick_name"] as? String
    guard (200..<300).contains(status) else {
      return .failed("HTTP \(status)" + (message.map { ": " + $0 } ?? ""), title: title)
    }
    guard number(obj?["code"]) == 0, let data, isTrue(data["valid"]) else {
      return .failed(message ?? "返回不是成功", title: title)
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
