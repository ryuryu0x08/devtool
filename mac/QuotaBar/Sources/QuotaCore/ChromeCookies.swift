// Reads cookies for a domain from a Chromium browser's cookie store, the way yt-dlp and
// browser_cookie3 do: the store is a SQLite file, each value AES-128-CBC encrypted with a key kept
// in the login keychain ("Chrome Safe Storage"). Reading that key makes macOS ask the user once.
// This is the user's own browser and their own cookies, for their own account; nothing leaves the
// machine except the request the cookies are for.
import CommonCrypto
import CryptoKit
import Foundation
import SQLite3

public enum ChromeCookies {
  /// A Chromium browser: where its profiles are, and the keychain item its key is under.
  public struct Browser: Sendable, Equatable {
    public var name: String
    public var dataDir: String
    public var keychainService: String
    public var keychainAccount: String
    public init(name: String, dataDir: String, keychainService: String, keychainAccount: String) {
      self.name = name; self.dataDir = dataDir; self.keychainService = keychainService; self.keychainAccount = keychainAccount
    }
  }

  public static let chrome = Browser(
    name: "Google Chrome", dataDir: "~/Library/Application Support/Google/Chrome",
    keychainService: "Chrome Safe Storage", keychainAccount: "Chrome")
  public static let edge = Browser(
    name: "Microsoft Edge", dataDir: "~/Library/Application Support/Microsoft Edge",
    keychainService: "Microsoft Edge Safe Storage", keychainAccount: "Microsoft Edge")
  public static let brave = Browser(
    name: "Brave", dataDir: "~/Library/Application Support/BraveSoftware/Brave-Browser",
    keychainService: "Brave Safe Storage", keychainAccount: "Brave")
  public static let chromium = Browser(
    name: "Chromium", dataDir: "~/Library/Application Support/Chromium",
    keychainService: "Chromium Safe Storage", keychainAccount: "Chromium")
  public static let all = [chrome, edge, brave, chromium]

  public enum CookieError: Error, Equatable, LocalizedError {
    case notInstalled(String)
    case noKeychainKey(String)
    case noCookies(String)
    case database(String)
    public var errorDescription: String? {
      switch self {
      case .notInstalled(let n): return "没找到 \(n)（没装或没打开过）"
      case .noKeychainKey(let n): return "读不到 \(n) 的钥匙串密钥（可能被拒绝）"
      case .noCookies(let d): return "\(d) 在该浏览器里没有 cookie（先在浏览器里登录）"
      case .database(let why): return "读 cookie 库失败：" + why
      }
    }
  }

  // MARK: - Public

  /// The "name=value; name2=value2" header of `domain`'s cookies from the browser. `password`
  /// overrides the keychain read (for tests). Reads every profile; a later profile's cookie of
  /// the same name wins.
  public static func header(domain: String, browser: Browser = chrome, password: String? = nil) throws -> String {
    let base = URL(fileURLWithPath: (browser.dataDir as NSString).expandingTildeInPath, isDirectory: true)
    guard FileManager.default.fileExists(atPath: base.path) else { throw CookieError.notInstalled(browser.name) }
    let pw = try password ?? keychainPassword(browser)
    let key = deriveKey(password: pw)
    let host = domain.hasPrefix(".") ? String(domain.dropFirst()) : domain

    var pairs: [(String, String)] = []
    var seen = Set<String>()
    for db in cookieDatabases(base) {
      guard let rows = try? readRows(dbPath: db.path, like: "%" + registrable(host)) else { continue }
      for r in rows where hostMatches(target: host, cookieDomain: r.host) {
        guard let value = decrypt(r.enc, key: key, host: r.host), !value.isEmpty else { continue }
        if seen.insert(r.name).inserted { pairs.append((r.name, value)) }
        else if let i = pairs.firstIndex(where: { $0.0 == r.name }) { pairs[i].1 = value }
      }
    }
    guard !pairs.isEmpty else { throw CookieError.noCookies(domain) }
    return pairs.map { "\($0.0)=\($0.1)" }.joined(separator: "; ")
  }

  /// The last two labels, e.g. "ai-coding.bilibili.co" → "bilibili.co": a selective SQL prefix.
  static func registrable(_ host: String) -> String {
    let parts = host.split(separator: ".")
    return parts.count <= 2 ? host : parts.suffix(2).joined(separator: ".")
  }

  /// Does a cookie for `cookieDomain` (as stored in host_key) apply to `target`? A host cookie
  /// matches the exact host; a domain cookie (host_key begins ".") matches the host and below.
  static func hostMatches(target: String, cookieDomain: String) -> Bool {
    let d = cookieDomain.hasPrefix(".") ? String(cookieDomain.dropFirst()) : cookieDomain
    return !d.isEmpty && (target == d || target.hasSuffix("." + d))
  }

  // MARK: - Keychain

