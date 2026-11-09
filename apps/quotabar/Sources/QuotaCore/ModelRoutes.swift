// Two gateways behind the local forwarder: the company's (the model API set in QuotaBar) and a
// second one. A request goes to the gateway whose model list has the model it asks for (the
// "model" of its JSON body, or the id in GET /v1/models/{id}); anything else goes to the
// company's. A model both list is a conflict: requests for it are turned away with a message,
// since which gateway is meant isn't known. GET /v1/models answers both lists as one.
// A model mapped in the settings (a model Desktop offers, sent on as another, to the gateway
// chosen) comes first: only the body's "model" value changes, every other byte stays.
// Only the rules and the JSON here; the forwarder and the app do the network.
import Foundation

public struct ModelRoutes: Equatable, Sendable {
  /// Models the second gateway lists.
  public private(set) var second: Set<String>
  /// Models both gateways list.
  public private(set) var conflicts: Set<String>
  /// Models sent on as others (by the model asked for).
  public private(set) var renames: [String: Rename]

  /// A model asked for, sent on as `model` to the other gateway (`toOther`) or the company's.
  public struct Rename: Equatable, Sendable {
    public var toOther: Bool
    public var model: String
    public init(toOther: Bool, model: String) {
      self.toOther = toOther
      self.model = model
    }
  }

  public init(company: [String] = [], second: [String] = [], renames: [String: Rename] = [:]) {
    self.second = Set(second)
    conflicts = Set(company).intersection(second)
    self.renames = renames
  }

  public enum Route: Equatable, Sendable {
    case company, second
    /// Both list it.
    case conflict(String)
    /// Mapped: sent on as another model, to the gateway chosen.
    case renamed(Rename)
  }

  /// Where a request for `model` goes (nil: it names none, so the company's gateway).
  public func route(_ model: String?) -> Route {
    guard let model else { return .company }
    if let r = renames[model] { return .renamed(r) }
    if conflicts.contains(model) { return .conflict(model) }
    return second.contains(model) ? .second : .company
  }

  /// The model a request's body asks for: the "model" string of a JSON object; nil otherwise.
  public static func model(in body: Data) -> String? {
    guard !body.isEmpty, let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          let m = o["model"] as? String, !m.isEmpty else { return nil }
    return m
  }

  /// `body` with the "model" member of its top-level object set to `model`: only that string's
  /// bytes change, every other byte (spacing, order, escapes, the rest of the request) stays as it
  /// was. nil when the body isn't a JSON object with a string "model" at its top level.
  public static func renaming(_ body: Data, to model: String) -> Data? {
    let b = [UInt8](body)
    var i = 0
    func space() { while i < b.count, [0x20, 0x09, 0x0A, 0x0D].contains(b[i]) { i += 1 } }
    /// The index of the quote that ends the string starting at `at`.
    func stringEnd(_ at: Int) -> Int? {
      var j = at + 1
      while j < b.count {
        if b[j] == 0x5C { j += 2; continue }
        if b[j] == 0x22 { return j }
        j += 1
      }
      return nil
    }
    /// The index just after the value starting at `at`.
    func valueEnd(_ at: Int) -> Int? {
      guard at < b.count else { return nil }
      switch b[at] {
      case 0x22: return stringEnd(at).map { $0 + 1 }
      case 0x7B, 0x5B:
        var depth = 0, j = at
        while j < b.count {
          switch b[j] {
          case 0x22: guard let e = stringEnd(j) else { return nil }; j = e
          case 0x7B, 0x5B: depth += 1
          case 0x7D, 0x5D:
            depth -= 1
            if depth == 0 { return j + 1 }
          default: break
          }
          j += 1
        }
        return nil
      default:
        var j = at
        while j < b.count, ![0x2C, 0x7D, 0x5D, 0x20, 0x09, 0x0A, 0x0D].contains(b[j]) { j += 1 }
        return j > at ? j : nil
      }
    }
    space()
    guard i < b.count, b[i] == 0x7B else { return nil }
    i += 1
    while true {
      space()
      guard i < b.count, b[i] == 0x22, let keyEnd = stringEnd(i) else { return nil }
      let key = b[(i + 1)..<keyEnd]
      i = keyEnd + 1
      space()
      guard i < b.count, b[i] == 0x3A else { return nil }
      i += 1
      space()
      let start = i
      guard let end = valueEnd(start) else { return nil }
      if Array(key) == Array("model".utf8) {
        guard b[start] == 0x22, let value = try? JSONSerialization.data(withJSONObject: model, options: [.fragmentsAllowed]) else { return nil }
        return Data(b[..<start]) + value + Data(b[end...])
      }
      i = end
      space()
      guard i < b.count, b[i] == 0x2C else { return nil }
      i += 1
    }
  }

  /// The path without its query ("/v1/models" for "/v1/models?limit=1000").
  static func bare(_ path: String) -> String {
    String(path.prefix { $0 != "?" && $0 != "#" })
  }

  /// GET /v1/models (the list), with or without a query.
  public static func isList(_ path: String) -> Bool {
    var p = bare(path)
    while p.hasSuffix("/") { p.removeLast() }
    return p == "/v1/models"
  }

  /// The id in /v1/models/{id}; nil for other paths.
  public static func model(inPath path: String) -> String? {
    let p = bare(path)
    guard p.hasPrefix("/v1/models/") else { return nil }
    let id = String(p.dropFirst("/v1/models/".count))
    guard !id.isEmpty, !id.contains("/") else { return nil }
    return id.removingPercentEncoding ?? id
  }

  /// The ids of a /v1/models reply ({"data": [{"id": …}, …]}); nil if it isn't one.
  public static func ids(in reply: Data) -> [String]? {
    guard let o = try? JSONSerialization.jsonObject(with: reply) as? [String: Any],
          let data = o["data"] as? [[String: Any]] else { return nil }
    return data.compactMap { $0["id"] as? String }
  }

  /// One /v1/models reply of both: the company's entries, then the second's that it doesn't list
  /// (a model both list appears once). nil when `company` isn't a list; a `second` that isn't
  /// one adds nothing.
  public static func merge(company: Data, second: Data?) -> Data? {
    guard let o = try? JSONSerialization.jsonObject(with: company) as? [String: Any],
          let first = o["data"] as? [[String: Any]] else { return nil }
    var seen = Set(first.compactMap { $0["id"] as? String })
    var all = first
    if let second, let s = try? JSONSerialization.jsonObject(with: second) as? [String: Any], let more = s["data"] as? [[String: Any]] {
      for m in more {
        guard let id = m["id"] as? String, !seen.contains(id) else { continue }
        seen.insert(id)
        all.append(m)
      }
    }
    var out = o
    out["data"] = all
    out["has_more"] = false
    out["first_id"] = all.first?["id"] ?? NSNull()
    out["last_id"] = all.last?["id"] ?? NSNull()
    return try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
  }

  /// The error a client gets for a model both gateways list, in the shape Anthropic's clients read.
  public static func conflictReply(_ model: String) -> Data {
    let message = "QuotaBar: 模型 \(model) 在公司网关和其他网关都有, 不知道该发给哪个 (先在其中一个网关去掉它)"
    let o: [String: Any] = ["type": "error", "error": ["type": "invalid_request_error", "message": message]]
    return (try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])) ?? Data(message.utf8)
  }
}
