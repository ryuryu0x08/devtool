// Claude Desktop on a third-party gateway keeps its key in its own configuration, not in Claude
// Code's settings: ~/Library/Application Support/Claude-3p/configLibrary/, where _meta.json says
// which <id>.json is applied and inferenceGatewayApiKey holds the key. Desktop seals the key it
// saves itself ("__sealed__:…") and reads a plain one as well; it reads the file at launch only.
//
// Desktop starts on the gateway, without an Anthropic sign-in, when the applied configuration has
// an inference provider, unless a "deploymentMode": "1p" it remembered (claude_desktop_config.json)
// says otherwise (it may be in the Claude-3p folder or in Claude, the signed-in app's folder
// beside it). With no configuration applied, it starts at the sign-in.
import Foundation

public enum ClaudeDesktop {
  public static let defaultDir = "~/Library/Application Support/Claude-3p/configLibrary"
  public static let bundleID = "com.anthropic.claudefordesktop"
  /// Configuration that company device management deploys, which Desktop uses instead.
  public static let managedFiles = [
    "/Library/Managed Preferences/\(NSUserName())/com.anthropic.claudefordesktop.plist",
    "/Library/Managed Preferences/com.anthropic.claudefordesktop.plist",
  ]
  /// Managed keys that still leave the local configuration in use.
  static let appBehaviorKeys: Set<String> = [
    "disableAutoUpdates", "autoUpdaterEnforcementHours", "installedUpdateEnforcementEnabled", "installedUpdateEnforcementHours",
    "updateViaUpdatesHost", "releaseChannel", "relaunchEnforcementHours", "configRecheckIntervalMinutes", "egressProxyUrl", "egressProxyPacUrl",
  ]
  static let keyField = "inferenceGatewayApiKey"
  static let urlField = "inferenceGatewayBaseUrl"

  public enum Status: Equatable, Sendable {
    /// Desktop uses the gateway at `baseURL` with `key` (nil: sealed, so it can't be read here).
    case gateway(key: String?, baseURL: String?)
    /// No local configuration, or not one with a gateway key: nothing to switch.
    case notGateway
    /// Device management decides Desktop's configuration.
    case managed
  }

  public enum Result: Equatable, Sendable {
    case written
    case unchanged
    case skipped(Status)
  }

  /// The applied configuration file in `dir`, and its content.
  static func applied(_ dir: String) -> (URL, Data, [String: Any])? {
    let d = URL(fileURLWithPath: (dir as NSString).expandingTildeInPath, isDirectory: true)
    guard let m = try? Data(contentsOf: d.appendingPathComponent("_meta.json")),
          let meta = try? JSONSerialization.jsonObject(with: m) as? [String: Any],
          let id = meta["appliedId"] as? String, !id.isEmpty, !id.contains("/") else { return nil }
    let f = d.appendingPathComponent(id + ".json").resolvingSymlinksInPath()
    guard let data = try? Data(contentsOf: f), let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return (f, data, obj)
  }

  static func isManaged(_ files: [String]) -> Bool {
    files.contains { path in
      guard let d = NSDictionary(contentsOfFile: path) as? [String: Any] else { return false }
      return d.keys.contains { !appBehaviorKeys.contains($0) }
    }
  }

  public static func status(dir: String = defaultDir, managed: [String] = managedFiles) -> Status {
    if isManaged(managed) { return .managed }
    guard let (_, _, obj) = applied(dir), obj["inferenceProvider"] as? String == "gateway",
          ["static", nil].contains(obj["inferenceCredentialKind"] as? String) else { return .notGateway }
    let k = obj[keyField] as? String
    return .gateway(key: k.flatMap { $0.hasPrefix("__sealed__:") ? nil : $0 }, baseURL: obj[urlField] as? String)
  }

  /// Sets Desktop's gateway key to `key` (and its address to `baseURL`, if given), changing
  /// nothing else; the previous file is kept as <file>.bak. Desktop has to be relaunched to use it.
  /// `key` nil: only the address.
  public static func switchKey(_ key: String?, baseURL: String? = nil, dir: String = defaultDir, managed: [String] = managedFiles) throws -> Result {
    let s = status(dir: dir, managed: managed)
    guard case .gateway(let now, let url) = s else { return .skipped(s) }
    if (key == nil || now == key) && (baseURL == nil || baseURL == url) { return .unchanged }
    guard let (file, data, _) = applied(dir), let text = String(data: data, encoding: .utf8) else { throw SettingsError.notUTF8 }
    var out = text
    if let key { out = try ClaudeSettings.setTopLevel(keyField, to: key, in: out) }
    if let baseURL { out = try ClaudeSettings.setTopLevel(urlField, to: baseURL, in: out) }
    _ = try ClaudeSettings.replace(file, was: data, with: out)
    return .written
  }

  // MARK: - Gateway or Anthropic sign-in

  /// How Desktop starts: on the gateway, at the Anthropic sign-in, or as the company set it.
  public enum Mode: Equatable, Sendable {
    case gateway(baseURL: String?)
    case signIn
    case managed
  }

  public enum SetupError: Error, Equatable, LocalizedError {
    case managed
    case noDesktop
    public var errorDescription: String? {
      switch self {
      case .managed: return "Desktop 由公司管理, 不能改"
      case .noDesktop: return "没找到 Desktop 的目录 (没装或没打开过)"
      }
    }
  }

  /// The name of the configuration this app adds when Desktop has no gateway one.
  public static let entryName = "QuotaBar"

  /// `root` (the Claude-3p folder) and the signed-in app's folder beside it.
  static func folders(_ root: String) -> [URL] {
    let r = URL(fileURLWithPath: (root as NSString).expandingTildeInPath, isDirectory: true)
    return [r, r.deletingLastPathComponent().appendingPathComponent("Claude", isDirectory: true)]
  }

