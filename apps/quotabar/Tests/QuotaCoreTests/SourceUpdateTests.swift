import Foundation
import XCTest
@testable import QuotaCore

/// A remote, a clone that pushes (CI), and the user's clone the app was built from.
final class SourceUpdateTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

  @discardableResult
  private func sh(_ cmd: String, in d: URL? = nil) throws -> String {
    try SourceUpdate.run(["bash", "-c", cmd], in: d ?? dir, timeout: 30).trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func commit(_ path: String, _ text: String, in d: URL) throws -> String {
    try sh("mkdir -p \"$(dirname '\(path)')\" && printf '%s' '\(text)' > '\(path)' && git add -A && git -c user.name=t -c user.email=t@t commit -qm 'change \(path)' && git rev-parse HEAD", in: d)
  }

  func testFollowsTheStableBranchForTheAppFolderOnly() throws {
    try sh("git init -q --bare -b main remote.git && git clone -q remote.git ci 2>/dev/null")
    let ci = dir.appendingPathComponent("ci")
    let c1 = try commit("apps/quotabar/a.swift", "1", in: ci)
    try sh("git push -q origin main main:\(SourceUpdate.branch)", in: ci)
    try sh("git clone -q remote.git user 2>/dev/null")
    let app = SourceUpdate(dir: dir.appendingPathComponent("user/apps/quotabar"))

    XCTAssertEqual(try app.newer(than: c1).count, 0)

    // On main only (CI hasn't passed it yet): nothing.
    _ = try commit("apps/quotabar/a.swift", "2", in: ci)
    try sh("git push -q origin main", in: ci)
    XCTAssertEqual(try app.newer(than: c1).count, 0)

    // Passed: one change to the app; one elsewhere (the web toolbox), which doesn't count.
    _ = try commit("web/x.js", "w", in: ci)
    try sh("git push -q origin main main:\(SourceUpdate.branch)", in: ci)
    let n = try app.newer(than: c1)
    XCTAssertEqual(n.count, 1)
    XCTAssertEqual(n.subject, "change apps/quotabar/a.swift")

    try app.fastForward()
    XCTAssertEqual(try sh("cat apps/quotabar/a.swift", in: dir.appendingPathComponent("user")), "2")
    let head = try app.git(["rev-parse", "HEAD"]).trimmingCharacters(in: .whitespacesAndNewlines)
    XCTAssertEqual(try app.newer(than: head).count, 0)
  }

  func testLocalChangesInTheWayStopIt() throws {
    try sh("git init -q --bare -b main remote.git && git clone -q remote.git ci 2>/dev/null")
    let ci = dir.appendingPathComponent("ci")
    let c1 = try commit("apps/quotabar/a.swift", "1", in: ci)
    try sh("git push -q origin main main:\(SourceUpdate.branch)", in: ci)
    try sh("git clone -q remote.git user 2>/dev/null")
    let user = dir.appendingPathComponent("user")
    let app = SourceUpdate(dir: user.appendingPathComponent("apps/quotabar"))
    _ = try commit("apps/quotabar/a.swift", "2", in: ci)
    try sh("git push -q origin main:\(SourceUpdate.branch)", in: ci)
    try sh("printf mine > apps/quotabar/a.swift", in: user)
    XCTAssertEqual(try app.newer(than: c1).count, 1)
    XCTAssertThrowsError(try app.fastForward())
    XCTAssertEqual(try sh("cat apps/quotabar/a.swift", in: user), "mine")
  }

  func testNoRemoteIsAnError() throws {
    try sh("git init -q -b main user && cd user && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m x")
    let app = SourceUpdate(dir: dir.appendingPathComponent("user"))
    XCTAssertThrowsError(try app.newer(than: "HEAD"))
  }

  func testTheShellsVariablesAreReadBetweenTheMarksOnly() {
    let m = ShellEnv.mark
    let out = "Welcome!\nSSH_AUTH_SOCK=/junk\n\n\(m)\nSSH_AUTH_SOCK=/tmp/agent.sock\nHOME=/Users/x\nhttps_proxy=http://127.0.0.1:7890\nGIT_SSH_COMMAND=\nPATH=/opt/homebrew/bin:/usr/bin\n\n\(m)\nbye\n"
    XCTAssertEqual(ShellEnv.parse(out), [
      "SSH_AUTH_SOCK": "/tmp/agent.sock",
      "https_proxy": "http://127.0.0.1:7890",
      "PATH": "/opt/homebrew/bin:/usr/bin",
    ])
    XCTAssertEqual(ShellEnv.parse("no marks"), [:])
  }

  func testExtraVariablesReachTheCommand() throws {
    XCTAssertEqual(try SourceUpdate.run(["bash", "-c", "printf %s \"$SSH_AUTH_SOCK\""], in: dir, timeout: 10, extra: ["SSH_AUTH_SOCK": "/tmp/a.sock"]), "/tmp/a.sock")
    // The real shell gives something back (PATH at least) and doesn't hang.
    let start = Date()
    XCTAssertNotNil(ShellEnv.values["PATH"])
    XCTAssertLessThan(Date().timeIntervalSince(start), 12)
  }

  func testGitHubSshAddressesHaveAnHttpsOne() {
    XCTAssertEqual(SourceUpdate.https(for: "git@github.com:ryuryu0x08/devtool.git"), "https://github.com/ryuryu0x08/devtool.git")
    XCTAssertEqual(SourceUpdate.https(for: "ssh://git@github.com/ryuryu0x08/devtool"), "https://github.com/ryuryu0x08/devtool")
    XCTAssertNil(SourceUpdate.https(for: "https://github.com/ryuryu0x08/devtool.git"))
    XCTAssertNil(SourceUpdate.https(for: "git@gitlab.com:a/b.git"))
    XCTAssertNil(SourceUpdate.https(for: "git@github.com:"))
  }

  func testATimeoutStopsTheCommand() throws {
    let start = Date()
    XCTAssertThrowsError(try SourceUpdate.run(["sleep", "10"], in: dir, timeout: 0.5))
    XCTAssertLessThan(Date().timeIntervalSince(start), 5)
  }
}

