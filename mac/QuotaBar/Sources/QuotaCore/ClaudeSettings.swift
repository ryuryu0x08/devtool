// Switching the key Claude Code uses: env.ANTHROPIC_AUTH_TOKEN in ~/.claude/settings.json is set
// to the key and env.ANTHROPIC_API_KEY (which would compete with it) is removed. Everything else
// in the file stays exactly as written: the change is made in the text, at the places the two
// entries are, and the result is checked against the original before it is written.
import Foundation

public enum SettingsError: Error, Equatable, LocalizedError {
  case notUTF8
  case notJSON(String)
  case rootNotObject
  case envNotObject
  /// The edit would have changed something besides the two entries (never expected).
  case verifyFailed

  public var errorDescription: String? {
    switch self {
    case .notUTF8: return "settings.json 不是 UTF-8 文本，没有修改。"
    case .notJSON(let why): return "settings.json 不是有效的 JSON，没有修改：\(why)"
    case .rootNotObject: return "settings.json 的最外层不是 { … } 对象，没有修改。"
    case .envNotObject: return "settings.json 里的 \"env\" 不是 { … } 对象，没有修改。"
    case .verifyFailed: return "修改后的内容校验不通过（会改动其他配置），没有修改。"
    }
  }
}

public enum ClaudeSettings {
  public static let tokenKey = "ANTHROPIC_AUTH_TOKEN"
  public static let apiKeyKey = "ANTHROPIC_API_KEY"
  public static let defaultPath = "~/.claude/settings.json"

  /// The env.ANTHROPIC_AUTH_TOKEN the file sets, if any.
  public static func currentToken(in text: String) -> String? {
    guard let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else { return nil }
    return (obj["env"] as? [String: Any])?[tokenKey] as? String
  }

  /// The file also has an apiKeyHelper, which Claude Code may use instead of the token.
  public static func hasApiKeyHelper(in text: String) -> Bool {
    guard let obj = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else { return false }
    return obj["apiKeyHelper"] != nil
  }

  /// `text` with env.ANTHROPIC_AUTH_TOKEN set to `token` and env.ANTHROPIC_API_KEY removed;
  /// everything else byte for byte as it was. Empty text (a file not there yet) is taken as {}.
  public static func setToken(_ token: String, in text: String) throws -> String {
    let empty = text.allSatisfy(\.isWhitespace)
    let original = empty ? "{}" : text
    let old = try parse(original)
    if let env = old["env"], !(env is [String: Any]) { throw SettingsError.envNotObject }

    var b = Array(original.utf8)
    let tok = Array(jsonString(token).utf8)

    // 1. Set the token: in place where it is, else as a new entry of env, else a new env.
    let root = try Scanner(b).root()
    if let env = root.members.last(where: { $0.key == "env" }) {
      guard b[env.valueStart] == UInt8(ascii: "{") else { throw SettingsError.envNotObject }
      let obj = try Scanner(b).object(at: env.valueStart, depth: 1)
      let hits = obj.members.filter { $0.key == tokenKey }
      if hits.isEmpty {
        b = insert(member: Array(jsonString(tokenKey).utf8) + Array(": ".utf8) + tok, into: obj, b)
      } else {
        for m in hits.reversed() { b.replaceSubrange(m.valueStart..<m.valueEnd, with: tok) }
      }
    } else {
      let multiline = root.members.isEmpty || hasNewline(b, root.open, root.members[0].keyStart)
      let inner = root.members.isEmpty ? lineIndent(b, root.open) + unit(b, root) : lineIndent(b, root.members.last!.keyStart)
      let entry = Array(jsonString(tokenKey).utf8) + Array(": ".utf8) + tok
      let env: [UInt8] = multiline
        ? Array("\"env\": {\n".utf8) + inner + unit(b, root) + entry + Array("\n".utf8) + inner + Array("}".utf8)
        : Array("\"env\": {".utf8) + entry + Array("}".utf8)
      b = insert(member: env, into: root, b)
    }

    // 2. Remove ANTHROPIC_API_KEY (every time it appears).
    while true {
      let root = try Scanner(b).root()
      guard let env = root.members.last(where: { $0.key == "env" }) else { break }
      let obj = try Scanner(b).object(at: env.valueStart, depth: 1)
      guard let i = obj.members.firstIndex(where: { $0.key == apiKeyKey }) else { break }
      b = remove(member: i, from: obj, b)
    }

    // 3. Nothing else may have changed.
    var expected = old
    var env = old["env"] as? [String: Any] ?? [:]
    env[tokenKey] = token
    env.removeValue(forKey: apiKeyKey)
    expected["env"] = env
    let out = String(decoding: b, as: UTF8.self) + (empty ? "\n" : "")
    guard let now = try? parse(out), NSDictionary(dictionary: now).isEqual(to: expected) else {
      throw SettingsError.verifyFailed
    }
    return out
  }

