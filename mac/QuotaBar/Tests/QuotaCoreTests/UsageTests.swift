import Foundation
import XCTest
@testable import QuotaCore

final class UsageTests: XCTestCase {
  private func parse(_ json: String, status: Int = 200) -> UsageReply {
    UsageAPI.parse(status: status, body: Data(json.utf8))
  }

  func testReadsASuccessfulReply() {
    let r = parse(#"{"code":0,"data":{"valid":true,"nick_name":"野","daily_usage":30.5,"daily_limit":200,"overflow_usage":0,"overflow_limit":100,"overflow_available":80,"pool_usage":300,"pool_limit":1000}}"#)
    XCTAssertEqual(r, .ok(Usage(daily: 30.5, dailyLimit: 200, over: 0, overLimit: 100, overAvail: 80, pool: 300, poolLimit: 1000), title: "野"))
  }

  func testNumbersOnly() {
    // true, strings and missing fields are not numbers.
    guard case .ok(let q, nil) = parse(#"{"code":0,"data":{"valid":true,"daily_usage":true,"daily_limit":"200"}}"#) else { return XCTFail() }
    XCTAssertEqual(q, Usage())
  }

  func testSaysWhyAReplyIsNotUsable() {
    XCTAssertEqual(parse("<html>", status: 502), .failed(Failure(.server, "HTTP 502: <html>"), title: nil))
    XCTAssertEqual(parse("", status: 200), .failed(Failure(.server, "HTTP 200: (empty)"), title: nil))
    XCTAssertEqual(parse(#"{"message":"boom"}"#, status: 500), .failed(Failure(.server, "HTTP 500: boom"), title: nil))
    XCTAssertEqual(parse(#"{"message":"bad key"}"#, status: 401), .failed(Failure(.keyRejected, "HTTP 401: bad key"), title: nil))
    XCTAssertEqual(parse("{}", status: 403), .failed(Failure(.keyRejected, "HTTP 403"), title: nil))
    XCTAssertEqual(parse(#"{"code":1,"message":"key 已停用"}"#), .failed(Failure(.keyRejected, "key 已停用"), title: nil))
    XCTAssertEqual(parse(#"{"code":0,"data":{"valid":false,"nick_name":"a"}}"#), .failed(Failure(.keyRejected, "返回不是成功"), title: "a"))
    // valid must be true itself, not 1.
    XCTAssertEqual(parse(#"{"code":0,"data":{"valid":1}}"#), .failed(Failure(.keyRejected, "返回不是成功"), title: nil))
  }

  func testTheRequestCarriesTheKey() {
    let r = UsageAPI.request(url: URL(string: "http://h/api/v1/billing/usage")!, key: "sk-1")
    XCTAssertEqual(r.httpMethod, "GET")
    XCTAssertEqual(r.value(forHTTPHeaderField: "Authorization"), "Bearer sk-1")
  }
}

final class KeyStateTests: XCTestCase {
  func testWithinTheDailyQuota() {
    let s = KeyState(Usage(daily: 30, dailyLimit: 200, over: 0, overLimit: 100, overAvail: 100, pool: 300, poolLimit: 1000))
    XCTAssertEqual(s.kind, .withinDaily)
    XCTAssertEqual(s.left, 270)
    XCTAssertEqual(s.chip, "今日额度内")
    XCTAssertFalse(s.poolCaps)
    XCTAssertEqual(s.parts, "今日剩 170 + 超额 100")
  }

  func testThePoolCapsTheOverflowNotTheDailyQuota() {
    // 40 left in the pool: the key's 100 of overflow is only 40.
    let s = KeyState(Usage(daily: 30.58, dailyLimit: 200, over: 0, overLimit: 100, overAvail: nil, pool: 960, poolLimit: 1000))
    XCTAssertEqual(s.left, 169.42 + 40, accuracy: 1e-9)
    XCTAssertTrue(s.poolCaps)
    XCTAssertEqual(s.parts, "今日剩 169.42 + 超额 40（池子限制，原 100）")
    // The API's own overflow_available counts too.
    XCTAssertEqual(KeyState(Usage(daily: 0, dailyLimit: 10, over: 0, overLimit: 100, overAvail: 25, pool: 0, poolLimit: 1000)).overAvail, 25)
  }

  func testOnTheOverflowAndOut() {
    let over = KeyState(Usage(daily: 250, dailyLimit: 200, over: 50, overLimit: 100, pool: 500, poolLimit: 1000))
    XCTAssertEqual(over.kind, .onOverflow)
    XCTAssertEqual(over.left, 50)
    let used = KeyState(Usage(daily: 300, dailyLimit: 200, over: 100, overLimit: 100, pool: 500, poolLimit: 1000))
    XCTAssertEqual(used.kind, .out)
    XCTAssertEqual(used.chip, "超额已用完")
    let full = KeyState(Usage(daily: 200, dailyLimit: 200, over: 0, overLimit: 100, pool: 1000, poolLimit: 1000))
    XCTAssertEqual(full.kind, .out)
    XCTAssertEqual(full.chip, "共用池已满")
    XCTAssertEqual(full.left, 0)
  }

  func testWithoutAPoolOnlyTheKeysOwnLimitsCount() {
    XCTAssertEqual(KeyState(Usage(daily: 200, dailyLimit: 200, over: 10, overLimit: 100)).left, 90)
  }

  func testNumbers() {
    XCTAssertEqual(Fmt.num(nil), "—")
    XCTAssertEqual(Fmt.num(12.5), "12.5")
    XCTAssertEqual(Fmt.num(12.346), "12.35")
    XCTAssertEqual(Fmt.num(3), "3")
    XCTAssertEqual(Fmt.num(1234.6), "1235")
    XCTAssertEqual(Fmt.num(-0.001), "0")
    XCTAssertEqual(Fmt.pct(50, 200), 25)
    XCTAssertEqual(Fmt.pct(50, 0), 0)
  }
}

final class HistoryTests: XCTestCase {
  func testOnePointPerKeyEveryFiveMinutesForSevenDays() {
    let now = Date(timeIntervalSince1970: 1_000_000_200)
    let at = { (s: TimeInterval) in now.addingTimeInterval(-s) }
    let h = [
      Sample(t: at(10), key: "a", daily: 2, over: nil, pool: nil),
      Sample(t: at(100), key: "a", daily: 1, over: nil, pool: nil),
      Sample(t: at(100), key: "b", daily: 9, over: nil, pool: nil),
      Sample(t: at(8 * 86400), key: "a", daily: 0, over: nil, pool: nil),
    ]
    let out = History.thin(h, now: now)
    // 1_000_000_200 is a slot start: at(10) and at(100) fall in the slot before it.
    XCTAssertEqual(out.map(\.key), ["a", "b"])
    XCTAssertEqual(out.map(\.daily), [2, 9])
    XCTAssertEqual(out.map(\.t), [History.slot(at(10)), History.slot(at(10))])
    XCTAssertEqual(History.slot(at(10)).timeIntervalSince1970, 999_999_900)
  }
}

final class TrendTests: XCTestCase {
  private func at(_ m: Double) -> Date { Date(timeIntervalSince1970: m * 60) }

  func testTheLineBreaksWhereTheQuotaCameBackAndWhereNothingWasRead() {
    let pts: [(t: Date, v: Double)] = [
      (at(0), 10), (at(5), 20), (at(10), 20.05),   // 20.05 vs 20: the same run (no drop)
      (at(15), 3),                                  // came back
      (at(20), 8),
      (at(80), 9),                                  // an hour with nothing read
      (at(85), 8.999),                              // rounding, not a drop
    ]
    let r = Trend.runs(Array(pts.reversed()), gap: 15 * 60)
    XCTAssertEqual(r.points.map(\.run), [0, 0, 0, 1, 1, 2, 2])
    XCTAssertEqual(r.points.map(\.v), [10, 20, 20.05, 3, 8, 9, 8.999])
    XCTAssertEqual(r.resets, [at(15)])
  }

  func testAFullDropIsAReset() {
    let r = Trend.runs([(at(0), 300), (at(5), 0)], gap: 900)
    XCTAssertEqual(r.points.map(\.run), [0, 1])
    XCTAssertEqual(r.resets, [at(5)])
    XCTAssertEqual(Trend.runs([], gap: 900).points, [])
  }

  func testWhenAFailureShowsInTheMenuBar() {
    let net = Failure(.network, "x"), server = Failure(.server, "x"), key = Failure(.keyRejected, "x")
    // One failed reading among good ones: not yet.
    XCTAssertFalse(net.worthBar(hasReading: true, failingFor: 0))
    XCTAssertFalse(server.worthBar(hasReading: true, failingFor: 119))
    // Going on, or nothing else to show, or the key turned down: yes.
    XCTAssertTrue(net.worthBar(hasReading: true, failingFor: Failure.barGrace))
    XCTAssertTrue(net.worthBar(hasReading: false, failingFor: 0))
    XCTAssertTrue(key.worthBar(hasReading: true, failingFor: 0))
  }
}