final class AppSwapTests: XCTestCase {
  private var dir: URL!

  override func setUpWithError() throws {
    dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws { try? FileManager.default.removeItem(at: dir) }

  private func bundle(_ name: String, _ text: String) throws -> URL {
    let app = dir.appendingPathComponent(name)
    try FileManager.default.createDirectory(at: app.appendingPathComponent("Contents/MacOS"), withIntermediateDirectories: true)
    try text.write(to: app.appendingPathComponent("Contents/MacOS/QuotaBar"), atomically: true, encoding: .utf8)
    return app
  }

  private func binary(_ app: URL) throws -> String {
    try String(contentsOf: app.appendingPathComponent("Contents/MacOS/QuotaBar"), encoding: .utf8)
  }

  func testTheNewBuildTakesThePlaceOfTheOldAndTheBuildStays() throws {
    let old = try bundle("Applications/QuotaBar.app", "old")
    let built = try bundle("build/QuotaBar.app", "new")
    try AppSwap.replace(old, with: built)
    XCTAssertEqual(try binary(old), "new")
    XCTAssertEqual(try binary(built), "new")
    // Nothing left beside it.
    XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: dir.appendingPathComponent("Applications").path), ["QuotaBar.app"])
  }

  func testNoBuildLeavesTheOldOne() throws {
    let old = try bundle("Applications/QuotaBar.app", "old")
    XCTAssertThrowsError(try AppSwap.replace(old, with: dir.appendingPathComponent("build/QuotaBar.app")))
    XCTAssertEqual(try binary(old), "old")
  }

  func testThePreviousAppsProcessFromTheArguments() {
    XCTAssertEqual(AppSwap.previous(in: ["QuotaBar", "--after-update", "123"]), 123)
    XCTAssertNil(AppSwap.previous(in: ["QuotaBar", "--after-update"]))
    XCTAssertNil(AppSwap.previous(in: ["QuotaBar"]))
    let start = Date()
    AppSwap.wait(for: 999_999, limit: 2)
    XCTAssertLessThan(Date().timeIntervalSince(start), 1)
  }
}
