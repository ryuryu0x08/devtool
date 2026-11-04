import CommonCrypto
import Foundation
import SQLite3
import XCTest
@testable import QuotaCore

final class ChromeCookiesTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

  // Chromium's own scheme, so the test encrypts exactly what the browser would.
  private func encrypt(_ text: String, key: Data, host: String?, version: String = "v10") -> Data {
    var plain = Data(text.utf8)
    if let host {
      // Newer Chrome prepends SHA256(host).
      var h = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
      let bytes = Array(host.utf8)
      _ = CC_SHA256(bytes, CC_LONG(bytes.count), &h)
      plain = Data(h) + plain
    }
    let iv = [UInt8](repeating: 0x20, count: kCCBlockSizeAES128)
    let size = plain.count + kCCBlockSizeAES128
    var out = [UInt8](repeating: 0, count: size)
    var moved = 0
    _ = plain.withUnsafeBytes { pin in
      key.withUnsafeBytes { k in
        out.withUnsafeMutableBytes { o in
          CCCrypt(CCOperation(kCCEncrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                  k.baseAddress, k.count, iv, pin.baseAddress, pin.count, o.baseAddress, size, &moved)
        }
      }
    }
    return Data(version.utf8) + Data(out.prefix(moved))
  }

  func testDecryptRoundTripWithAndWithoutHostPrefix() {
    let key = ChromeCookies.deriveKey(password: "s3cr3t-keychain-pw")
    XCTAssertEqual(key.count, 16)
    let host = "ai-coding.bilibili.co"
    XCTAssertEqual(ChromeCookies.decrypt(encrypt("SESSDATA-abc", key: key, host: host), key: key, host: host), "SESSDATA-abc")
    // Older format without the host prefix.
    XCTAssertEqual(ChromeCookies.decrypt(encrypt("plain-value", key: key, host: nil), key: key, host: host), "plain-value")
    // A value that happens to be 32+ bytes but has no matching prefix is kept whole.
    let long = String(repeating: "x", count: 50)
    XCTAssertEqual(ChromeCookies.decrypt(encrypt(long, key: key, host: nil), key: key, host: host), long)
    // v11 prefix is handled like v10.
    XCTAssertEqual(ChromeCookies.decrypt(encrypt("y", key: key, host: host, version: "v11"), key: key, host: host), "y")
    // The wrong key gives something that isn't the text (and never crashes).
    let other = ChromeCookies.deriveKey(password: "different")
    XCTAssertNotEqual(ChromeCookies.decrypt(encrypt("SESSDATA-abc", key: key, host: host), key: other, host: host), "SESSDATA-abc")
  }

  func testReadRowsFromASQLiteCookieStore() throws {
    let key = ChromeCookies.deriveKey(password: "pw")
    let db = dir.appendingPathComponent("Cookies")
    try makeCookieDB(db, [
      (".bilibili.co", "SESSDATA", encrypt("the-session", key: key, host: ".bilibili.co")),
      ("ai-coding.bilibili.co", "csrf", encrypt("tok123", key: key, host: "ai-coding.bilibili.co")),
      (".other.com", "junk", encrypt("nope", key: key, host: ".other.com")),
    ])
    let rows = try ChromeCookies.readRows(dbPath: db.path, like: "%bilibili.co")
    XCTAssertEqual(Set(rows.map(\.name)), ["SESSDATA", "csrf"])
  }

  func testHostAndRegistrableMatching() {
    XCTAssertEqual(ChromeCookies.registrable("ai-coding.bilibili.co"), "bilibili.co")
    XCTAssertEqual(ChromeCookies.registrable("bilibili.co"), "bilibili.co")
    let t = "ai-coding.bilibili.co"
    XCTAssertTrue(ChromeCookies.hostMatches(target: t, cookieDomain: ".bilibili.co"))
    XCTAssertTrue(ChromeCookies.hostMatches(target: t, cookieDomain: "ai-coding.bilibili.co"))
    XCTAssertTrue(ChromeCookies.hostMatches(target: t, cookieDomain: ".ai-coding.bilibili.co"))
    XCTAssertFalse(ChromeCookies.hostMatches(target: t, cookieDomain: "other.bilibili.co"))
    XCTAssertFalse(ChromeCookies.hostMatches(target: t, cookieDomain: ".sibling.co"))
    XCTAssertFalse(ChromeCookies.hostMatches(target: t, cookieDomain: ""))
  }

  func testHeaderEndToEndWithAPasswordAndProfiles() throws {
    let key = ChromeCookies.deriveKey(password: "pw")
    let base = dir.appendingPathComponent("Google/Chrome")
    try FileManager.default.createDirectory(at: base.appendingPathComponent("Default"), withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: base.appendingPathComponent("Profile 1"), withIntermediateDirectories: true)
    try makeCookieDB(base.appendingPathComponent("Default/Cookies"), [
      (".bilibili.co", "SESSDATA", encrypt("sess-default", key: key, host: ".bilibili.co")),
    ])
    // A later profile's cookie of the same name wins.
    try makeCookieDB(base.appendingPathComponent("Profile 1/Cookies"), [
      (".bilibili.co", "SESSDATA", encrypt("sess-profile1", key: key, host: ".bilibili.co")),
      ("ai-coding.bilibili.co", "bili_jct", encrypt("jct-xyz", key: key, host: "ai-coding.bilibili.co")),
    ])
    let browser = ChromeCookies.Browser(name: "T", dataDir: base.path, keychainService: "x", keychainAccount: "y")
    let header = try ChromeCookies.header(domain: "ai-coding.bilibili.co", browser: browser, password: "pw")
    XCTAssertTrue(header.contains("SESSDATA=sess-profile1"), header)
    XCTAssertTrue(header.contains("bili_jct=jct-xyz"), header)
  }

  func testHeaderErrorsWhenNoCookieStore() {
    let browser = ChromeCookies.Browser(name: "Nope", dataDir: dir.appendingPathComponent("absent").path, keychainService: "x", keychainAccount: "y")
    XCTAssertThrowsError(try ChromeCookies.header(domain: "ai-coding.bilibili.co", browser: browser, password: "pw")) {
      XCTAssertEqual($0 as? ChromeCookies.CookieError, .notInstalled("Nope"))
    }
  }

  // MARK: - A real SQLite file in the cookies schema

  private func makeCookieDB(_ url: URL, _ rows: [(String, String, Data)]) throws {
    var db: OpaquePointer?
    XCTAssertEqual(sqlite3_open(url.path, &db), SQLITE_OK)
    defer { sqlite3_close(db) }
    XCTAssertEqual(sqlite3_exec(db, "CREATE TABLE cookies (host_key TEXT, name TEXT, encrypted_value BLOB, path TEXT)", nil, nil, nil), SQLITE_OK)
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    for (host, name, enc) in rows {
      var stmt: OpaquePointer?
      XCTAssertEqual(sqlite3_prepare_v2(db, "INSERT INTO cookies (host_key, name, encrypted_value, path) VALUES (?,?,?,'/')", -1, &stmt, nil), SQLITE_OK)
      sqlite3_bind_text(stmt, 1, host, -1, transient)
      sqlite3_bind_text(stmt, 2, name, -1, transient)
      _ = enc.withUnsafeBytes { sqlite3_bind_blob(stmt, 3, $0.baseAddress, Int32($0.count), transient) }
      XCTAssertEqual(sqlite3_step(stmt), SQLITE_DONE)
      sqlite3_finalize(stmt)
    }
  }
}