  static func keychainPassword(_ b: Browser) throws -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/security")
    p.arguments = ["find-generic-password", "-w", "-s", b.keychainService, "-a", b.keychainAccount]
    let out = Pipe()
    p.standardOutput = out
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { throw CookieError.noKeychainKey(b.name) }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    let pw = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    guard p.terminationStatus == 0, !pw.isEmpty else { throw CookieError.noKeychainKey(b.name) }
    return pw
  }

  // MARK: - Key and decryption

  /// PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16 bytes) — Chromium's scheme on macOS.
  static func deriveKey(password: String) -> Data {
    let salt = Array("saltysalt".utf8)
    let pw = Array(password.utf8)
    var out = [UInt8](repeating: 0, count: 16)
    _ = out.withUnsafeMutableBufferPointer { o in
      salt.withUnsafeBufferPointer { s in
        CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2), password, pw.count, s.baseAddress, s.count,
                             CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), 1003, o.baseAddress, o.count)
      }
    }
    return Data(out)
  }

  /// One encrypted_value → its text. "v10"/"v11" prefix dropped; AES-128-CBC with a 16-space IV;
  /// a 32-byte SHA256(host) prefix (newer Chrome) dropped when present.
  static func decrypt(_ enc: Data, key: Data, host: String) -> String? {
    guard enc.count > 3 else {
      // Not encrypted (rare): plain bytes.
      return enc.isEmpty ? nil : String(data: enc, encoding: .utf8)
    }
    let prefix = String(decoding: enc.prefix(3), as: UTF8.self)
    let body = (prefix == "v10" || prefix == "v11") ? Data(enc.dropFirst(3)) : enc
    guard body.count >= kCCBlockSizeAES128, body.count % kCCBlockSizeAES128 == 0 else { return nil }

    let iv = [UInt8](repeating: 0x20, count: kCCBlockSizeAES128)
    var out = [UInt8](repeating: 0, count: body.count + kCCBlockSizeAES128)
    var moved = 0
    let status = body.withUnsafeBytes { in_ in
      key.withUnsafeBytes { k in
        out.withUnsafeMutableBufferPointer { o in
          CCCrypt(CCOperation(kCCDecrypt), CCAlgorithm(kCCAlgorithmAES), CCOptions(kCCOptionPKCS7Padding),
                  k.baseAddress, k.count, iv, in_.baseAddress, in_.count, o.baseAddress, o.count, &moved)
        }
      }
    }
    guard status == kCCSuccess else { return nil }
    var plain = Data(out.prefix(moved))
    // Newer Chrome prepends SHA256 of the host.
    if plain.count >= 32 {
      let hash = Data(SHA256.hash(data: Data(host.utf8)))
      if plain.prefix(32) == hash { plain = plain.dropFirst(32) }
    }
    return String(data: plain, encoding: .utf8)
  }

  // MARK: - Finding and reading the SQLite stores

  /// Every "Cookies" file under the data directory (one per profile), in name order ("Default",
  /// then "Profile 1", …): the directory listing itself comes in no set order.
  static func cookieDatabases(_ base: URL) -> [URL] {
    let fm = FileManager.default
    var dbs: [URL] = []
    let direct = base.appendingPathComponent("Cookies")
    if fm.fileExists(atPath: direct.path) { dbs.append(direct) }
    let subs = ((try? fm.contentsOfDirectory(at: base, includingPropertiesForKeys: nil)) ?? [])
      .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
    for sub in subs {
      let c = sub.appendingPathComponent("Cookies")
      if fm.fileExists(atPath: c.path) { dbs.append(c) }
    }
    return dbs
  }

  struct Row { var host: String; var name: String; var enc: Data }

  /// Reads (host_key, name, encrypted_value) for host_keys matching the SQL `like` pattern.
  /// The live file is copied first (Chrome keeps it locked) and opened read-only.
  static func readRows(dbPath: String, like: String) throws -> [Row] {
    let fm = FileManager.default
    let tmp = fm.temporaryDirectory.appendingPathComponent("qb-cookies-" + UUID().uuidString)
    try? fm.createDirectory(at: tmp, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: tmp) }
    let copy = tmp.appendingPathComponent("Cookies")
    for ext in ["", "-wal", "-shm"] {
      let from = URL(fileURLWithPath: dbPath + ext)
      if fm.fileExists(atPath: from.path) { try? fm.copyItem(at: from, to: tmp.appendingPathComponent("Cookies" + ext)) }
    }
    guard fm.fileExists(atPath: copy.path) else { throw CookieError.database("无法复制") }

    var db: OpaquePointer?
    guard sqlite3_open_v2(copy.path, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK, let db else {
      let m = db.map { String(cString: sqlite3_errmsg($0)) } ?? "打开失败"
      sqlite3_close(db)
      throw CookieError.database(m)
    }
    defer { sqlite3_close(db) }

    var stmt: OpaquePointer?
    let sql = "SELECT host_key, name, encrypted_value FROM cookies WHERE host_key LIKE ?"
    guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
      throw CookieError.database(String(cString: sqlite3_errmsg(db)))
    }
    defer { sqlite3_finalize(stmt) }
    let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    sqlite3_bind_text(stmt, 1, like, -1, transient)

    var rows: [Row] = []
    while sqlite3_step(stmt) == SQLITE_ROW {
      let host = sqlite3_column_text(stmt, 0).map { String(cString: $0) } ?? ""
      let name = sqlite3_column_text(stmt, 1).map { String(cString: $0) } ?? ""
      let n = Int(sqlite3_column_bytes(stmt, 2))
      let enc = sqlite3_column_blob(stmt, 2).map { Data(bytes: $0, count: n) } ?? Data()
      if !name.isEmpty { rows.append(Row(host: host, name: name, enc: enc)) }
    }
    return rows
  }
}
