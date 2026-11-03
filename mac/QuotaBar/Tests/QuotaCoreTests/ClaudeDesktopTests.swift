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
    XCTAssertEqual(ClaudeDesktop.status(dir: dir.path, managed: []), .gateway(key: nil))
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-new", dir: dir.path, managed: []), .written)
    XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), before.replacingOccurrences(of: "__sealed__:v1:abc", with: "sk-new"))
    XCTAssertEqual(try String(contentsOf: file.appendingPathExtension("bak"), encoding: .utf8), before)
    XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as? Int, 0o600)
    XCTAssertEqual(ClaudeDesktop.status(dir: dir.path, managed: []), .gateway(key: "sk-new"))
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-new", dir: dir.path, managed: []), .unchanged)
  }

  func testLeavesDesktopAloneWhenItIsNotOnAGatewayOrIsManaged() throws {
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-1", dir: dir.path, managed: []), .skipped(.notGateway))
    try setUp(config(key: "sk-0", provider: "bedrock"))
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-1", dir: dir.path, managed: []), .skipped(.notGateway))
    try setUp(config(key: "sk-0"))
    let plist = dir.appendingPathComponent("managed.plist")
    // Only app-behaviour keys: the local configuration still applies.
    (["disableAutoUpdates": "true"] as NSDictionary).write(to: plist, atomically: true)
    XCTAssertEqual(ClaudeDesktop.status(dir: dir.path, managed: [plist.path]), .gateway(key: "sk-0"))
    (["inferenceProvider": "gateway"] as NSDictionary).write(to: plist, atomically: true)
    XCTAssertEqual(try ClaudeDesktop.switchKey("sk-1", dir: dir.path, managed: [plist.path]), .skipped(.managed))
    XCTAssertTrue(try String(contentsOf: file, encoding: .utf8).contains("sk-0"))
  }
}
