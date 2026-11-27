// Prompt-cache hits and speed per gateway and model over the last 24 hours. The forwarder reads
// the token usage of each /v1/messages reply as it passes it on (UsageTap: the reply itself goes
// on as it came, untouched), and adds it here, in 10-minute buckets. Anthropic's usage counts
// input in three parts: read from the cache (cache_read_input_tokens), written to it
// (cache_creation_input_tokens), and neither (input_tokens); the hit rate is the part read.
// A streamed reply is also timed (ReplySpeed): to its first token, and its tokens after that.
import Compression
import Foundation

/// How fast one streamed reply came, as the forwarder saw it: from the request sent on to the
/// gateway to the first token (the first content_block_delta: text, thinking or a tool's input),
/// then the rest of its output up to the last one.
public struct ReplySpeed: Codable, Equatable, Sendable {
  /// To the first token (ms).
  public var firstToken: Int
  /// The output tokens after the first (0: nothing to time: one token, or all in one piece).
  public var decodeTokens: Int
  /// From the first token to the last (ms).
  public var decodeMs: Int

  public init(firstToken: Int, decodeTokens: Int = 0, decodeMs: Int = 0) {
    self.firstToken = firstToken
    // Both or neither: a time of 0 ms, or no tokens in it, can't give a speed.
    let timed = decodeTokens > 0 && decodeMs > 0
    self.decodeTokens = timed ? decodeTokens : 0
    self.decodeMs = timed ? decodeMs : 0
  }

  /// Output tokens per second after the first token (nil: nothing to time).
  public var tokensPerSecond: Double? { CacheStats.speed(tokens: decodeTokens, ms: decodeMs) }
}

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
  /// Each streamed reply's time to its first token (ms), in the order they came.
  public var firstToken: [Int] = []
  /// The streamed replies' tokens after the first, and the time they took (ms), added up.
  public var decodeTokens = 0
  public var decodeMs = 0

  public init(gateway: String, model: String, start: Date, requests: Int, usage: CacheUsage, firstToken: [Int] = [], decodeTokens: Int = 0, decodeMs: Int = 0) {
    self.gateway = gateway
    self.model = model
    self.start = start
    self.requests = requests
    self.usage = usage
    self.firstToken = firstToken
    self.decodeTokens = decodeTokens
    self.decodeMs = decodeMs
  }

  // A file from before the speeds were kept has none: they start empty.
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    gateway = try c.decode(String.self, forKey: .gateway)
    model = try c.decode(String.self, forKey: .model)
    start = try c.decode(Date.self, forKey: .start)
    requests = try c.decode(Int.self, forKey: .requests)
    usage = try c.decode(CacheUsage.self, forKey: .usage)
    firstToken = try c.decodeIfPresent([Int].self, forKey: .firstToken) ?? []
    decodeTokens = try c.decodeIfPresent(Int.self, forKey: .decodeTokens) ?? 0
    decodeMs = try c.decodeIfPresent(Int.self, forKey: .decodeMs) ?? 0
  }

  mutating func add(_ s: ReplySpeed) {
    firstToken.append(s.firstToken)
    decodeTokens += s.decodeTokens
    decodeMs += s.decodeMs
  }
}

/// A gateway and model over the time asked for: its replies, their tokens and speeds added up.
public struct CacheRow: Equatable, Sendable, Identifiable {
  public var gateway: String
  public var model: String
  public var requests: Int
  public var usage: CacheUsage
  /// The streamed replies' times to their first token (ms), shortest first.
  public var firstToken: [Int] = []
  public var decodeTokens = 0
  public var decodeMs = 0
  public var id: String { gateway + "\n" + model }

  /// How many replies were timed (the streamed ones).
  public var streamed: Int { firstToken.count }
  /// The time to the first token that `p` of the streamed replies (0.5, 0.9, 0.99) got within (ms).
  public func firstToken(_ p: Double) -> Int? { CacheStats.percentile(firstToken, p) }
  /// Output tokens per second after the first token, all the streamed replies' tokens over all
  /// their time (so a long reply counts for more than a short one).
  public var tokensPerSecond: Double? { CacheStats.speed(tokens: decodeTokens, ms: decodeMs) }
}

/// One hour of a gateway and model: its hit rate (nil: no input that hour), the time to the first
/// token 99 % of its streamed replies got within (ms), and their speed after it (nil: none).
public struct HourPoint: Equatable, Sendable, Identifiable {
  public var start: Date
  public var rate: Double?
  public var firstToken99: Int?
  public var tokensPerSecond: Double?
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

