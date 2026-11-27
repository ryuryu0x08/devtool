import Foundation
import XCTest
@testable import QuotaCore

final class CacheStatsTests: XCTestCase {
  private let start = #"{"type":"message_start","message":{"id":"m","usage":{"input_tokens":12,"cache_read_input_tokens":900,"cache_creation_input_tokens":88,"output_tokens":1}}}"#
  private let delta = #"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":321}}"#
  private var stream: String { "event: message_start\ndata: \(start)\n\nevent: ping\ndata: {\"type\":\"ping\"}\n\nevent: message_delta\ndata: \(delta)\n\n" }
  private let want = CacheUsage(input: 12, cacheRead: 900, cacheWrite: 88, output: 321)

  private func tap(_ head: String, _ parts: [Data]) -> CacheUsage? {
    let t = UsageTap(gateway: "g", model: "m")
    t.head(head)
    parts.forEach { t.body($0) }
    return t.finish()?.usage
  }

  func testAStreamsUsageFromItsStartAndItsLastDelta() {
    let d = Data(stream.utf8)
    // In pieces cut anywhere.
    XCTAssertEqual(tap("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream", [d.prefix(37), d.dropFirst(37)]), want)
    XCTAssertEqual(UsageTap.usage(in: d)?.hitRate ?? 0, 0.9, accuracy: 0.0001)
  }

  func testAJSONRepliesUsage() {
    let body = #"{"type":"message","content":[],"usage":{"input_tokens":3,"cache_read_input_tokens":7,"output_tokens":5}}"#
    XCTAssertEqual(tap("HTTP/1.1 200 OK", [Data(body.utf8)]), CacheUsage(input: 3, cacheRead: 7, cacheWrite: 0, output: 5))
  }

  func testChunkedAndGzipped() throws {
    // Chunked: sizes in hex, an extension, then the end.
    let s = Data(stream.utf8)
    var chunked = Data()
    for part in [s.prefix(100), s.dropFirst(100)] {
      chunked.append(Data((String(part.count, radix: 16) + ";x=1\r\n").utf8))
      chunked.append(part)
      chunked.append(Data("\r\n".utf8))
    }
    chunked.append(Data("0\r\n\r\n".utf8))
    XCTAssertEqual(tap("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked", [chunked]), want)
    // gzip: a header, raw DEFLATE, a trailer.
    let deflated = try (s as NSData).compressed(using: .zlib) as Data
    let gz = Data([0x1F, 0x8B, 8, 0, 0, 0, 0, 0, 0, 3]) + deflated + Data(count: 8)
    XCTAssertEqual(tap("HTTP/1.1 200 OK\r\nContent-Encoding: gzip", [gz]), want)
    // Both.
    let gzChunked = Data((String(gz.count, radix: 16) + "\r\n").utf8) + gz + Data("\r\n0\r\n\r\n".utf8)
    XCTAssertEqual(tap("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip", [gzChunked]), want)
    // deflate, zlib-wrapped.
    XCTAssertEqual(tap("HTTP/1.1 200 OK\r\nContent-Encoding: deflate", [Data([0x78, 0x9C]) + deflated]), want)
  }

