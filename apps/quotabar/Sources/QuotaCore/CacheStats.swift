// Prompt-cache hits per gateway and model over the last 24 hours. The forwarder reads the token
// usage of each /v1/messages reply as it passes it on (UsageTap: the reply itself goes on as it
// came, untouched), and adds it here, in 10-minute buckets. Anthropic's usage counts input in
// three parts: read from the cache (cache_read_input_tokens), written to it
// (cache_creation_input_tokens), and neither (input_tokens); the hit rate is the part read.
import Compression
import Foundation

/// The tokens of one reply (or of many, added up).
public struct CacheUsage: Codable, Equatable, Sendable {
  /// Input neither read from the cache nor written to it.
  public var input = 0
  public var cacheRead = 0
  public var cacheWrite = 0
  public var output = 0

  public init(input: Int = 0, cacheRead: Int = 0, cacheWrite: Int = 0, output: Int = 0) {
    self.input = input
    self.cacheRead = cacheRead
    self.cacheWrite = cacheWrite
    self.output = output
  }

  /// All the input: read, written, and neither.
  public var allInput: Int { input + cacheRead + cacheWrite }
  /// The part of the input read from the cache (nil: no input).
  public var hitRate: Double? { allInput > 0 ? Double(cacheRead) / Double(allInput) : nil }

  public static func + (a: CacheUsage, b: CacheUsage) -> CacheUsage {
    CacheUsage(input: a.input + b.input, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output)
  }
}

/// The replies of one gateway and model in one 10-minute stretch.
public struct CacheBucket: Codable, Equatable, Sendable {
  public var gateway: String
  public var model: String
  /// Where the stretch starts.
  public var start: Date
  public var requests: Int
  public var usage: CacheUsage
}

/// A gateway and model over the time asked for: its replies, their tokens added up.
public struct CacheRow: Equatable, Sendable, Identifiable {
  public var gateway: String
  public var model: String
  public var requests: Int
  public var usage: CacheUsage
  public var id: String { gateway + "\n" + model }
}

/// One hour's hit rate (nil: no input that hour).
public struct HourRate: Equatable, Sendable, Identifiable {
  public var start: Date
  public var rate: Double?
  public var id: Date { start }
}

public final class CacheStats: @unchecked Sendable {
  /// How long buckets are kept (seconds).
  public static let keep: TimeInterval = 24 * 3600
  /// How long one bucket is (seconds).
  public static let bucket: TimeInterval = 600

  private let lock = NSLock()
  private var buckets: [CacheBucket]
  /// Goes up with each change (so that the app writes the file only when something changed).
  public private(set) var version = 0

  public init(buckets: [CacheBucket] = []) {
    self.buckets = buckets
  }

  /// A reply's usage, from `gateway` for `model`, at `at`.
  public func add(gateway: String, model: String, usage: CacheUsage, at: Date = Date()) {
    let start = Date(timeIntervalSince1970: (at.timeIntervalSince1970 / Self.bucket).rounded(.down) * Self.bucket)
    lock.lock()
    defer { lock.unlock() }
    if let i = buckets.lastIndex(where: { $0.start == start && $0.gateway == gateway && $0.model == model }) {
      buckets[i].requests += 1
      buckets[i].usage = buckets[i].usage + usage
    } else {
      buckets.append(CacheBucket(gateway: gateway, model: model, start: start, requests: 1, usage: usage))
    }
    prune(at)
    version += 1
  }

  /// The buckets of the last 24 hours, oldest first.
  public func snapshot(now: Date = Date()) -> [CacheBucket] {
    lock.lock()
    defer { lock.unlock() }
    prune(now)
    return buckets
  }

  private func prune(_ now: Date) {
    let before = buckets.count
    buckets.removeAll { now.timeIntervalSince($0.start) > Self.keep }
    if buckets.count != before { version += 1 }
  }

