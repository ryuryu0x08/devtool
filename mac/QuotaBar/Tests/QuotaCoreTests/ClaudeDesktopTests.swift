import Foundation
import XCTest
@testable import QuotaCore

final class ClaudeDesktopTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

  private let id = "00000000-0000-4000-8000-000000157210"
  /// Laid out as Desktop writes it.
  private func config(key: String, provider: String = "gateway") -> String {
    """
    {"inferenceGatewayBaseUrl":"http://gw.example/","inferenceGatewayApiKey":"\(key)","defaultModelEffort":"medium",\
    "coworkEgressAllowedHosts":["*"],"disableDeploymentModeChooser":true,"inferenceProvider":"\(provider)","inferenceCredentialKind":"static"}
    """
  }

  private func setUp(_ text: String) throws {
    try #"{"entries":[{"id":"\#(id)","name":"CC Switch"}],"appliedId":"\#(id)"}"#.write(to: dir.appendingPathComponent("_meta.json"), atomically: true, encoding: .utf8)
    try text.write(to: file, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
  }

  private var file: URL { dir.appendingPathComponent(id + ".json") }

  func testReplacesTheSealedKeyWithThePlainOneAndNothingElse() throws {
    let before = config(key: "__sealed__:v1:abc")
    try setUp(before)
    XCTAssertEqual(ClaudeDesktop.status(dir: dir.path, managed: []), .gateway(key: nil, baseURL: "http://gw.example/"))
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-new", dir: dir.path, managed: []), .written)
    XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), before.replacingOccurrences(of: "__sealed__:v1:abc", with: "sk-new"))
    XCTAssertEqual(try String(contentsOf: file.appendingPathExtension("bak"), encoding: .utf8), before)
    XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int, 0o600)
    XCTAssertEqual(ClaudeDesktop.status(dir: dir.path, managed: []), .gateway(key: "sk-new", baseURL: "http://gw.example/"))
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-new", dir: dir.path, managed: []), .unchanged)
    // And the address, when asked.
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-new", baseURL: "http://new/api", dir: dir.path, managed: []), .written)
    XCTAssertEqual(ClaudeDesktop.status(dir: dir.path, managed: []), .gateway(key: "sk-new", baseURL: "http://new/api"))
    XCTAssertEqual(try String(contentsOf: file, encoding: .utf8),
                   before.replacingOccurrences(of: "__sealed__:v1:abc", with: "sk-new").replacingOccurrences(of: "http://gw.example/", with: "http://new/api"))
  }

  func testLeavesDesktopAloneWhenItIsNotOnAGatewayOrIsManaged() throws {
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-1", dir: dir.path, managed: []), .skipped(.notGateway))
    try setUp(config(key: "sk-0", provider: "bedrock"))
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-1", dir: dir.path, managed: []), .skipped(.notGateway))
    try setUp(config(key: "sk-0"))
    let plist = dir.appendingPathComponent("managed.plist")
    // Only app-behaviour keys: the local configuration still applies.
    (["disableAutoUpdates": "true"] as NSDictionary).write(to: plist, atomically: true)
    XCTAssertEqual(ClaudeDesktop.status(dir: dir.path, managed: [plist.path]), .gateway(key: "sk-0", baseURL: "http://gw.example/"))
    (["inferenceProvider": "gateway"] as NSDictionary).write(to: plist, atomically: true)
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-1", dir: dir.path, managed: [plist.path]), .skipped(.managed))
    XCTAssertTrue(try String(contentsOf: file, encoding: .utf8).contains("sk-0"))
  }

  // MARK: - Starting on the gateway

  private var root: URL { dir.appendingPathComponent("Claude-3p") }
  private var signedIn: URL { dir.appendingPathComponent("Claude") }
  private func read(_ u: URL) throws -> [String: Any] {
    try JSONSerialization.jsonObject(with: Data(contentsOf: u)) as! [String: Any]
  }

  func testWithoutDesktopNothingIsMade() throws {
    XCTAssertThrowsError(try ClaudeDesktop.useGateway(key: "sk-1", baseURL: "http://127.0.0.1:47831", root: root.path, managed: [])) {
      XCTAssertEqual($0 as? ClaudeDesktop.SetupError, .noDesktop)
    }
    XCTAssertThrowsError(try ClaudeDesktop.enableDeveloperMode(root: root.path))
    XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
  }

  func testSignedInOnlyGetsAQuotaBarConfigurationApplied() throws {
    try FileManager.default.createDirectory(at: signedIn, withIntermediateDirectories: true)
    let mine = #"{"deploymentMode": "1p", "mcpServers": {"x": {"command": "y"}}}"#
    try mine.write(to: signedIn.appendingPathComponent("claude_desktop_config.json"), atomically: true, encoding: .utf8)
    XCTAssertTrue(try ClaudeDesktop.useGateway(key: "sk-1", baseURL: "http://127.0.0.1:47831", root: root.path, managed: []))
    let lib = root.appendingPathComponent("configLibrary").path
    XCTAssertEqual(ClaudeDesktop.status(dir: lib, managed: []), .gateway(key: "sk-1", baseURL: "http://127.0.0.1:47831"))
    let meta = try read(root.appendingPathComponent("configLibrary/_meta.json"))
    let entries = meta["entries"] as! [[String: Any]]
    XCTAssertEqual(entries.count, 1)
    XCTAssertEqual(entries[0]["name"] as? String, "QuotaBar")
    XCTAssertEqual(meta["appliedId"] as? String, entries[0]["id"] as? String)
    let f = root.appendingPathComponent("configLibrary/\(entries[0]["id"] as! String).json")
    XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: f.path)[.posixPermissions] as? Int, 0o600)
    // The remembered "1p" no longer keeps Desktop at the sign-in; the rest is as it was.
    XCTAssertEqual(try String(contentsOf: signedIn.appendingPathComponent("claude_desktop_config.json"), encoding: .utf8),
                   mine.replacingOccurrences(of: "1p", with: "3p"))

    // Again, with another key: the same entry, not a second one.
    XCTAssertTrue(try ClaudeDesktop.useGateway(key: "sk-2", baseURL: "http://127.0.0.1:47831", root: root.path, managed: []))
    XCTAssertEqual(ClaudeDesktop.status(dir: lib, managed: []), .gateway(key: "sk-2", baseURL: "http://127.0.0.1:47831"))
    XCTAssertEqual((try read(root.appendingPathComponent("configLibrary/_meta.json"))["entries"] as! [Any]).count, 1)
    XCTAssertFalse(try ClaudeDesktop.useGateway(key: "sk-2", baseURL: "http://127.0.0.1:47831", root: root.path, managed: []))
  }

  func testAnAppliedGatewayConfigurationIsKeptAndUpdated() throws {
    let lib = root.appendingPathComponent("configLibrary")
    try FileManager.default.createDirectory(at: lib, withIntermediateDirectories: true)
    let saved = dir
    dir = lib
    try setUp(config(key: "sk-old"))
    dir = saved
    XCTAssertTrue(try ClaudeDesktop.useGateway(key: "sk-new", baseURL: "http://127.0.0.1:47831", root: root.path, managed: []))
    let f = lib.appendingPathComponent(id + ".json")
    XCTAssertEqual(try String(contentsOf: f, encoding: .utf8),
                   config(key: "sk-new").replacingOccurrences(of: "http://gw.example/", with: "http://127.0.0.1:47831"))
    XCTAssertEqual((try read(lib.appendingPathComponent("_meta.json"))["entries"] as! [Any]).count, 1)
  }

  func testAnotherProviderAppliedIsLeftStoredAndOursApplied() throws {
    let lib = root.appendingPathComponent("configLibrary")
    try FileManager.default.createDirectory(at: lib, withIntermediateDirectories: true)
    let saved = dir
    dir = lib
    let vertex = config(key: "", provider: "vertex")
    try setUp(vertex)
    dir = saved
    try ClaudeDesktop.useGateway(key: "sk-1", baseURL: "http://127.0.0.1:47831", root: root.path, managed: [])
    XCTAssertEqual(try String(contentsOf: lib.appendingPathComponent(id + ".json"), encoding: .utf8), vertex)
    let meta = try read(lib.appendingPathComponent("_meta.json"))
    XCTAssertEqual((meta["entries"] as! [Any]).count, 2)
    XCTAssertNotEqual(meta["appliedId"] as? String, id)
    XCTAssertEqual(ClaudeDesktop.status(dir: lib.path, managed: []), .gateway(key: "sk-1", baseURL: "http://127.0.0.1:47831"))
  }

  func testManagedIsNotTouched() throws {
    try FileManager.default.createDirectory(at: signedIn, withIntermediateDirectories: true)
    let plist = dir.appendingPathComponent("managed.plist")
    try (["inferenceProvider": "vertex"] as NSDictionary).write(to: plist)
    XCTAssertThrowsError(try ClaudeDesktop.useGateway(key: "sk-1", baseURL: "http://x", root: root.path, managed: [plist.path])) {
      XCTAssertEqual($0 as? ClaudeDesktop.SetupError, .managed)
    }
    XCTAssertFalse(FileManager.default.fileExists(atPath: root.path))
  }

  func testDeveloperModeInBothFoldersOtherSettingsKept() throws {
    try FileManager.default.createDirectory(at: signedIn, withIntermediateDirectories: true)
    let other = #"{"allowDevTools": false, "other": 1}"#
    try other.write(to: signedIn.appendingPathComponent("developer_settings.json"), atomically: true, encoding: .utf8)
    XCTAssertFalse(ClaudeDesktop.developerMode(root: root.path))
    XCTAssertTrue(try ClaudeDesktop.enableDeveloperMode(root: root.path))
    XCTAssertTrue(ClaudeDesktop.developerMode(root: root.path))
    XCTAssertEqual(try String(contentsOf: signedIn.appendingPathComponent("developer_settings.json"), encoding: .utf8),
                   #"{"allowDevTools": true, "other": 1}"#)
    XCTAssertEqual(try read(root.appendingPathComponent("developer_settings.json"))["allowDevTools"] as? Bool, true)
    XCTAssertFalse(try ClaudeDesktop.enableDeveloperMode(root: root.path))
  }
}