  public enum SwitchResult: Equatable, Sendable {
    /// Written; `backup` holds the file as it was (nil when there was no file).
    case written(backup: URL?)
    /// The file already had this token and no ANTHROPIC_API_KEY.
    case unchanged
  }

  /// Sets the token in the settings file at `path` (~ allowed). A symlinked file is written
  /// where it points; the file keeps its permissions (a new file is readable by the owner only,
  /// as it holds a key); the previous content is kept as <file>.bak.
  public static func switchToken(_ token: String, path: String) throws -> SwitchResult {
    let fm = FileManager.default
    let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath).resolvingSymlinksInPath()
    let exists = fm.fileExists(atPath: url.path)
    let data = exists ? try Data(contentsOf: url) : Data()
    guard let text = String(data: data, encoding: .utf8) else { throw SettingsError.notUTF8 }
    let out = try setToken(token, in: text)
    if out == text { return .unchanged }
    return .written(backup: try replace(url, was: exists ? data : nil, with: out))
  }

  /// Writes `text` to `url` (already resolved), keeping what was there as <file>.bak and the
  /// file's permissions (a new file is readable by the owner only). Returns the backup.
  static func replace(_ url: URL, was old: Data?, with text: String) throws -> URL? {
    let fm = FileManager.default
    var backup: URL?
    var perms: Any? = 0o600
    if let old {
      let bak = url.appendingPathExtension("bak")
      try old.write(to: bak, options: .atomic)
      try? fm.setAttributes([.posixPermissions: 0o600], ofItemAtPath: bak.path)
      backup = bak
      perms = try fm.attributesOfItem(atPath: url.path)[.posixPermissions]
    } else {
      try fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    }
    try Data(text.utf8).write(to: url, options: .atomic)
    if let perms { try? fm.setAttributes([.posixPermissions: perms], ofItemAtPath: url.path) }
    return backup
  }

  /// `text` (a JSON object) with its top-level string `key` set to `value`, in place where it is
  /// (or added at the end); everything else byte for byte as it was, checked like setToken.
  static func setTopLevel(_ key: String, to value: String, in text: String) throws -> String {
    let old = try parse(text)
    var b = Array(text.utf8)
    let v = Array(jsonString(value).utf8)
    let root = try Scanner(b).root()
    let hits = root.members.filter { $0.key == key }
    if hits.isEmpty {
      b = insert(member: Array(jsonString(key).utf8) + Array(": ".utf8) + v, into: root, b)
    } else {
      for m in hits.reversed() { b.replaceSubrange(m.valueStart..<m.valueEnd, with: v) }
    }
    var expected = old
    expected[key] = value
    let out = String(decoding: b, as: UTF8.self)
    guard let now = try? parse(out), NSDictionary(dictionary: now).isEqual(to: expected) else {
      throw SettingsError.verifyFailed
    }
    return out
  }

  // MARK: - Text editing

  static func parse(_ text: String) throws -> [String: Any] {
    let any: Any
    do { any = try JSONSerialization.jsonObject(with: Data(text.utf8)) } catch {
      throw SettingsError.notJSON((error as NSError).userInfo["NSDebugDescription"] as? String ?? error.localizedDescription)
    }
    guard let obj = any as? [String: Any] else { throw SettingsError.rootNotObject }
    return obj
  }

  static func jsonString(_ s: String) -> String {
    let d = try! JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed, .withoutEscapingSlashes])
    return String(decoding: d, as: UTF8.self)
  }

  /// Adds `member` ("key": value) as the last entry of `obj`, laid out like the entries before it.
  static func insert(member: [UInt8], into obj: Scanner.Object, _ b: [UInt8]) -> [UInt8] {
    var b = b
    if let last = obj.members.last {
      let sep: [UInt8] = hasNewline(b, obj.open, obj.members[0].keyStart)
        ? Array(",\n".utf8) + lineIndent(b, last.keyStart)
        : Array(", ".utf8)
      b.insert(contentsOf: sep + member, at: last.valueEnd)
    } else {
      let outer = lineIndent(b, obj.open)
      let body = Array("\n".utf8) + outer + Array("  ".utf8) + member + Array("\n".utf8) + outer
      b.replaceSubrange(obj.open + 1..<obj.close, with: body)
    }
    return b
  }

  /// Removes entry `i` of `obj` with its comma.
  static func remove(member i: Int, from obj: Scanner.Object, _ b: [UInt8]) -> [UInt8] {
    var b = b
    let ms = obj.members
    if ms.count == 1 {
      b.replaceSubrange(obj.open + 1..<obj.close, with: [])
    } else if i < ms.count - 1 {
      b.removeSubrange(ms[i].keyStart..<ms[i + 1].keyStart)
    } else {
      b.removeSubrange(ms[i - 1].valueEnd..<ms[i].valueEnd)
    }
    return b
  }

  /// The spaces and tabs the line holding `pos` starts with.
  static func lineIndent(_ b: [UInt8], _ pos: Int) -> [UInt8] {
    var s = pos
    while s > 0 && b[s - 1] != UInt8(ascii: "\n") { s -= 1 }
    var e = s
    while e < b.count && (b[e] == UInt8(ascii: " ") || b[e] == UInt8(ascii: "\t")) { e += 1 }
    return Array(b[s..<e])
  }

  /// One level of indentation as the file uses it (two spaces if it can't tell).
  static func unit(_ b: [UInt8], _ root: Scanner.Object) -> [UInt8] {
    guard let first = root.members.first, hasNewline(b, root.open, first.keyStart) else { return Array("  ".utf8) }
    let outer = lineIndent(b, root.open), inner = lineIndent(b, first.keyStart)
    return inner.count > outer.count && inner.starts(with: outer) ? Array(inner[outer.count...]) : Array("  ".utf8)
  }

  static func hasNewline(_ b: [UInt8], _ from: Int, _ to: Int) -> Bool {
    b[from..<to].contains(UInt8(ascii: "\n"))
  }
}

