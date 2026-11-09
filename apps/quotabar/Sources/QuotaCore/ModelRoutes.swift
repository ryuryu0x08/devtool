// Two gateways behind the local forwarder: the company's (the model API set in QuotaBar) and a
// second one. A request goes to the gateway whose model list has the model it asks for (the
// "model" of its JSON body, or the id in GET /v1/models/{id}); anything else goes to the
// company's. A model both list is a conflict: requests for it are turned away with a message,
// since which gateway is meant isn't known. GET /v1/models answers both lists as one.
// Only the rules and the JSON here; the forwarder and the app do the network.
import Foundation

public struct ModelRoutes: Equatable, Sendable {
  /// Models the second gateway lists.
  public private(set) var second: Set<String>
  /// Models both gateways list.
  public private(set) var conflicts: Set<String>

  public init(company: [String] = [], second: [String] = []) {
    self.second = Set(second)
    conflicts = Set(company).intersection(second)
  }

  public enum Route: Equatable, Sendable {
    case company, second
    /// Both list it.
    case conflict(String)
  }

  /// Where a request for `model` goes (nil: it names none, so the company's gateway).
  public func route(_ model: String?) -> Route {
    guard let model else { return .company }
    if conflicts.contains(model) { return .conflict(model) }
    return second.contains(model) ? .second : .company
  }

  /// The model a request's body asks for: the "model" string of a JSON object; nil otherwise.
  public static func model(in body: Data) -> String? {
    guard !body.isEmpty, let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
          let m = o["model"] as? String, !m.isEmpty else { return nil }
    return m
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
