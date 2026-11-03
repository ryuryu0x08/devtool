// The people whose usage is shown. Each has one key at a time; keys get rotated. The user only
// ever adds keys: the name comes from the API (nick_name). A new key whose name is already known
// becomes that person's key, in place of the old one.
import Foundation

public struct Person: Codable, Equatable, Identifiable, Sendable {
  public var id: String
  /// The name the API gave, once a reading has told it.
  public var name: String?
  /// The current key; empty when the person's key went to someone else.
  public var key: String
  /// The last successful reading, shown (as such) while the key fails.
  public var lastGood: GoodReading?

  public init(id: String = UUID().uuidString, name: String? = nil, key: String, lastGood: GoodReading? = nil) {
    self.id = id; self.name = name; self.key = key; self.lastGood = lastGood
  }

  /// The name, or else the start of the key.
  public var label: String { name ?? People.shortKey(key) }
}

public struct GoodReading: Codable, Equatable, Sendable {
  public var at: Date
  public var usage: Usage

  public init(at: Date, usage: Usage) { self.at = at; self.usage = usage }
}

public enum People {
  /// How much of a key is shown before its name is known.
  public static let shown = 8

  public static func shortKey(_ key: String) -> String {
    key.count <= shown ? key : String(key.prefix(shown)) + "…"
  }

  public enum Added: Equatable, Sendable {
    case added(id: String)
    /// Someone already has this key.
    case exists(id: String)
    case empty
  }

  /// Adds `key` (spaces and line breaks around it dropped) as a person not yet named.
  public static func add(_ key: String, to people: inout [Person]) -> Added {
    let key = key.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !key.isEmpty else { return .empty }
    if let p = people.first(where: { $0.key == key }) { return .exists(id: p.id) }
    let p = Person(key: key)
    people.append(p)
    return .added(id: p.id)
  }

  public struct Bound: Equatable, Sendable {
    /// The person who now has the key.
    public var id: String
    /// The key that person had before (when the key is new to them).
    public var replaced: String?
    /// The entry the key came from was dropped (it had no name of its own).
    public var merged: String?
  }

  /// The key of person `id` read successfully as `name`: the key is that name's, whoever had it.
  /// - The person was not yet named: they get the name, unless someone already has it; then that
  ///   person gets the key (in place of theirs) and this entry goes.
  /// - The person had another name: the key now belongs to `name` (an existing person, or a new
  ///   one); the person keeps their name, without a key until a new one is added.
  @discardableResult
  public static func bind(id: String, name: String, reading: GoodReading, in people: inout [Person]) -> Bound? {
    guard let i = people.firstIndex(where: { $0.id == id }) else { return nil }
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !name.isEmpty, people[i].name != name else {
      people[i].lastGood = reading
      return Bound(id: id, replaced: nil, merged: nil)
    }
    if let t = people.firstIndex(where: { $0.name == name }) {
      let key = people[i].key
      let old = people[t].key
      people[t].key = key
      people[t].lastGood = reading
      let targetID = people[t].id
      var merged: String?
      if people[i].name == nil {
        merged = people[i].id
        people.remove(at: i)
      } else {
        people[i].key = ""
      }
      return Bound(id: targetID, replaced: old.isEmpty || old == key ? nil : old, merged: merged)
    }
    if people[i].name == nil {
      people[i].name = name
      people[i].lastGood = reading
      return Bound(id: id, replaced: nil, merged: nil)
    }
    let p = Person(name: name, key: people[i].key, lastGood: reading)
    people[i].key = ""
    people.insert(p, at: i + 1)
    return Bound(id: p.id, replaced: nil, merged: nil)
  }
}