/// Finds where entries are in JSON text (already known to be valid JSON).
struct Scanner {
  struct Member { var key: String; var keyStart: Int; var valueStart: Int; var valueEnd: Int }
  /// `open` is the index of "{", `close` of "}".
  struct Object { var open: Int; var close: Int; var members: [Member] }

  let b: [UInt8]
  init(_ b: [UInt8]) { self.b = b }

  func root() throws -> Object {
    var i = 0
    if b.starts(with: [0xEF, 0xBB, 0xBF]) { i = 3 }
    i = ws(i)
    guard i < b.count, b[i] == UInt8(ascii: "{") else { throw SettingsError.rootNotObject }
    return try object(at: i, depth: 0)
  }

  func object(at start: Int, depth: Int) throws -> Object {
    guard depth < 512 else { throw SettingsError.notJSON("嵌套太深") }
    var i = ws(start + 1)
    var members: [Member] = []
    if at(i, "}") { return Object(open: start, close: i, members: []) }
    while true {
      guard at(i, "\"") else { throw bad(i) }
      let keyEnd = try string(at: i)
      let key = (try? JSONSerialization.jsonObject(with: Data(b[i..<keyEnd]), options: .fragmentsAllowed)) as? String ?? ""
      var j = ws(keyEnd)
      guard at(j, ":") else { throw bad(j) }
      j = ws(j + 1)
      let end = try value(at: j, depth: depth + 1)
      members.append(Member(key: key, keyStart: i, valueStart: j, valueEnd: end))
      i = ws(end)
      if at(i, ",") { i = ws(i + 1); continue }
      if at(i, "}") { return Object(open: start, close: i, members: members) }
      throw bad(i)
    }
  }

  /// The index just after the value starting at `i`.
  func value(at i: Int, depth: Int) throws -> Int {
    guard i < b.count else { throw bad(i) }
    switch b[i] {
    case UInt8(ascii: "\""): return try string(at: i)
    case UInt8(ascii: "{"): return try object(at: i, depth: depth).close + 1
    case UInt8(ascii: "["):
      guard depth < 512 else { throw SettingsError.notJSON("嵌套太深") }
      var j = ws(i + 1)
      if at(j, "]") { return j + 1 }
      while true {
        j = ws(try value(at: j, depth: depth + 1))
        if at(j, ",") { j = ws(j + 1); continue }
        if at(j, "]") { return j + 1 }
        throw bad(j)
      }
    default:
      var j = i
      while j < b.count, !(b[j] == UInt8(ascii: ",") || b[j] == UInt8(ascii: "}") || b[j] == UInt8(ascii: "]") || isWS(b[j])) { j += 1 }
      guard j > i else { throw bad(i) }
      return j
    }
  }

  /// The index just after the string starting at `i` (at its opening quote).
  func string(at i: Int) throws -> Int {
    var j = i + 1
    while j < b.count {
      if b[j] == UInt8(ascii: "\"") { return j + 1 }
      j += b[j] == UInt8(ascii: "\\") ? 2 : 1
    }
    throw bad(i)
  }

  func ws(_ i: Int) -> Int {
    var i = i
    while i < b.count && isWS(b[i]) { i += 1 }
    return i
  }

  func isWS(_ c: UInt8) -> Bool { c == 0x20 || c == 0x09 || c == 0x0A || c == 0x0D }
  func at(_ i: Int, _ c: Unicode.Scalar) -> Bool { i < b.count && b[i] == UInt8(ascii: c) }
  func bad(_ i: Int) -> SettingsError { .notJSON("第 \(i) 个字节附近") }
}
