import Foundation
import XCTest
@testable import QuotaCore

final class ProxyUsageTests: XCTestCase {
  // The portal's reply shape, with a placeholder token.
  private let token = "sk-aicoding-PLACEHOLDER0123456789"
  private var sample: String {
    """
    {"code":0,"message":"OK","ttl":1,"data":{"success":true,"client_id":79,
    "nickname":"六六RyuRyu","balance":1000,"token":"\(token)",
    "next_token":"","daily_usage":13.9869942,"daily_limit":200,"overflow_limit":100,"overflow_usage":0,
    "overflow_available":100,"pool_limit":6000,"pool_usage":363.70}}
    """
  }

  func testReadsTheNicknameTokenAndUsage() throws {
    let r = ProxyUsageAPI.parse(status: 200, body: Data(sample.utf8))
    guard case .success(let u) = r else { return XCTFail("not success: \(r)") }
    XCTAssertEqual(u.nickname, "六六RyuRyu")
    XCTAssertEqual(u.token, token)
    XCTAssertEqual(u.usage.daily, 13.9869942)
    XCTAssertEqual(u.usage.dailyLimit, 200)
    XCTAssertEqual(u.usage.overAvail, 100)
    XCTAssertEqual(u.usage.pool, 363.70)
    XCTAssertEqual(u.usage.poolLimit, 6000)
  }

  func testAStaleCookieIsRejected() {
    guard case .failure(let f) = ProxyUsageAPI.parse(status: 401, body: Data("{}".utf8)) else { return XCTFail() }
    XCTAssertEqual(f.kind, .keyRejected)
    // success:false also counts as not-signed-in.
    guard case .failure(let g) = ProxyUsageAPI.parse(status: 200, body: Data(#"{"code":0,"data":{"success":false}}"#.utf8)) else { return XCTFail() }
    XCTAssertEqual(g.kind, .keyRejected)
  }

  func testTheRequestCarriesTheCookieAndLooksLikeTheBrowser() {
    let r = ProxyUsageAPI.request(url: URL(string: "https://ai-coding.bilibili.co/ai-coding/user/proxy-usage")!, cookie: "SESSDATA=abc; x=y")
    XCTAssertEqual(r.value(forHTTPHeaderField: "Cookie"), "SESSDATA=abc; x=y")
    XCTAssertEqual(r.value(forHTTPHeaderField: "Referer"), "https://ai-coding.bilibili.co/coding")
    XCTAssertTrue(r.value(forHTTPHeaderField: "User-Agent")?.contains("Chrome") ?? false)
  }
}

final class UpsertTests: XCTestCase {
  private func reading() -> GoodReading { GoodReading(at: Date(), usage: Usage(daily: 1)) }

  func testAddsANewNamedPerson() {
    var ps: [Person] = []
    let b = People.upsert(name: "六六", key: "sk-1", reading: reading(), in: &ps)
    XCTAssertEqual(ps.count, 1)
    XCTAssertEqual(ps[0].name, "六六")
    XCTAssertEqual(ps[0].key, "sk-1")
    XCTAssertNil(b?.replaced)
  }

  func testARotatedKeyReplacesAndReportsTheOldOne() {
    var ps = [Person(name: "六六", key: "sk-old", lastGood: nil)]
    let b = People.upsert(name: "六六", key: "sk-new", reading: reading(), in: &ps)
    XCTAssertEqual(ps.count, 1)
    XCTAssertEqual(ps[0].key, "sk-new")
    XCTAssertEqual(b?.replaced, "sk-old")
  }

  func testTheSameKeyAgainIsNoReplacement() {
    var ps = [Person(name: "六六", key: "sk-1", lastGood: nil)]
    let b = People.upsert(name: "六六", key: "sk-1", reading: reading(), in: &ps)
    XCTAssertNil(b?.replaced)
    XCTAssertNotNil(ps[0].lastGood)
  }

  func testAnUnnamedEntryHoldingTheKeyGetsTheNameNotADuplicate() {
    // e.g. the key was adopted from Claude Code before the name was known.
    var ps = [Person(key: "sk-1")]
    let b = People.upsert(name: "六六", key: "sk-1", reading: reading(), in: &ps)
    XCTAssertEqual(ps.count, 1)
    XCTAssertEqual(ps[0].name, "六六")
    XCTAssertNil(b?.replaced)
  }
}
