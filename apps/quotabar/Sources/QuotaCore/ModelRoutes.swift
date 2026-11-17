// Gateways behind the local forwarder: the company's (the model API set in QuotaBar) and others,
// in an order. A request goes to the first gateway whose model list has the model it asks for (the
// "model" of its JSON body, or the id in GET /v1/models/{id}): the company's first, then the others
// in their order; anything else goes to the company's. A model a later gateway also lists stays
// with the earlier one (the settings show which). GET /v1/models answers all the lists as one.
// A model mapped in the settings (a model Desktop offers, sent on as another, to the gateway
// chosen) comes first: only the body's "model" value changes, every other byte stays.
// Only the rules and the JSON here; the forwarder and the app do the network.
import Foundation

public struct ModelRoutes: Equatable, Sendable {
  /// A gateway besides the company's and the models it lists.
  public struct Listed: Equatable, Sendable {
    public var id: String
    public var models: [String]
    public init(id: String, models: [String]) {
      self.id = id
      self.models = models
    }
  }

  /// The company's models.
  public private(set) var company: Set<String>
  /// The other gateways' lists, in their order.
  public private(set) var lists: [Listed]
  /// Each model to the gateway it goes to (the first that lists it); the company's aren't here.
  private var owner: [String: String]
  /// Models sent on as others (by the model asked for).
  public private(set) var renames: [String: Rename]

  /// A model asked for, sent on as `model` to gateway `gateway` (nil: the company's).
  public struct Rename: Equatable, Sendable {
    public var gateway: String?
    public var model: String
    public init(gateway: String?, model: String) {
      self.gateway = gateway
      self.model = model
    }
  }

  public init(company: [String] = [], lists: [Listed] = [], renames: [String: Rename] = [:]) {
    self.company = Set(company)
    self.lists = lists
    self.renames = renames
    var owner: [String: String] = [:]
    for l in lists {
      for m in l.models where !self.company.contains(m) && owner[m] == nil { owner[m] = l.id }
    }
    self.owner = owner
  }

  public enum Route: Equatable, Sendable {
    case company
    /// The gateway with this id.
    case gateway(String)
    /// Mapped: sent on as another model, to the gateway chosen.
    case renamed(Rename)
  }

  /// Where a request for `model` goes (nil: it names none, so the company's gateway).
  public func route(_ model: String?) -> Route {
    guard let model else { return .company }
    if let r = renames[model] { return .renamed(r) }
    return owner[model].map { .gateway($0) } ?? .company
  }

  /// The models gateway `id` was last read to list (nil: not read).
  public func models(of id: String) -> [String]? {
    lists.first { $0.id == id }?.models
  }

  /// The models gateway `id` lists that go elsewhere: a gateway before it (or the company's) lists them too.
  public func taken(from id: String) -> [String] {
    (models(of: id) ?? []).filter { owner[$0] != id }
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

  /// POST /v1/messages (a conversation's turn; not count_tokens), with or without a query.
  public static func isMessages(_ path: String) -> Bool {
    var p = bare(path)
    while p.hasSuffix("/") { p.removeLast() }
    return p == "/v1/messages"
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

  /// One /v1/models reply of all: the company's entries, then each other's that no list before it
  /// has (a model several list appears once). nil when `company` isn't a list; one of `others`
  /// that isn't (or is nil) adds nothing.
  public static func merge(company: Data, others: [Data?]) -> Data? {
    guard let o = try? JSONSerialization.jsonObject(with: company) as? [String: Any],
          let first = o["data"] as? [[String: Any]] else { return nil }
    var seen = Set(first.compactMap { $0["id"] as? String })
    var all = first
    for other in others {
      guard let other, let s = try? JSONSerialization.jsonObject(with: other) as? [String: Any], let more = s["data"] as? [[String: Any]] else { continue }
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

  /// A gateway's list with `extra` models (typed in the settings, for a gateway whose list can't
  /// be read or leaves some out) added after its own; with no list read, the extra ones alone.
  /// nil when there is neither.
  public static func adding(_ extra: [String], to list: Data?) -> Data? {
    var o: [String: Any] = [:]
    var data: [[String: Any]] = []
    if let list, let l = try? JSONSerialization.jsonObject(with: list) as? [String: Any], let d = l["data"] as? [[String: Any]] {
      o = l
      data = d
    } else if extra.isEmpty {
      return nil
    }
    let have = Set(data.compactMap { $0["id"] as? String })
    var added = Set<String>()
    for m in extra where !have.contains(m) && added.insert(m).inserted {
      data.append(["id": m, "type": "model", "display_name": m])
    }
    o["data"] = data
    return try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])
  }
}