  func testNoUsageNoSuccessOrOnceOnly() {
    XCTAssertNil(tap("HTTP/1.1 200 OK", [Data(#"{"ok":true}"#.utf8)]))
    XCTAssertNil(tap("HTTP/1.1 529 Overloaded", [Data(stream.utf8)]))
    XCTAssertNil(tap("HTTP/1.1 200 OK\r\nContent-Encoding: zstd", [Data(stream.utf8)]))
    let t = UsageTap(gateway: "g", model: "m")
    t.head("HTTP/1.1 200 OK")
    t.body(Data(stream.utf8))
    XCTAssertEqual(t.finish()?.usage, want)
    XCTAssertNil(t.finish())
    // A stream cut off after its start: what it said by then.
    XCTAssertEqual(UsageTap.usage(in: Data("data: \(start)\n\n".utf8))?.cacheRead, 900)
  }

  func testTenMinuteBucketsKeptForADayAddedUpByGatewayAndModel() {
    let t0 = Date(timeIntervalSince1970: 1_800_000_000) // on a 10-minute mark
    let s = CacheStats()
    s.add(gateway: "公司", model: "a", usage: CacheUsage(input: 10, cacheRead: 90), at: t0)
    s.add(gateway: "公司", model: "a", usage: CacheUsage(input: 50, cacheRead: 50), at: t0.addingTimeInterval(599))
    s.add(gateway: "公司", model: "a", usage: CacheUsage(input: 100), at: t0.addingTimeInterval(600))
    s.add(gateway: "DeepSeek", model: "a", usage: CacheUsage(cacheWrite: 10), at: t0)
    XCTAssertEqual(s.snapshot(now: t0).count, 3)
    let rows = CacheStats.rows(s.snapshot(now: t0))
    XCTAssertEqual(rows.map(\.gateway), ["公司", "DeepSeek"])
    XCTAssertEqual(rows[0].requests, 3)
    XCTAssertEqual(rows[0].usage.hitRate ?? 0, 140.0 / 300.0, accuracy: 0.0001)
    XCTAssertEqual(rows[1].usage.hitRate, 0)
    // By the hour: the last of 24 points is the hour holding t0.
    let h = CacheStats.hourly(s.snapshot(now: t0), gateway: "公司", model: "a", now: t0.addingTimeInterval(700))
    XCTAssertEqual(h.count, 24)
    XCTAssertEqual(h.compactMap(\.rate).count, 1)
    XCTAssertNil(h[0].rate)
    // A day later: gone.
    let v = s.version
    XCTAssertTrue(s.snapshot(now: t0.addingTimeInterval(24 * 3600 + 601)).isEmpty)
    XCTAssertGreaterThan(s.version, v)
    // Kept as JSON and read back.
    let b = CacheStats(buckets: [CacheBucket(gateway: "g", model: "m", start: t0, requests: 2, usage: CacheUsage(input: 1))]).snapshot(now: t0)
    let enc = JSONEncoder(), dec = JSONDecoder()
    enc.dateEncodingStrategy = .secondsSince1970
    dec.dateDecodingStrategy = .secondsSince1970
    XCTAssertEqual(try dec.decode([CacheBucket].self, from: try enc.encode(b)), b)
  }

  // MARK: - Speed

  private func delta(_ text: String) -> String {
    "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"\(text)\"}}\n\n"
  }

  /// A stream in pieces, each with when it came (s after the request went), the first delta cut in two.
  private var timed: [(String, TimeInterval)] {
    let first = delta("Hi")
    let cut = first.index(first.startIndex, offsetBy: 60)
    return [
      ("event: message_start\ndata: \(start)\n\n", 0.3),
      (String(first[..<cut]), 0.5),
      (String(first[cut...]), 0.8),
      (delta(" there"), 1.0),
      (delta("!") + "event: message_delta\ndata: \(delta)\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n", 3.8),
    ]
  }

  private func timedTap(_ head: String, _ parts: [(Data, TimeInterval)]) -> UsageTap.Reading? {
    let t = UsageTap(gateway: "g", model: "m", start: 100)
    t.head(head)
    parts.forEach { t.body($0.0, at: 100 + $0.1) }
    return t.finish()
  }

  func testAStreamIsTimedToItsFirstTokenAndFromThereToItsLast() throws {
    let r = try XCTUnwrap(timedTap("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream", timed.map { (Data($0.0.utf8), $0.1) }))
    XCTAssertEqual(r.usage, want)
    // The first delta is whole only with the piece at 0.8 s; the last came at 3.8 s.
    XCTAssertEqual(r.speed, ReplySpeed(firstToken: 800, decodeTokens: 320, decodeMs: 3000))
    XCTAssertEqual(r.speed?.tokensPerSecond ?? 0, 320.0 / 3, accuracy: 0.001)
    // A JSON reply has no first token to time; neither has a stream without content.
    XCTAssertNil(timedTap("HTTP/1.1 200 OK", [(Data(#"{"usage":{"input_tokens":3,"output_tokens":5}}"#.utf8), 2)])?.speed)
    XCTAssertNotNil(timedTap("HTTP/1.1 200 OK", [(Data(#"{"usage":{"input_tokens":3,"output_tokens":5}}"#.utf8), 2)])?.usage)
    XCTAssertNil(timedTap("HTTP/1.1 200 OK", [(Data(stream.utf8), 1)])?.speed)
    // All in one piece: the first token's time, no speed after it.
    let once = try XCTUnwrap(timedTap("HTTP/1.1 200 OK", [(Data(timed.map(\.0).joined().utf8), 1.5)])?.speed)
    XCTAssertEqual(once, ReplySpeed(firstToken: 1500))
    XCTAssertNil(once.tokensPerSecond)
  }

  /// `pieces` as a gzip body of stored (uncompressed) DEFLATE blocks, one per piece: each piece
  /// can be read as soon as it came, as from a gateway that flushes each event.
  private func gzipStored(_ pieces: [Data]) -> [Data] {
    var out = pieces.enumerated().map { i, p -> Data in
      let n = UInt16(p.count)
      return Data([i == pieces.count - 1 ? 1 : 0, UInt8(n & 0xFF), UInt8(n >> 8), UInt8(~n & 0xFF), UInt8(~n >> 8)]) + p
    }
    out[0] = Data([0x1F, 0x8B, 8, 0, 0, 0, 0, 0, 0, 3]) + out[0]
    out[out.count - 1] += Data(count: 8)
    return out
  }

  func testATimedStreamChunkedAndGzipped() throws {
    let plain = timed.map { (Data($0.0.utf8), $0.1) }
    let gz = gzipStored(plain.map(\.0))
    // gzip: the same times as the plain stream.
    let want = ReplySpeed(firstToken: 800, decodeTokens: 320, decodeMs: 3000)
    XCTAssertEqual(timedTap("HTTP/1.1 200 OK\r\nContent-Encoding: gzip", zip(gz, plain).map { ($0, $1.1) })?.speed, want)
    // Chunked too: each piece a chunk (and the end with the last).
    let chunks = gz.enumerated().map { i, p in
      Data((String(p.count, radix: 16) + "\r\n").utf8) + p + Data("\r\n".utf8) + (i == gz.count - 1 ? Data("0\r\n\r\n".utf8) : Data())
    }
    XCTAssertEqual(timedTap("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip", zip(chunks, plain).map { ($0, $1.1) })?.speed, want)
    // Chunked only.
    let plainChunks = plain.map { Data((String($0.0.count, radix: 16) + "\r\n").utf8) + $0.0 + Data("\r\n".utf8) }
    XCTAssertEqual(timedTap("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked", zip(plainChunks, plain).map { ($0, $1.1) })?.speed, want)
    // Compressed as one (not flushed per event), in pieces cut anywhere: still read whole.
    let whole = Data(timed.map(\.0).joined().utf8)
    let deflated = try (whole as NSData).compressed(using: .zlib) as Data
    let one = Data([0x1F, 0x8B, 8, 0, 0, 0, 0, 0, 0, 3]) + deflated + Data(count: 8)
    let r = timedTap("HTTP/1.1 200 OK\r\nContent-Encoding: gzip", [(one.prefix(20), 0.4), (one.dropFirst(20), 2)])
    XCTAssertEqual(r?.usage, self.want)
    XCTAssertNotNil(r?.speed)
  }

  func testWhereEachMarkFallsOnceTheFramingAndEncodingAreOff() {
    let (d, m) = UsageTap.dechunk(Data("3\r\nabc\r\n2;x\r\nde\r\n0\r\n\r\n".utf8), marks: [0, 4, 8, 10, 14, 16, 22])
    XCTAssertEqual(String(decoding: d, as: UTF8.self), "abcde")
    XCTAssertEqual(m, [0, 1, 3, 3, 4, 5, 5])
  }

  func testPercentilesByNearestRank() {
    let hundred = Array(1...100)
    XCTAssertEqual(CacheStats.percentile(hundred, 0.5), 50)
    XCTAssertEqual(CacheStats.percentile(hundred, 0.9), 90)
    XCTAssertEqual(CacheStats.percentile(hundred, 0.99), 99)
    XCTAssertEqual(CacheStats.percentile(Array(1...1000), 0.99), 990)
    // Fewer than 100: the 99th is the slowest.
    XCTAssertEqual(CacheStats.percentile([100, 200, 900], 0.99), 900)
    XCTAssertEqual(CacheStats.percentile([100, 200, 900], 0.5), 200)
    XCTAssertEqual(CacheStats.percentile([7], 0.99), 7)
    XCTAssertNil(CacheStats.percentile([], 0.5))
    XCTAssertNil(CacheStats.speed(tokens: 10, ms: 0))
    XCTAssertEqual(ReplySpeed(firstToken: 5, decodeTokens: 0, decodeMs: 900), ReplySpeed(firstToken: 5))
  }

  func testSpeedsAddedUpByGatewayAndModelAndByTheHour() throws {
    let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    let s = CacheStats()
    let u = CacheUsage(input: 1, output: 10)
    s.add(gateway: "公司", model: "a", usage: u, speed: ReplySpeed(firstToken: 900, decodeTokens: 100, decodeMs: 1000), at: t0)
    s.add(gateway: "公司", model: "a", usage: u, speed: ReplySpeed(firstToken: 300, decodeTokens: 300, decodeMs: 1000), at: t0.addingTimeInterval(700))
    s.add(gateway: "公司", model: "a", usage: u, at: t0.addingTimeInterval(800))
    s.add(gateway: "DeepSeek", model: "a", usage: u, speed: ReplySpeed(firstToken: 2000), at: t0)
    let rows = CacheStats.rows(s.snapshot(now: t0))
    let mine = try XCTUnwrap(rows.first { $0.gateway == "公司" })
    XCTAssertEqual(mine.requests, 3)
    XCTAssertEqual(mine.streamed, 2)
    XCTAssertEqual(mine.firstToken, [300, 900])
    XCTAssertEqual(mine.firstToken(0.5), 300)
    XCTAssertEqual(mine.firstToken(0.99), 900)
    // Weighted by tokens: 400 tokens in 2 s.
    XCTAssertEqual(mine.tokensPerSecond ?? 0, 200, accuracy: 0.001)
    let theirs = try XCTUnwrap(rows.first { $0.gateway == "DeepSeek" })
    XCTAssertEqual(theirs.firstToken(0.99), 2000)
    XCTAssertNil(theirs.tokensPerSecond)
    // By the hour: both in the hour that starts at t0.
    let h = CacheStats.hourly(s.snapshot(now: t0), gateway: "公司", model: "a", now: t0.addingTimeInterval(900))
    XCTAssertEqual(h.compactMap(\.firstToken99), [900])
    XCTAssertEqual(h.last?.tokensPerSecond ?? 0, 200, accuracy: 0.001)
    XCTAssertNil(h[0].firstToken99)
    // Kept as JSON and read back; a file from before the speeds reads with none.
    let enc = JSONEncoder(), dec = JSONDecoder()
    enc.dateEncodingStrategy = .secondsSince1970
    dec.dateDecodingStrategy = .secondsSince1970
    let b = s.snapshot(now: t0)
    XCTAssertEqual(try dec.decode([CacheBucket].self, from: try enc.encode(b)), b)
    let old = try dec.decode([CacheBucket].self, from: Data(#"[{"gateway":"g","model":"m","start":1800000000,"requests":2,"usage":{"input":1,"cacheRead":0,"cacheWrite":0,"output":3}}]"#.utf8))
    XCTAssertEqual(old.first?.requests, 2)
    XCTAssertEqual(old.first?.firstToken, [])
    XCTAssertEqual(old.first?.decodeMs, 0)
  }
}