  /// A reply's usage (and with `speed`, how fast it streamed), from `gateway` for `model`, at `at`.
  public func add(gateway: String, model: String, usage: CacheUsage, speed: ReplySpeed? = nil, at: Date = Date()) {
    let start = Date(timeIntervalSince1970: (at.timeIntervalSince1970 / Self.bucket).rounded(.down) * Self.bucket)
    lock.lock()
    defer { lock.unlock() }
    let i = buckets.lastIndex(where: { $0.start == start && $0.gateway == gateway && $0.model == model }) ?? {
      buckets.append(CacheBucket(gateway: gateway, model: model, start: start, requests: 0, usage: CacheUsage()))
      return buckets.count - 1
    }()
    buckets[i].requests += 1
    buckets[i].usage = buckets[i].usage + usage
    if let speed { buckets[i].add(speed) }
    prune(at)
    version += 1
  }

  /// The value `p` (0.5, 0.99) of `sorted` is the smallest value at least that part of them are
  /// within (nearest rank: with fewer than 100, the 99th is the largest); nil: none.
  public static func percentile(_ sorted: [Int], _ p: Double) -> Int? {
    guard !sorted.isEmpty else { return nil }
    let rank = Int((p * Double(sorted.count)).rounded(.up))
    return sorted[min(max(rank, 1), sorted.count) - 1]
  }

  /// Tokens per second (nil: no time, or no tokens, to go by).
  public static func speed(tokens: Int, ms: Int) -> Double? {
    tokens > 0 && ms > 0 ? Double(tokens) * 1000 / Double(ms) : nil
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
      r.firstToken += b.firstToken
      r.decodeTokens += b.decodeTokens
      r.decodeMs += b.decodeMs
      rows[id] = r
    }
    return rows.values
      .map { var r = $0; r.firstToken.sort(); return r }
      .sorted { ($0.requests, $1.id) > ($1.requests, $0.id) }
  }

  /// One gateway and model by the hour, the 24 hours up to `now`: each hour's start, its hit rate,
  /// the time to the first token 99 % of its streamed replies got within, and their speed after it.
  public static func hourly(_ buckets: [CacheBucket], gateway: String, model: String, now: Date = Date()) -> [HourPoint] {
    let hour = 3600.0
    let last = (now.timeIntervalSince1970 / hour).rounded(.down) * hour
    var sums = [CacheBucket](repeating: CacheBucket(gateway: gateway, model: model, start: Date(), requests: 0, usage: CacheUsage()), count: 24)
    for b in buckets where b.gateway == gateway && b.model == model {
      let i = 23 - Int(((last - (b.start.timeIntervalSince1970 / hour).rounded(.down) * hour) / hour).rounded())
      guard sums.indices.contains(i) else { continue }
      sums[i].usage = sums[i].usage + b.usage
      sums[i].firstToken += b.firstToken
      sums[i].decodeTokens += b.decodeTokens
      sums[i].decodeMs += b.decodeMs
    }
    return sums.enumerated().map { i, s in
      HourPoint(start: Date(timeIntervalSince1970: last - Double(23 - i) * hour), rate: s.usage.hitRate,
                firstToken99: percentile(s.firstToken.sorted(), 0.99), tokensPerSecond: speed(tokens: s.decodeTokens, ms: s.decodeMs))
    }
  }
}

/// Reads the usage of one reply as the forwarder passes it on: its head, then its body as it comes,
/// each piece with when it came (the reply itself goes on untouched). At the end, the usage it
/// said, if it is an Anthropic Messages reply that says one: a stream (message_start,
/// message_delta) or one JSON object; chunked, gzip, deflate or br. A stream is timed too, by the
/// pieces that held its first and its last content_block_delta. Used on the forwarder's queue only.
public final class UsageTap: @unchecked Sendable {
  /// What a reply said: its usage, and for a stream, how fast it came.
  public struct Reading: Equatable, Sendable {
    public var usage: CacheUsage
    public var speed: ReplySpeed?
  }

  /// Whose reply: the gateway's name and the model it went as.
  public let gateway: String
  public let model: String
  /// At most this much of a body is kept (a longer one isn't read).
  public static let limit = 32 * 1024 * 1024

  /// A steady clock (seconds; not set back with the time of day), for the times here.
  public static func clock() -> TimeInterval { ProcessInfo.processInfo.systemUptime }

