import XCTest
@testable import QuotaCore

/// Whether the running Desktop (what it read at launch) has what is configured now: a change
/// undone before a restart leaves nothing to restart for.
final class DesktopSeenTests: XCTestCase {
  let api = "http://api-ai-coding.bilibili.co/api"
  let f1 = "http://127.0.0.1:47831"

  private func gw(_ url: String?, _ key: String? = "sk-a") -> DesktopSeen { DesktopSeen(mode: .gateway, url: url, key: key) }

  func testTheSameNeedsNothing() {
    XCTAssertEqual(gw(f1).lacks(gw(f1 + "/"), forwarder: f1), [])
    XCTAssertEqual(gw(api).lacks(gw(api), forwarder: nil), [])
    XCTAssertEqual(DesktopSeen(mode: .signIn, url: nil, key: nil).lacks(DesktopSeen(mode: .signIn, url: nil, key: nil), forwarder: nil), [])
  }

  func testForwarderOffThenOnAgainIsNothing() {
    // Opened on the forwarder; turned off (configured on the API): lacks the move back...
    let running = gw(f1)
    XCTAssertEqual(running.lacks(gw(api), forwarder: nil), ["改回直连 \(api)"])
    // ...turned on again before any restart: nothing.
    XCTAssertEqual(running.lacks(gw(f1), forwarder: f1), [])
  }

  func testOntoTheForwarder() {
    XCTAssertEqual(gw(api).lacks(gw(f1), forwarder: f1), ["改经本地转发 (127.0.0.1:47831)"])
  }

  func testAnotherAddress() {
    XCTAssertEqual(gw(api).lacks(gw("https://other.example.com"), forwarder: nil), ["地址改为 https://other.example.com"])
    XCTAssertEqual(gw(api).lacks(gw(nil), forwarder: nil), ["地址已清空"])
  }

  func testTheKeyCountsOnlyWithoutTheForwarder() {
    let name: (String) -> String? = { $0 == "sk-b" ? "B" : nil }
    XCTAssertEqual(gw(api, "sk-a").lacks(gw(api, "sk-b"), forwarder: nil, name: name), ["key 改为 \"B\""])
    XCTAssertEqual(gw(api, "sk-a").lacks(gw(api, "sk-c"), forwarder: nil, name: name), ["key 改为 新 key"])
    // Through the forwarder, which sends the configured key: nothing.
    XCTAssertEqual(gw(f1, "sk-a").lacks(gw(f1, "sk-b"), forwarder: f1, name: name), [])
    // Back to the key it has: nothing.
    XCTAssertEqual(gw(api, "sk-a").lacks(gw(api, "sk-a"), forwarder: nil), [])
    // Sealed (unreadable): not compared.
    XCTAssertEqual(gw(api, nil).lacks(gw(api, "sk-b"), forwarder: nil), [])
  }

  func testAddressAndKeyBoth() {
    XCTAssertEqual(gw(f1, "sk-a").lacks(gw(api, "sk-b"), forwarder: nil, name: { _ in "B" }), ["改回直连 \(api)", "key 改为 \"B\""])
  }

  func testStartMode() {
    XCTAssertEqual(gw(api).lacks(DesktopSeen(mode: .signIn, url: nil, key: nil), forwarder: nil), ["启动方式改为官方登录"])
    XCTAssertEqual(DesktopSeen(mode: .signIn, url: nil, key: nil).lacks(gw(api), forwarder: nil), ["启动方式改为第三方网关"])
    XCTAssertEqual(gw(api).lacks(DesktopSeen(mode: .managed, url: nil, key: nil), forwarder: nil), [])
  }

  func testFromDesktopsFiles() {
    XCTAssertEqual(DesktopSeen(mode: .gateway(baseURL: api), status: .gateway(key: "sk-a", baseURL: api)), gw(api, "sk-a"))
    XCTAssertEqual(DesktopSeen(mode: .signIn, status: .notGateway), DesktopSeen(mode: .signIn, url: nil, key: nil))
    XCTAssertEqual(DesktopSeen(mode: .gateway(baseURL: api), status: .notGateway), gw(api, nil))
  }
}