  static func library(_ root: String) -> URL { folders(root)[0].appendingPathComponent("configLibrary", isDirectory: true) }

  static func exists(_ u: URL) -> Bool { FileManager.default.fileExists(atPath: u.path) }

  /// The "deploymentMode" Desktop remembered, where it did: the file, its content, the mode.
  static func remembered(_ root: String) -> [(URL, Data, String, String)] {
    folders(root).compactMap { f in
      let file = f.appendingPathComponent("claude_desktop_config.json")
      guard let d = try? Data(contentsOf: file), let t = String(data: d, encoding: .utf8),
            let m = (try? ClaudeSettings.parse(t))?["deploymentMode"] as? String else { return nil }
      return (file, d, t, m)
    }
  }

  public static func mode(root: String, managed: [String] = managedFiles) -> Mode {
    if isManaged(managed) { return .managed }
    if remembered(root).contains(where: { $0.3 == "1p" }) { return .signIn }
    if case .gateway(_, let u) = status(dir: library(root).path, managed: []) { return .gateway(baseURL: u) }
    return .signIn
  }

  /// Sets Desktop to start on the gateway at `baseURL` with `key`, with no Anthropic sign-in:
  /// - the applied configuration, if it is a gateway one, gets the key and the address;
  /// - otherwise `previous` (the one applied before the sign-in was chosen) if it is a gateway
  ///   one, else a configuration named "QuotaBar" (made if missing), gets them and is applied;
  /// - a remembered "deploymentMode": "1p" becomes "3p".
  /// Everything else in the files stays; each changed file is kept as <file>.bak. Desktop reads
  /// all of it at launch. Returns whether anything changed.
  @discardableResult
  public static func useGateway(key: String, baseURL: String, root: String, previous: String? = nil, managed: [String] = managedFiles) throws -> Bool {
    if isManaged(managed) { throw SetupError.managed }
    guard folders(root).contains(where: exists) else { throw SetupError.noDesktop }
    let lib = library(root)
    var changed = false
    if case .gateway = status(dir: lib.path, managed: []) {
      changed = try switchKey(key, baseURL: baseURL, dir: lib.path, managed: []) == .written
    } else {
      try apply(key: key, baseURL: baseURL, lib: lib, previous: previous)
      changed = true
    }
    if try setRemembered("3p", root: root) { changed = true }
    return changed
  }

  /// Sets Desktop to start at the Anthropic sign-in: no configuration is applied any more (all
  /// stay stored), and a remembered "3p" becomes "1p". Returns the one that was applied, to go
  /// back to it.
  @discardableResult
  public static func useSignIn(root: String, managed: [String] = managedFiles) throws -> String? {
    if isManaged(managed) { throw SetupError.managed }
    let metaFile = library(root).appendingPathComponent("_meta.json")
    var was: String?
    if let d = try? Data(contentsOf: metaFile), var meta = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
       let id = meta["appliedId"] as? String, !id.isEmpty {
      was = id
      meta["appliedId"] = nil
      _ = try ClaudeSettings.replace(metaFile, was: d, with: try json(meta))
    }
    try setRemembered("1p", root: root)
    return was
  }

  @discardableResult
  static func setRemembered(_ mode: String, root: String) throws -> Bool {
    var changed = false
    for (file, d, t, m) in remembered(root) where m != mode {
      _ = try ClaudeSettings.replace(file, was: d, with: try ClaudeSettings.setTopLevel("deploymentMode", to: mode, in: t))
      changed = true
    }
    return changed
  }

  /// A gateway configuration with the key and the address, made the applied one.
  static func apply(key: String, baseURL: String, lib: URL, previous: String?) throws {
    let metaFile = lib.appendingPathComponent("_meta.json")
    let metaData = try? Data(contentsOf: metaFile)
    var meta = metaData.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    var entries = meta["entries"] as? [[String: Any]] ?? []
    func ok(_ i: String?) -> Bool { i.map { !$0.isEmpty && !$0.contains("/") } ?? false }
    func isGateway(_ i: String) -> Bool {
      guard let d = try? Data(contentsOf: lib.appendingPathComponent(i + ".json")),
            let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
      return o["inferenceProvider"] as? String == "gateway"
    }
    let id: String
    if let p = previous, ok(p), entries.contains(where: { $0["id"] as? String == p }), isGateway(p) {
      id = p
    } else if let e = entries.first(where: { $0["name"] as? String == entryName }), let i = e["id"] as? String, ok(i) {
      id = i
    } else {
      id = UUID().uuidString.lowercased()
      entries.append(["id": id, "name": entryName])
    }

    // The configuration first, so that _meta.json never names a file that isn't there.
    let file = lib.appendingPathComponent(id + ".json")
    let old = try? Data(contentsOf: file)
    var text: String
    if let old, let t = String(data: old, encoding: .utf8), (try? ClaudeSettings.parse(t)) != nil {
      text = t
      for (k, v) in [("inferenceProvider", "gateway"), (urlField, baseURL), (keyField, key), ("inferenceCredentialKind", "static")] {
        text = try ClaudeSettings.setTopLevel(k, to: v, in: text)
      }
    } else {
      text = try json(["inferenceProvider": "gateway", urlField: baseURL, keyField: key, "inferenceCredentialKind": "static"])
    }
    _ = try ClaudeSettings.replace(file, was: old, with: text)
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)

    meta["entries"] = entries
    meta["appliedId"] = id
    _ = try ClaudeSettings.replace(metaFile, was: metaData, with: try json(meta))
    try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: metaFile.path)
  }

  static func json(_ o: [String: Any]) throws -> String {
    let d = try JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    return String(decoding: d, as: UTF8.self) + "\n"
  }
}