  /// When the request was sent on to the gateway (by `clock`).
  private let start: TimeInterval
  private var status = 0
  private var chunked = false
  private var encoding: String?
  private var body = Data()
  /// Where each piece of the body ends in it, and when it came.
  private var pieces: [(end: Int, at: TimeInterval)] = []
  private var tooLong = false
  private var done = false

  public init(gateway: String, model: String, start: TimeInterval = UsageTap.clock()) {
    self.gateway = gateway
    self.model = model
    self.start = start
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

  /// More of the body, come at `at` (by `clock`).
  public func body(_ d: Data?, at: TimeInterval = UsageTap.clock()) {
    guard let d, !d.isEmpty, !tooLong else { return }
    if body.count + d.count > Self.limit {
      tooLong = true
      body = Data()
      pieces = []
    } else {
      body.append(d)
      pieces.append((body.count, at))
    }
  }

  /// What the reply said, once (nil: no usage said, not a success, or asked before).
  public func finish() -> Reading? {
    guard !done else { return nil }
    done = true
    guard (200..<300).contains(status), !tooLong, !body.isEmpty else { return nil }
    // The body as it was before the framing and the encoding, and where each piece ends in it.
    var (d, ends) = chunked ? Self.dechunk(body, marks: pieces.map(\.end)) : (body, pieces.map(\.end))
    if let e = encoding, e != "identity" {
      guard let plain = Self.decode(d, e, marks: ends) else { return nil }
      (d, ends) = plain
    }
    let said = Self.read(d)
    guard let usage = said.usage else { return nil }
    return Reading(usage: usage, speed: speed(said, usage, ends))
  }

  /// A stream's speed: to the piece that held its first token, and from there to the piece that
  /// held its last (nil: not a stream, or no token in it).
  private func speed(_ said: Said, _ usage: CacheUsage, _ ends: [Int]) -> ReplySpeed? {
    // When the body up to `offset` had come: the first piece that reached it.
    func came(_ offset: Int) -> TimeInterval? { zip(ends, pieces).first { $0.0 >= offset }?.1.at }
    guard let first = said.firstDelta, let last = said.lastDelta, let t0 = came(first), let t1 = came(last) else { return nil }
    let ms = { (s: TimeInterval) in Int((max(0, s) * 1000).rounded()) }
    return ReplySpeed(firstToken: ms(t0 - start), decodeTokens: usage.output - 1, decodeMs: ms(t1 - t0))
  }

  /// The usage a reply's body says: a stream's message_start and message_delta (the later
  /// counts for each field it has), or the "usage" of one JSON object.
  public static func usage(in body: Data) -> CacheUsage? { read(body).usage }

  /// What a body says: its usage, and in a stream, where its first and its last
  /// content_block_delta end (offsets in the body).
  struct Said {
    var usage: CacheUsage?
    var firstDelta: Int?
    var lastDelta: Int?
  }

  static func read(_ body: Data) -> Said {
    var fields: [String: Int] = [:]
    func take(_ u: Any?) {
      guard let u = u as? [String: Any] else { return }
      for k in ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"] {
        if let n = u[k] as? Int { fields[k] = n }
      }
    }
    var said = Said()
    var stream = false
    let b = [UInt8](body)
    let data = Array("data:".utf8)
    var i = 0
    // Line by line (to \n or \r): each "data:" line one event.
    while i < b.count {
      var j = i
      while j < b.count && b[j] != 10 && b[j] != 13 { j += 1 }
      if j - i >= data.count && b[i..<(i + data.count)].elementsEqual(data) {
        stream = true
        if let o = try? JSONSerialization.jsonObject(with: Data(b[(i + data.count)..<j])) as? [String: Any] {
          switch o["type"] as? String {
          case "message_start": take((o["message"] as? [String: Any])?["usage"])
          case "message_delta": take(o["usage"])
          case "content_block_delta":
            if said.firstDelta == nil { said.firstDelta = j }
            said.lastDelta = j
          default: break
          }
        }
      }
      i = j + 1
    }
    if !stream, let o = try? JSONSerialization.jsonObject(with: body) as? [String: Any] {
      take(o["usage"])
    }
    if let input = fields["input_tokens"] {
      said.usage = CacheUsage(input: input, cacheRead: fields["cache_read_input_tokens"] ?? 0, cacheWrite: fields["cache_creation_input_tokens"] ?? 0, output: fields["output_tokens"] ?? 0)
    }
    return said
  }

