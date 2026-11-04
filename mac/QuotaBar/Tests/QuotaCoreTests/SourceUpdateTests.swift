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
    let c1 = try commit("mac/QuotaBar/a.swift", "1", in: ci)
    try sh("git push -q origin main main:\(SourceUpdate.branch)", in: ci)
    try sh("git clone -q remote.git user 2>/dev/null")
    let app = SourceUpdate(dir: dir.appendingPathComponent("user/mac/QuotaBar"))

    XCTAssertEqual(try app.newer(than: c1).count, 0)

    // On main only (CI hasn't passed it yet): nothing.
    _ = try commit("mac/QuotaBar/a.swift", "2", in: ci)
    try sh("git push -q origin main", in: ci)
    XCTAssertEqual(try app.newer(than: c1).count, 0)

    // Passed: one change to the app; one elsewhere (the web toolbox), which doesn't count.
    _ = try commit("web/x.js", "w", in: ci)
    try sh("git push -q origin main main:\(SourceUpdate.branch)", in: ci)
    let n = try app.newer(than: c1)
    XCTAssertEqual(n.count, 1)
    XCTAssertEqual(n.subject, "change mac/QuotaBar/a.swift")

    try app.fastForward()
    XCTAssertEqual(try sh("cat mac/QuotaBar/a.swift", in: dir.appendingPathComponent("user")), "2")
    let head = try app.git(["rev-parse", "HEAD"]).trimmingCharacters(in: .whitespacesAndNewlines)
    XCTAssertEqual(try app.newer(than: head).count, 0)
  }

  func testLocalChangesInTheWayStopIt() throws {
    try sh("git init -q --bare -b main remote.git && git clone -q remote.git ci 2>/dev/null")
    let ci = dir.appendingPathComponent("ci")
    let c1 = try commit("mac/QuotaBar/a.swift", "1", in: ci)
    try sh("git push -q origin main main:\(SourceUpdate.branch)", in: ci)
    try sh("git clone -q remote.git user 2>/dev/null")
    let user = dir.appendingPathComponent("user")
    let app = SourceUpdate(dir: user.appendingPathComponent("mac/QuotaBar"))
    _ = try commit("mac/QuotaBar/a.swift", "2", in: ci)
    try sh("git push -q origin main:\(SourceUpdate.branch)", in: ci)
    try sh("printf mine > mac/QuotaBar/a.swift", in: user)
    XCTAssertEqual(try app.newer(than: c1).count, 1)
    XCTAssertThrowsError(try app.fastForward())
    XCTAssertEqual(try sh("cat mac/QuotaBar/a.swift", in: user), "mine")
  }

  func testNoRemoteIsAnError() throws {
    try sh("git init -q -b main user && cd user && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m x")
    let app = SourceUpdate(dir: dir.appendingPathComponent("user"))
    XCTAssertThrowsError(try app.newer(than: "HEAD"))
  }

  func testATimeoutStopsTheCommand() throws {
    let start = Date()
    XCTAssertThrowsError(try SourceUpdate.run(["sleep", "10"], in: dir, timeout: 0.5))
    XCTAssertLessThan(Date().timeIntervalSince(start), 5)
  }
}
