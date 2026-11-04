// Claude Desktop on a third-party gateway keeps its key in its own configuration, not in Claude
// Code's settings: ~/Library/Application Support/Claude-3p/configLibrary/, where _meta.json says
// which <id>.json is applied and inferenceGatewayApiKey holds the key. Desktop seals the key it
// saves itself ("__sealed__:…") and reads a plain one as well; it reads the file at launch only.
//
// Desktop starts on the gateway, without an Anthropic sign-in, when the applied configuration has
// an inference provider, unless a "deploymentMode": "1p" it remembered (claude_desktop_config.json)
// says otherwise. Developer mode is "allowDevTools" in developer_settings.json. Both live in the
// Claude-3p folder and in Claude, the folder of the signed-in app beside it.
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

  // MARK: - Starting on the gateway

  public enum SetupError: Error, Equatable, LocalizedError {
    case managed
    case noDesktop
    public var errorDescription: String? {
      switch self {
      case .managed: return "Desktop 由公司管理，不能改"
      case .noDesktop: return "没找到 Desktop 的目录（没装或没打开过）"
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

  static func exists(_ u: URL) -> Bool { FileManager.default.fileExists(atPath: u.path) }

  /// Developer mode is on (in either folder).
  public static func developerMode(root: String) -> Bool {
    folders(root).contains { f in
      guard let d = try? Data(contentsOf: f.appendingPathComponent("developer_settings.json")),
            let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
      return o["allowDevTools"] as? Bool == true
    }
  }

  /// Turns developer mode on in both folders (in the ones that exist; Claude-3p is made if only
  /// Claude is there). Other settings in the files are left as they were. Desktop reads it at launch.
  @discardableResult
  public static func enableDeveloperMode(root: String) throws -> Bool {
    let fs = folders(root)
    guard fs.contains(where: exists) else { throw SetupError.noDesktop }
    var changed = false
    for f in fs where exists(f) || f == fs[0] {
      let file = f.appendingPathComponent("developer_settings.json")
      let old = try? Data(contentsOf: file)
      let text: String
      if let old, let t = String(data: old, encoding: .utf8), !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        if (try? ClaudeSettings.parse(t))?["allowDevTools"] as? Bool == true { continue }
        text = try ClaudeSettings.setTopLevel("allowDevTools", json: "true", value: true, in: t)
      } else {
        text = "{\n  \"allowDevTools\": true\n}\n"
      }
      _ = try ClaudeSettings.replace(file, was: old, with: text)
      changed = true
    }
    return changed
  }

  /// Sets Desktop to start on the gateway at `baseURL` with `key`, with no Anthropic sign-in:
  /// - the applied configuration, if it is a gateway one, gets the key and the address;
  /// - otherwise a configuration named "QuotaBar" (made if missing) gets them and is applied;
  /// - a remembered "deploymentMode": "1p" becomes "3p".
  /// Everything else in the files stays; each changed file is kept as <file>.bak. Desktop reads
  /// all of it at launch. Returns whether anything changed.
  @discardableResult
  public static func useGateway(key: String, baseURL: String, root: String, managed: [String] = managedFiles) throws -> Bool {
    if isManaged(managed) { throw SetupError.managed }
    let fs = folders(root)
    guard fs.contains(where: exists) else { throw SetupError.noDesktop }
    let lib = fs[0].appendingPathComponent("configLibrary", isDirectory: true)
    var changed = false
    if case .gateway = status(dir: lib.path, managed: []) {
      changed = try switchKey(key, baseURL: baseURL, dir: lib.path, managed: []) == .written
    } else {
      try addEntry(key: key, baseURL: baseURL, lib: lib)
      changed = true
    }
    for f in fs {
      let file = f.appendingPathComponent("claude_desktop_config.json")
      guard let old = try? Data(contentsOf: file), let t = String(data: old, encoding: .utf8),
            let mode = (try? ClaudeSettings.parse(t))?["deploymentMode"] as? String, mode != "3p" else { continue }
      _ = try ClaudeSettings.replace(file, was: old, with: try ClaudeSettings.setTopLevel("deploymentMode", to: "3p", in: t))
      changed = true
    }
    return changed
  }

  /// The "QuotaBar" configuration, with the gateway, made the applied one.
  static func addEntry(key: String, baseURL: String, lib: URL) throws {
    let metaFile = lib.appendingPathComponent("_meta.json")
    let metaData = try? Data(contentsOf: metaFile)
    var meta = metaData.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    var entries = meta["entries"] as? [[String: Any]] ?? []
    let id: String
    if let e = entries.first(where: { $0["name"] as? String == entryName }), let i = e["id"] as? String, !i.isEmpty, !i.contains("/") {
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
