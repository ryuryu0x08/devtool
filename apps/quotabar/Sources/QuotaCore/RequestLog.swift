// The requests that went through the local forwarder in the last minutes: what was asked, which
// gateway it went to, with whose key, and how it ended. Kept in memory only, for the app's
// request list. Keys are never kept: a name the app gave for one, or its last characters.
import Foundation

public struct RequestRecord: Identifiable, Equatable, Sendable {
  public enum Gateway: String, Sendable {
    /// The company's (the model API).
    case company
    /// The other gateway.
    case other
    /// Both: the model list, read from each.
    case both
    /// Neither: turned away here (a model both list).
    case refused
  }

  public let id: Int
  public let at: Date
  public let method: String
  /// The path, without its query (which can carry a key).
  public let path: String
  public let model: String?
  /// The model it was sent on as (a model mapped in the settings); nil: as asked.
  public let mappedTo: String?
  public let gateway: Gateway
  /// Whose key went with it (a name, or "…" and the key's last 4 characters); nil: none.
  public let key: String?
  /// The reply's status (nil: still under way).
  public internal(set) var status: Int?
  /// From the request taken to the reply's head (ms).
  public internal(set) var ms: Int?
  /// Why it failed here, if it did.
  public internal(set) var note: String?
}

public final class RequestLog: @unchecked Sendable {
  /// How long a request is kept (seconds).
  public let keep: TimeInterval
  /// At most this many are kept, the newest.
  public let limit: Int
  private let lock = NSLock()
  private var records: [RequestRecord] = []
  private var next = 1

  public init(keep: TimeInterval = 600, limit: Int = 1000) {
    self.keep = keep
    self.limit = limit
  }

  /// Records a request taken; its id, for `finish`.
  @discardableResult
  public func add(method: String, path: String, model: String?, mappedTo: String? = nil, gateway: RequestRecord.Gateway, key: String?, note: String? = nil, at: Date = Date()) -> Int {
    lock.lock()
    defer { lock.unlock() }
    let id = next
    next += 1
    let bare = String(path.prefix { $0 != "?" && $0 != "#" })
    var r = RequestRecord(id: id, at: at, method: method, path: bare, model: model, mappedTo: mappedTo, gateway: gateway, key: key)
    r.note = note
    records.append(r)
    prune(at)
    return id
  }

  /// The reply's status came (or it failed here, with `note`).
  public func finish(_ id: Int, status: Int, note: String? = nil, at: Date = Date()) {
    lock.lock()
    defer { lock.unlock() }
    guard let i = records.lastIndex(where: { $0.id == id }), records[i].status == nil else { return }
    records[i].status = status
    records[i].ms = max(0, Int((at.timeIntervalSince(records[i].at) * 1000).rounded()))
    if let note { records[i].note = note }
  }

  /// The requests of the last `keep` seconds, newest first.
  public func recent(now: Date = Date()) -> [RequestRecord] {
    lock.lock()
    defer { lock.unlock() }
    prune(now)
    return records.reversed()
  }

  private func prune(_ now: Date) {
    records.removeAll { now.timeIntervalSince($0.at) > keep }
    if records.count > limit { records.removeFirst(records.count - limit) }
  }

  /// A key as it may be shown: "…" and its last 4 characters.
  public static func mask(_ key: String) -> String {
    "…" + String(key.suffix(4))
  }
}
