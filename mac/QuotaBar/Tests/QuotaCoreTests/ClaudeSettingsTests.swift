import Foundation
import XCTest
@testable import QuotaCore

final class ClaudeSettingsTests: XCTestCase {
  private func set(_ text: String, _ token: String = "sk-new") throws -> String {
    try ClaudeSettings.setToken(token, in: text)
  }

  func testReplacesTheTokenInPlaceAndKeepsEverythingElseAsWritten() throws {
    let text = """
    {
        "model": "opus",
        "env": {
            "ANTHROPIC_BASE_URL": "http://10.0.0.1/",
            "ANTHROPIC_AUTH_TOKEN": "sk-old",
            "DISABLE_TELEMETRY": "1"
        },
        "permissions": {"allow": ["Bash(ls:*)"]},
        "n": 1.50
    }

    """
    XCTAssertEqual(try set(text), text.replacingOccurrences(of: "sk-old", with: "sk-new"))
  }

  func testAddsTheTokenAfterTheLastEntryOfEnvWithItsIndentation() throws {
    let text = "{\n\t\"env\": {\n\t\t\"ANTHROPIC_BASE_URL\": \"http://x/\"\n\t},\n\t\"model\": \"opus\"\n}\n"
    XCTAssertEqual(try set(text), "{\n\t\"env\": {\n\t\t\"ANTHROPIC_BASE_URL\": \"http://x/\",\n\t\t\"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"\n\t},\n\t\"model\": \"opus\"\n}\n")
  }

  func testAddsEnvWhenThereIsNone() throws {
    XCTAssertEqual(try set("{\n  \"model\": \"opus\"\n}\n"),
                   "{\n  \"model\": \"opus\",\n  \"env\": {\n    \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"\n  }\n}\n")
    XCTAssertEqual(try set("{\"model\":\"opus\"}"), "{\"model\":\"opus\", \"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"}}")
    XCTAssertEqual(try set("{}"), "{\n  \"env\": {\n    \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"\n  }\n}")
    XCTAssertEqual(try set("{\"env\": {}}"), "{\"env\": {\n  \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"\n}}")
  }

  func testAnEmptyOrMissingFileGetsJustTheToken() throws {
    for text in ["", "  \n"] {
      XCTAssertEqual(try set(text), "{\n  \"env\": {\n    \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"\n  }\n}\n")
    }
  }

  func testRemovesTheApiKeyWhereverItIsInEnv() throws {
    let first = "{\n  \"env\": {\n    \"ANTHROPIC_API_KEY\": \"k\",\n    \"A\": \"1\"\n  }\n}"
    XCTAssertEqual(try set(first), "{\n  \"env\": {\n    \"A\": \"1\",\n    \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"\n  }\n}")
    let middle = "{\"env\": {\"A\": \"1\", \"ANTHROPIC_API_KEY\": \"k\", \"ANTHROPIC_AUTH_TOKEN\": \"t\"}}"
    XCTAssertEqual(try set(middle), "{\"env\": {\"A\": \"1\", \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"}}")
    let last = "{\"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"t\", \"ANTHROPIC_API_KEY\": \"k\"}}"
    XCTAssertEqual(try set(last), "{\"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"}}")
    let only = "{\"env\": {\"ANTHROPIC_API_KEY\": \"k\"}}"
    XCTAssertEqual(try set(only), "{\"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"}}")
    let twice = "{\"env\": {\"ANTHROPIC_API_KEY\": \"k\", \"ANTHROPIC_API_KEY\": \"k2\", \"B\": 2}}"
    XCTAssertEqual(try set(twice), "{\"env\": {\"B\": 2, \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"}}")
  }

  func testOnlyEnvIsTouched() throws {
    // The same names elsewhere stay.
    let text = "{\"other\": {\"ANTHROPIC_API_KEY\": \"x\", \"ANTHROPIC_AUTH_TOKEN\": \"y\"}, \"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"t\"}}"
    XCTAssertEqual(try set(text), "{\"other\": {\"ANTHROPIC_API_KEY\": \"x\", \"ANTHROPIC_AUTH_TOKEN\": \"y\"}, \"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"}}")
  }

  func testOtherTextIsKeptByteForByte() throws {
    // Escapes, non-ASCII, nesting, numbers as written, a BOM.
    let text = "\u{FEFF}{\"a\": \"\\u4e2d\\\"}{,\", \"中文\": [1e3, -0.0, {\"x\": [[]]}], \"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"t\"}, \"z\": null}"
    XCTAssertEqual(try set(text), text.replacingOccurrences(of: "\"t\"", with: "\"sk-new\""))
  }

  func testTheKeyIsWrittenAsAJSONString() throws {
    let out = try set("{}", "a\"b\\c/d")
    XCTAssertEqual(ClaudeSettings.currentToken(in: out), "a\"b\\c/d")
    XCTAssertTrue(out.contains("\"a\\\"b\\\\c/d\""))
  }

  func testRefusesWhatItCannotEditSafely() {
    XCTAssertThrowsError(try set("{\"env\": "), "not JSON") { e in
      guard case SettingsError.notJSON = e else { return XCTFail("\(e)") }
    }
    XCTAssertThrowsError(try set("// comment\n{}")) { e in
      guard case SettingsError.notJSON = e else { return XCTFail("\(e)") }
    }
    XCTAssertThrowsError(try set("[1]")) { XCTAssertEqual($0 as? SettingsError, .rootNotObject) }
    XCTAssertThrowsError(try set("{\"env\": \"x\"}")) { XCTAssertEqual($0 as? SettingsError, .envNotObject) }
  }

  func testReadsTheCurrentTokenAndApiKeyHelper() {
    XCTAssertEqual(ClaudeSettings.currentToken(in: "{\"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"sk-1\"}}"), "sk-1")
    XCTAssertNil(ClaudeSettings.currentToken(in: "{\"env\": {}}"))
    XCTAssertNil(ClaudeSettings.currentToken(in: "nope"))
    XCTAssertTrue(ClaudeSettings.hasApiKeyHelper(in: "{\"apiKeyHelper\": \"/bin/k\"}"))
    XCTAssertFalse(ClaudeSettings.hasApiKeyHelper(in: "{}"))
  }

  // MARK: - The file

  private func tempDir() throws -> URL {
    let d = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
    addTeardownBlock { try? FileManager.default.removeItem(at: d) }
    return d
  }

  func testWritesTheFileKeepsABackupAndThePermissions() throws {
    let d = try tempDir()
    let f = d.appendingPathComponent("settings.json")
    let before = "{\n  \"env\": {\"ANTHROPIC_AUTH_TOKEN\": \"sk-a\"}\n}\n"
    try before.write(to: f, atomically: true, encoding: .utf8)
    try FileManager.default.setAttributes([.posixPermissions: 0o640], ofItemAtPath: f.path)

    guard case .written(let bak?) = try ClaudeSettings.switchToken("sk-b", path: f.path) else { return XCTFail("not written") }
    XCTAssertEqual(bak.lastPathComponent, "settings.json.bak")
    XCTAssertEqual(try String(contentsOf: f, encoding: .utf8), before.replacingOccurrences(of: "sk-a", with: "sk-b"))
    XCTAssertEqual(try String(contentsOf: bak, encoding: .utf8), before)
    XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: f.path)[.posixPermissions] as? Int, 0o640)
    XCTAssertEqual(try ClaudeSettings.switchToken("sk-b", path: f.path), .unchanged)
  }

  func testNoFileIsNotCreated() throws {
    let f = try tempDir().appendingPathComponent(".claude/settings.json")
    XCTAssertEqual(try ClaudeSettings.switchToken("sk-b", path: f.path), .noFile)
    XCTAssertFalse(FileManager.default.fileExists(atPath: f.path))
  }

  func testSetsTheAddressTooWhenAsked() throws {
    let text = "{\n  \"env\": {\n    \"ANTHROPIC_BASE_URL\": \"http://old/\",\n    \"ANTHROPIC_AUTH_TOKEN\": \"t\"\n  }\n}\n"
    XCTAssertEqual(try ClaudeSettings.setToken("sk-new", baseURL: "http://new/api", in: text),
                   "{\n  \"env\": {\n    \"ANTHROPIC_BASE_URL\": \"http://new/api\",\n    \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\"\n  }\n}\n")
    XCTAssertEqual(try ClaudeSettings.setToken("sk-new", baseURL: "http://new/api", in: "{\"env\": {}}"),
                   "{\"env\": {\n  \"ANTHROPIC_AUTH_TOKEN\": \"sk-new\",\n  \"ANTHROPIC_BASE_URL\": \"http://new/api\"\n}}")
    XCTAssertEqual(ClaudeSettings.currentEnv("ANTHROPIC_BASE_URL", in: text), "http://old/")
    XCTAssertTrue(ClaudeSettings.sameURL("http://a/api/ ", "HTTP://a/api"))
    XCTAssertFalse(ClaudeSettings.sameURL("http://a/api", "http://a/api/v1"))
    XCTAssertFalse(ClaudeSettings.sameURL(nil, ""))
  }

  func testASymlinkedFileIsWrittenWhereItPoints() throws {
    let d = try tempDir()
    let real = d.appendingPathComponent("dotfiles-settings.json")
    let link = d.appendingPathComponent("settings.json")
    try "{}".write(to: real, atomically: true, encoding: .utf8)
    try FileManager.default.createSymbolicLink(at: link, withDestinationURL: real)
    _ = try ClaudeSettings.switchToken("sk-b", path: link.path)
    XCTAssertEqual(try FileManager.default.destinationOfSymbolicLink(atPath: link.path), real.path)
    XCTAssertEqual(ClaudeSettings.currentToken(in: try String(contentsOf: real, encoding: .utf8)), "sk-b")
  }

  func testAFileItCannotEditIsLeftAlone() throws {
    let f = try tempDir().appendingPathComponent("settings.json")
    try "{ broken".write(to: f, atomically: true, encoding: .utf8)
    XCTAssertThrowsError(try ClaudeSettings.switchToken("sk-b", path: f.path))
    XCTAssertEqual(try String(contentsOf: f, encoding: .utf8), "{ broken")
    XCTAssertFalse(FileManager.default.fileExists(atPath: f.appendingPathExtension("bak").path))
  }
}