  /// A chunked body's data, its chunks put together (as far as it goes), and where each of
  /// `marks` (offsets in `d`, in order) falls in it.
  static func dechunk(_ d: Data, marks: [Int] = []) -> (data: Data, marks: [Int]) {
    let b = [UInt8](d)
    var out = [UInt8]()
    // Each chunk's data: where it starts in `d`, where in `out`, and how much of it there is.
    var runs: [(from: Int, to: Int, size: Int)] = []
    var i = 0
    while i < b.count {
      guard let eol = (i..<(b.count - 1)).first(where: { b[$0] == 13 && b[$0 + 1] == 10 }) else { break }
      let line = String(decoding: b[i..<eol], as: UTF8.self)
      guard let size = Int(line.split(separator: ";").first?.trimmingCharacters(in: .whitespaces) ?? "", radix: 16), size >= 0 else { break }
      if size == 0 { break }
      let start = eol + 2
      let end = min(b.count, start + size)
      runs.append((start, out.count, end - start))
      out.append(contentsOf: b[start..<end])
      i = start + size + 2
    }
    var k = 0
    let mapped = marks.map { m -> Int in
      while k + 1 < runs.count && runs[k + 1].from <= m { k += 1 }
      guard k < runs.count, runs[k].from <= m else { return 0 }
      return runs[k].to + min(m - runs[k].from, runs[k].size)
    }
    return (Data(out), mapped)
  }

  /// A body as sent with Content-Encoding `encoding` (gzip, deflate, br), decoded, and where each
  /// of `marks` (offsets in `d`, in order) falls in it; nil if it can't be.
  static func decode(_ d: Data, _ encoding: String, marks: [Int] = []) -> (data: Data, marks: [Int])? {
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
      return inflate(Data(b[i...]), COMPRESSION_ZLIB, marks: marks.map { $0 - i })
    case "deflate":
      // Usually zlib-wrapped (a 2-byte header); sometimes raw.
      let wrapped = b.count > 2 && b[0] & 0x0F == 8 && (Int(b[0]) << 8 | Int(b[1])) % 31 == 0
      return wrapped ? inflate(Data(b[2...]), COMPRESSION_ZLIB, marks: marks.map { $0 - 2 }) : inflate(d, COMPRESSION_ZLIB, marks: marks)
    case "br":
      return inflate(d, COMPRESSION_BROTLI, marks: marks)
    default:
      return nil
    }
  }

  /// `d` decompressed with `algorithm`, as far as it goes (a stream cut short gives what came),
  /// put in piece by piece as `marks` (offsets in `d`, in order) cut it: with, for each mark, how
  /// much had come out once `d` up to it was in. nil if nothing could be.
  static func inflate(_ d: Data, _ algorithm: compression_algorithm, marks: [Int] = []) -> (data: Data, marks: [Int])? {
    let size = 64 * 1024
    let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
    let s = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    defer {
      dst.deallocate()
      s.deallocate()
    }
    guard compression_stream_init(s, COMPRESSION_STREAM_DECODE, algorithm) == COMPRESSION_STATUS_OK else { return nil }
    defer { compression_stream_destroy(s) }
    let cuts = marks.map { min(max($0, 0), d.count) }
    var out = Data()
    var made: [Int] = []
    var tooBig = false
    d.withUnsafeBytes { raw in
      guard let src = raw.bindMemory(to: UInt8.self).baseAddress else { return }
      var fed = 0
      // Ended, broken, or too big: what came out so far is all there is.
      var stopped = false
      // Each piece as it came, then the end.
      for (n, cut) in (cuts + [d.count]).enumerated() {
        let last = n == cuts.count
        if !stopped {
          s.pointee.src_ptr = src + fed
          s.pointee.src_size = max(0, cut - fed)
          fed = max(fed, cut)
          while true {
            let left = s.pointee.src_size
            s.pointee.dst_ptr = dst
            s.pointee.dst_size = size
            let st = compression_stream_process(s, last ? Int32(bitPattern: COMPRESSION_STREAM_FINALIZE.rawValue) : 0)
            let got = size - s.pointee.dst_size
            out.append(dst, count: got)
            if out.count > UsageTap.limit { tooBig = true }
            if tooBig || st != COMPRESSION_STATUS_OK { stopped = true; break }
            // The piece is all in and all it gives is out (or nothing moved: a stream cut short).
            if s.pointee.src_size == 0 && got < size { break }
            if got == 0 && s.pointee.src_size == left { break }
          }
        }
        if !last { made.append(out.count) }
      }
    }
    return tooBig || out.isEmpty ? nil : (out, made)
  }
}