  /// Each gateway and model, its buckets added up; the most used first.
  public static func rows(_ buckets: [CacheBucket]) -> [CacheRow] {
    var rows: [String: CacheRow] = [:]
    for b in buckets {
      let id = b.gateway + "\n" + b.model
      var r = rows[id] ?? CacheRow(gateway: b.gateway, model: b.model, requests: 0, usage: CacheUsage())
      r.requests += b.requests
      r.usage = r.usage + b.usage
      rows[id] = r
    }
    return rows.values.sorted { ($0.requests, $1.id) > ($1.requests, $0.id) }
  }

  /// One gateway and model by the hour, the 24 hours up to `now`: each hour's start and its hit
  /// rate (nil: no input that hour).
  public static func hourly(_ buckets: [CacheBucket], gateway: String, model: String, now: Date = Date()) -> [HourRate] {
    let hour = 3600.0
    let last = (now.timeIntervalSince1970 / hour).rounded(.down) * hour
    var sums = [CacheUsage](repeating: CacheUsage(), count: 24)
    for b in buckets where b.gateway == gateway && b.model == model {
      let i = 23 - Int(((last - (b.start.timeIntervalSince1970 / hour).rounded(.down) * hour) / hour).rounded())
      if sums.indices.contains(i) { sums[i] = sums[i] + b.usage }
    }
    return sums.enumerated().map { HourRate(start: Date(timeIntervalSince1970: last - Double(23 - $0.offset) * hour), rate: $0.element.hitRate) }
  }
}

/// Reads the usage of one reply as the forwarder passes it on: its head, then its body as it comes
/// (the reply itself goes on untouched). At the end, the usage it said, if it is an Anthropic
/// Messages reply that says one: a stream (message_start, message_delta) or one JSON object;
/// chunked, gzip, deflate or br. Used on the forwarder's queue only.
public final class UsageTap: @unchecked Sendable {
  /// Whose reply: the gateway's name and the model it went as.
  public let gateway: String
  public let model: String
  /// At most this much of a body is kept (a longer one isn't read).
  public static let limit = 32 * 1024 * 1024

  private var status = 0
  private var chunked = false
  private var encoding: String?
  private var body = Data()
  private var tooLong = false
  private var done = false

  public init(gateway: String, model: String) {
    self.gateway = gateway
    self.model = model
  }

  /// The reply's head (status line and headers).
  public func head(_ head: String) {
    let lines = head.components(separatedBy: "\r\n")
    status = Int(lines.first?.split(separator: " ").dropFirst().first ?? "") ?? 0
    for l in lines.dropFirst() {
      let kv = l.split(separator: ":", maxSplits: 1)
      guard kv.count == 2 else { continue }
      let name = kv[0].trimmingCharacters(in: .whitespaces).lowercased(), value = kv[1].trimmingCharacters(in: .whitespaces).lowercased()
      if name == "transfer-encoding" { chunked = value.contains("chunked") }
      if name == "content-encoding" { encoding = value }
    }
  }

  /// More of the body.
  public func body(_ d: Data?) {
    guard let d, !tooLong else { return }
    if body.count + d.count > Self.limit {
      tooLong = true
      body = Data()
    } else {
      body.append(d)
    }
  }

  /// The usage, once (nil: none said, not a success, or asked before).
  public func finish() -> CacheUsage? {
    guard !done else { return nil }
    done = true
    guard (200..<300).contains(status), !tooLong, !body.isEmpty else { return nil }
    var d = chunked ? Self.dechunk(body) : body
    if let e = encoding, e != "identity" {
      guard let plain = Self.decode(d, e) else { return nil }
      d = plain
    }
    return Self.usage(in: d)
  }

