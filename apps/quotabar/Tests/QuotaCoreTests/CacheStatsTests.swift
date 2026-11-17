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
    return t.finish()
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
    XCTAssertEqual(t.finish(), want)
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
}
