import XCTest
@testable import QuotaCore

/// The rules between Claude Desktop and the forwarder, one case each (the ones met in use).
final class DesktopLinkTests: XCTestCase {
  let api = "http://api-ai-coding.bilibili.co/api"
  let f1 = "http://127.0.0.1:47831"
  let f2 = "http://127.0.0.1:47832"

  private func link(desktop: ClaudeDesktop.Status, forwarder: String?, ours: [String]? = nil, swap: Bool = false, chosen: String? = nil, old: Bool = false) -> DesktopLink {
    DesktopLink(desktop: desktop, forwarder: forwarder, baseURL: api, ours: ours ?? [f1], swapKeys: swap, chosenKey: chosen, desktopOnOldAddress: old)
  }

  // MARK: - Following the forwarder

  func testTurnedOnDesktopOnTheAPIGoesThroughTheForwarder() {
    let c = link(desktop: .gateway(key: "sk-a", baseURL: api), forwarder: f1).afterForwarder()
    XCTAssertEqual(c, .init(url: f1, key: nil, why: "Desktop 改为经本地转发（127.0.0.1:47831）访问模型接口", live: false))
  }

  func testPortTakenByAnotherProgramSaysSo() {
    let c = link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f2).afterForwarder(taken: 47831)
    XCTAssertEqual(c?.url, f2)
    XCTAssertEqual(c?.why, "端口 47831 被其他程序占用，本地转发改用 127.0.0.1:47832")
    XCTAssertEqual(c?.live, false)
  }

  func testForwarderMovedFromAnEarlierPortOfOurs() {
    let c = link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f2).afterForwarder()
    XCTAssertEqual(c?.why, "本地转发的地址改为 127.0.0.1:47832")
  }

  func testTurnedOffDesktopGoesBackToTheAPI() {
    let c = link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: nil).afterForwarder()
    XCTAssertEqual(c, .init(url: api, key: nil, why: "本地转发已关闭，Desktop 改回直连模型接口（\(api)）", live: false))
  }

  func testCouldNotStartDesktopGoesBackToTheAPI() {
    let c = link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: nil).afterForwarder(failed: true)
    XCTAssertEqual(c?.url, api)
    XCTAssertEqual(c?.why, "本地转发没能启动，Desktop 改回直连模型接口（\(api)）")
  }

  func testAnAddressSetElsewhereIsLeftAlone() {
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: "https://other.example.com"), forwarder: f1).afterForwarder())
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: "https://other.example.com"), forwarder: nil).afterForwarder())
  }

  func testNotOnAGatewayOrManagedNothingChanges() {
    XCTAssertNil(link(desktop: .notGateway, forwarder: f1).afterForwarder(key: "sk-b"))
    XCTAssertNil(link(desktop: .managed, forwarder: nil).afterForwarder())
  }

  func testAlreadyThereNothingChanges() {
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1).afterForwarder())
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: api), forwarder: nil).afterForwarder())
    // The same key as it has: nothing either.
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1).afterForwarder(key: "sk-a", owner: "A"))
  }

  // MARK: - Turning swapping off

  func testSwappingOffWithTheForwarderStillOnNeedsNoRestart() {
    // http model API: the forwarder stays, Desktop stays on it; the key goes in its configuration
    // and the forwarder sends that one from now on.
    let c = link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1).afterForwarder(key: "sk-b", owner: "B")
    XCTAssertEqual(c, .init(url: nil, key: "sk-b", why: "免重启切换已关闭，Desktop 改用配置里「B」的 key", live: true))
  }

  func testSwappingOffWithAnHttpsAPIMovesDesktopBackAndNeedsARestart() {
    let c = link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: nil).afterForwarder(key: "sk-b", owner: "B")
    XCTAssertEqual(c?.url, api)
    XCTAssertEqual(c?.key, "sk-b")
    XCTAssertEqual(c?.why, "本地转发已关闭，Desktop 改回直连模型接口（\(api)）；免重启切换已关闭，Desktop 改用配置里「B」的 key")
    XCTAssertEqual(c?.live, false)
  }

  func testDesktopOpenedBeforeTheAddressChangeDoesNotGetItAtOnce() {
    let c = link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1, old: true).afterForwarder(key: "sk-b")
    XCTAssertEqual(c?.live, false)
    XCTAssertEqual(c?.why, "免重启切换已关闭，Desktop 改用配置里的 key")
  }

  // MARK: - The forwarder's key

  func testTheForwarderSendsTheChosenKeyWhenSwapping() {
    XCTAssertEqual(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1, swap: true, chosen: "sk-b").forwarderKey, "sk-b")
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1, swap: true, chosen: "").forwarderKey)
  }

  func testOtherwiseTheKeyInDesktopsConfiguration() {
    XCTAssertEqual(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1).forwarderKey, "sk-a")
    // Sealed (unreadable) or no gateway: Desktop's own goes on.
    XCTAssertNil(link(desktop: .gateway(key: nil, baseURL: f1), forwarder: f1).forwarderKey)
    XCTAssertNil(link(desktop: .notGateway, forwarder: f1).forwarderKey)
  }

  // MARK: - Where Desktop is

  func testThroughTheForwarder() {
    XCTAssertTrue(link(desktop: .gateway(key: "sk-a", baseURL: f1 + "/"), forwarder: f1).throughForwarder)
    XCTAssertTrue(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1).keyChangeIsLive)
    XCTAssertFalse(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1, old: true).throughForwarder)
    XCTAssertFalse(link(desktop: .gateway(key: "sk-a", baseURL: api), forwarder: f1).throughForwarder)
    XCTAssertFalse(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: nil).throughForwarder)
  }

  func testSwapping() {
    XCTAssertTrue(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1, swap: true).swapping)
    XCTAssertFalse(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1).swapping)
    XCTAssertFalse(link(desktop: .gateway(key: "sk-a", baseURL: api), forwarder: f1, swap: true).swapping)
  }

  func testDesktopOffTheForwarderIsShownAndCanBeMoved() {
    XCTAssertEqual(DesktopLink.offForwarder(forwarder: f1, desktop: .gateway(baseURL: "https://other.example.com")), "https://other.example.com")
    XCTAssertEqual(DesktopLink.offForwarder(forwarder: f1, desktop: .gateway(baseURL: nil)), "未设置")
    XCTAssertNil(DesktopLink.offForwarder(forwarder: f1, desktop: .gateway(baseURL: f1)))
    XCTAssertNil(DesktopLink.offForwarder(forwarder: nil, desktop: .gateway(baseURL: api)))
    XCTAssertNil(DesktopLink.offForwarder(forwarder: f1, desktop: .signIn))

    let c = link(desktop: .gateway(key: "sk-a", baseURL: "https://other.example.com"), forwarder: f1).toForwarder()
    XCTAssertEqual(c, .init(url: f1, key: nil, why: "Desktop 改为经本地转发（127.0.0.1:47831）访问模型接口", live: false))
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: f1), forwarder: f1).toForwarder())
    XCTAssertNil(link(desktop: .gateway(key: "sk-a", baseURL: api), forwarder: nil).toForwarder())
  }

  func testShortAddress() {
    XCTAssertEqual(DesktopLink.short("http://127.0.0.1:47831"), "127.0.0.1:47831")
    XCTAssertEqual(DesktopLink.short("https://x.example.com"), "https://x.example.com")
  }
}