  /// The usage a reply's body says: a stream's message_start and message_delta (the later
  /// counts for each field it has), or the "usage" of one JSON object.
  public static func usage(in body: Data) -> CacheUsage? {
    let text = String(decoding: body, as: UTF8.self)
    var fields: [String: Int] = [:]
    func take(_ u: Any?) {
      guard let u = u as? [String: Any] else { return }
      for k in ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"] {
        if let n = u[k] as? Int { fields[k] = n }
      }
    }
    if text.contains("data:") {
      for line in text.split(whereSeparator: \.isNewline) where line.hasPrefix("data:") {
        let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard let o = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { continue }
        switch o["type"] as? String {
        case "message_start": take((o["message"] as? [String: Any])?["usage"])
        case "message_delta": take(o["usage"])
        default: break
        }
      }
    } else if let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
      take(o["usage"])
    }
    guard let input = fields["input_tokens"] else { return nil }
    return CacheUsage(input: input, cacheRead: fields["cache_read_input_tokens"] ?? 0, cacheWrite: fields["cache_creation_input_tokens"] ?? 0, output: fields["output_tokens"] ?? 0)
  }

  /// A chunked body's data, its chunks put together (as far as it goes).
  static func dechunk(_ d: Data) -> Data {
    let b = [UInt8](d)
    var out = [UInt8]()
    var i = 0
    while i < b.count {
      guard let eol = (i..<(b.count - 1)).first(where: { b[$0] == 13 && b[$0 + 1] == 10 }) else { break }
      let line = String(decoding: b[i..<eol], as: UTF8.self)
      guard let size = Int(line.split(separator: ";").first?.trimmingCharacters(in: .whitespaces) ?? "", radix: 16), size >= 0 else { break }
      if size == 0 { break }
      let start = eol + 2
      out.append(contentsOf: b[start..<min(b.count, start + size)])
      i = start + size + 2
    }
    return Data(out)
  }

  /// A body as sent with Content-Encoding `encoding` (gzip, deflate, br), decoded; nil if it can't be.
  static func decode(_ d: Data, _ encoding: String) -> Data? {
    let b = [UInt8](d)
    switch encoding {
    case "gzip", "x-gzip":
      // The header (RFC 1952), then raw DEFLATE (Apple's "zlib"); the trailer is not needed.
      guard b.count > 18, b[0] == 0x1F, b[1] == 0x8B, b[2] == 8 else { return nil }
      let flags = b[3]
      var i = 10
      if flags & 4 != 0, i + 2 <= b.count { i += 2 + Int(b[i]) + Int(b[i + 1]) << 8 }
      if flags & 8 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
      if flags & 16 != 0 { while i < b.count && b[i] != 0 { i += 1 }; i += 1 }
      if flags & 2 != 0 { i += 2 }
      guard i < b.count else { return nil }
      return inflate(Data(b[i...]), COMPRESSION_ZLIB)
    case "deflate":
      // Usually zlib-wrapped (a 2-byte header); sometimes raw.
      let wrapped = b.count > 2 && b[0] & 0x0F == 8 && (Int(b[0]) << 8 | Int(b[1])) % 31 == 0
      return inflate(wrapped ? Data(b[2...]) : d, COMPRESSION_ZLIB)
    case "br":
      return inflate(d, COMPRESSION_BROTLI)
    default:
      return nil
    }
  }

  /// `d` decompressed with `algorithm`, as far as it goes (a stream cut short gives what came);
  /// nil if nothing could be.
  static func inflate(_ d: Data, _ algorithm: compression_algorithm) -> Data? {
    let size = 64 * 1024
    let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
    let s = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    defer {
      dst.deallocate()
      s.deallocate()
    }
    guard compression_stream_init(s, COMPRESSION_STREAM_DECODE, algorithm) == COMPRESSION_STATUS_OK else { return nil }
    defer { compression_stream_destroy(s) }
    var out = Data()
    let ok: Bool = d.withUnsafeBytes { raw in
      guard let src = raw.bindMemory(to: UInt8.self).baseAddress else { return false }
      s.pointee.src_ptr = src
      s.pointee.src_size = d.count
      while true {
        s.pointee.dst_ptr = dst
        s.pointee.dst_size = size
        let st = compression_stream_process(s, Int32(bitPattern: COMPRESSION_STREAM_FINALIZE.rawValue))
        let made = size - s.pointee.dst_size
        out.append(dst, count: made)
        if st == COMPRESSION_STATUS_END { return true }
        if st != COMPRESSION_STATUS_OK { return !out.isEmpty }
        if made == 0 && s.pointee.src_size == 0 { return !out.isEmpty }
        if out.count > UsageTap.limit { return false }
      }
    }
    return ok ? out : nil
  }
}
