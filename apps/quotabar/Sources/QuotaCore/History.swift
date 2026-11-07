// The readings kept for the charts: one point per key every 5 minutes (the last reading in it),
// for 7 days.
import Foundation

public struct Sample: Codable, Equatable, Sendable {
  public var t: Date
  /// The key's id in the config (not the key itself).
  public var key: String
  public var daily: Double?
  public var over: Double?
  public var pool: Double?

  public init(t: Date, key: String, daily: Double?, over: Double?, pool: Double?) {
    self.t = t; self.key = key; self.daily = daily; self.over = over; self.pool = pool
  }
}

public enum History {
  public static let step: TimeInterval = 5 * 60
  public static let keep: TimeInterval = 7 * 86400

  /// The start of the 5-minute slot `d` falls in.
  public static func slot(_ d: Date) -> Date {
    Date(timeIntervalSince1970: (d.timeIntervalSince1970 / step).rounded(.down) * step)
  }

  /// One point per key and slot (the last reading, timed at the slot's start), within the last
  /// 7 days, oldest first.
  public static func thin(_ h: [Sample], now: Date = Date()) -> [Sample] {
    var by: [String: Sample] = [:]
    for s in h.sorted(by: { $0.t < $1.t }) where s.t > now.addingTimeInterval(-keep) {
      var p = s
      p.t = slot(s.t)
      by[s.key + "@" + String(p.t.timeIntervalSince1970)] = p
    }
    return by.values.sorted { ($0.t, $0.key) < ($1.t, $1.key) }
  }
}

/// A series for a chart, in runs: a line is drawn within a run, not across runs.
public enum Trend {
  public struct Point: Equatable, Sendable {
    public var t: Date
    public var v: Double
    /// The run the point is in (0, 1, …).
    public var run: Int
  }

  /// Splits a series (any order) into runs. A run ends where the value drops (use only grows
  /// through a day, so a drop is the quota coming back) or where nothing was read for longer than
  /// `gap` (the app wasn't running). Returns the points with their runs, and the times the quota
  /// came back (the first reading after each drop).
  public static func runs(_ pts: [(t: Date, v: Double)], gap: TimeInterval) -> (points: [Point], resets: [Date]) {
    var out: [Point] = [], resets: [Date] = []
    var run = 0
    for p in pts.sorted(by: { $0.t < $1.t }) {
      if let last = out.last {
        if dropped(last.v, p.v) {
          run += 1
          resets.append(p.t)
        } else if p.t.timeIntervalSince(last.t) > gap {
          run += 1
        }
      }
      out.append(Point(t: p.t, v: p.v, run: run))
    }
    return (out, resets)
  }

  /// `b` is below `a` by more than rounding.
  static func dropped(_ a: Double, _ b: Double) -> Bool {
    b < a - max(0.01, abs(a) * 0.005)
  }
}
