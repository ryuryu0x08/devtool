// What a key can still use today. daily_usage is the whole day's use (overflow included). Once
// the daily limit is used up, the key draws on the overflow, which comes out of the shared pool:
// so the overflow it can still use is capped both by its own overflow limit and by what the pool
// has left (the API's overflow_available; else worked out from the pool). The daily quota itself
// doesn't come out of the pool.
import Foundation

public struct KeyState: Equatable, Sendable {
  public enum Kind: Sendable { case withinDaily, onOverflow, out }

  public var kind: Kind
  /// Left of today's quota.
  public var dailyLeft: Double
  /// Left of the key's own overflow limit.
  public var overRoom: Double
  /// The overflow the key can actually still use (overRoom, capped by the pool).
  public var overAvail: Double
  /// What the key can still use today: dailyLeft + overAvail.
  public var left: Double
  /// The pool, not the key's own overflow limit, is what limits the overflow.
  public var poolCaps: Bool

  public init(_ q: Usage) {
    dailyLeft = max(0, (q.dailyLimit ?? 0) - (q.daily ?? 0))
    overRoom = max(0, (q.overLimit ?? 0) - (q.over ?? 0))
    let poolLeft = (q.poolLimit ?? 0) > 0 ? max(0, q.poolLimit! - (q.pool ?? 0)) : .infinity
    overAvail = min(overRoom, q.overAvail ?? poolLeft, poolLeft)
    poolCaps = overAvail < overRoom
    left = dailyLeft + overAvail
    kind = dailyLeft > 0 ? .withinDaily : overAvail > 0 ? .onOverflow : .out
  }

  /// A word for the state.
  public var chip: String {
    switch kind {
    case .withinDaily: return "今日额度内"
    case .onOverflow: return "正在用超额"
    case .out: return overRoom > 0 ? "共用池已满" : "超额已用完"
    }
  }

  /// How `left` is made up.
  public var parts: String {
    "今日剩 \(Fmt.num(dailyLeft)) + 超额 \(Fmt.num(overAvail))"
      + (poolCaps ? "（池子限制，原 \(Fmt.num(overRoom))）" : "")
  }
}

public enum Fmt {
  /// 1234 → "1234", 12.3456 → "12.35", 12.5 → "12.5", nil → "—".
  public static func num(_ n: Double?) -> String {
    guard let n, n.isFinite else { return "—" }
    if abs(n) >= 1000 { return String(format: "%.0f", n) }
    var s = String(format: "%.2f", n)
    while s.hasSuffix("0") { s.removeLast() }
    if s.hasSuffix(".") { s.removeLast() }
    return s == "-0" ? "0" : s
  }

  /// used / limit as a percentage (0 when there is no limit).
  public static func pct(_ used: Double?, _ limit: Double?) -> Double {
    guard let limit, limit > 0 else { return 0 }
    return (used ?? 0) / limit * 100
  }
}
