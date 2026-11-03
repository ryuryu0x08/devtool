// Claude Desktop on a third-party gateway keeps its key in its own configuration, not in Claude
// Code's settings: ~/Library/Application Support/Claude-3p/configLibrary/, where _meta.json says
// which <id>.json is applied and inferenceGatewayApiKey holds the key. Desktop seals the key it
// saves itself ("__sealed__:…") and reads a plain one as well; it reads the file at launch only.
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

  public enum Status: Equatable, Sendable {
    /// Desktop uses the gateway with this key (nil: sealed, so it can't be read here).
    case gateway(key: String?)
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
    return .gateway(key: k.flatMap { $0.hasPrefix("__sealed__:") ? nil : $0 })
  }

  /// Sets Desktop's gateway key to `key`, changing nothing else; the previous file is kept as
  /// <file>.bak. Desktop has to be relaunched to use it.
  public static func switchKey(_ key: String, dir: String = defaultDir, managed: [String] = managedFiles) throws -> Result {
    let s = status(dir: dir, managed: managed)
    guard case .gateway(let now) = s else { return .skipped(s) }
    if now == key { return .unchanged }
    guard let (url, data, _) = applied(dir), let text = String(data: data, encoding: .utf8) else { throw SettingsError.notUTF8 }
    _ = try ClaudeSettings.replace(url, was: data, with: try ClaudeSettings.setTopLevel(keyField, to: key, in: text))
    return .written
  }
}
