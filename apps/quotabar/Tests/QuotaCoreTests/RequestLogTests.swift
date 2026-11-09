import Foundation
import XCTest
@testable import QuotaCore

final class RequestLogTests: XCTestCase {
  func testKeepsTheLastMinutesNewestFirstWithoutTheQuery() {
    let log = RequestLog(keep: 600)
    let t0 = Date(timeIntervalSince1970: 1_000_000)
    let a = log.add(method: "POST", path: "/v1/messages?beta=true&key=sk-secret", model: "claude-a", gateway: .company, key: "ye", at: t0)
    let b = log.add(method: "GET", path: "/v1/models", model: nil, gateway: .both, key: "…1234", at: t0.addingTimeInterval(1))
    var r = log.recent(now: t0.addingTimeInterval(2))
    XCTAssertEqual(r.map(\.id), [b, a])
    XCTAssertEqual(r[1].path, "/v1/messages")
    XCTAssertNil(r[1].status)
    // The reply's status, and the time to it; a second finish changes nothing.
    log.finish(a, status: 200, at: t0.addingTimeInterval(0.8))
    log.finish(a, status: 500, at: t0.addingTimeInterval(5))
    r = log.recent(now: t0.addingTimeInterval(2))
    XCTAssertEqual(r[1].status, 200)
    XCTAssertEqual(r[1].ms, 800)
    // Older than 10 minutes: gone.
    XCTAssertEqual(log.recent(now: t0.addingTimeInterval(600.5)).map(\.id), [b])
    XCTAssertEqual(log.recent(now: t0.addingTimeInterval(700)), [])
  }

  func testAtMostTheLimitTheNewestKept() {
    let log = RequestLog(keep: 600, limit: 3)
    let t = Date()
    let ids = (0..<5).map { log.add(method: "POST", path: "/v1/messages", model: "m\($0)", gateway: .other, key: nil, at: t) }
    XCTAssertEqual(log.recent(now: t).map(\.id), ids.suffix(3).reversed())
  }

  func testAKeyShowsOnlyItsEnd() {
    XCTAssertEqual(RequestLog.mask("sk-ant-api03-abcdefgh9f3c"), "…9f3c")
    XCTAssertEqual(RequestLog.mask("ab"), "…ab")
  }
}
