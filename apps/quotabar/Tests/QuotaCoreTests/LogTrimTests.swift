import Foundation
import XCTest
@testable import QuotaCore

final class LogTrimTests: XCTestCase {
  func testOnlyTheLastMinutesStayWithTheLinesThatBelongToThem() {
    let text = """
    stray line from before
    2026-11-09 12:00:00.000 +0800 old
    old build output
    2026-11-09 12:09:59.999 +0800 just too old
    2026-11-09 12:10:00.000 +0800 kept
    build output, kept with it
    2026-11-09 12:15:00.500 +0800 newest

    """
    let since = LogTrim.time("2026-11-09 12:10:00.000 +0800")!
    XCTAssertEqual(LogTrim.keep(text, since: since), """
    2026-11-09 12:10:00.000 +0800 kept
    build output, kept with it
    2026-11-09 12:15:00.500 +0800 newest

    """)
    // All of it old: nothing left.
    XCTAssertEqual(LogTrim.keep(text, since: since.addingTimeInterval(3600)), "")
    XCTAssertEqual(LogTrim.keep("", since: since), "")
  }

  func testTimesInAnyZoneCompareAsTheSameMoment() {
    let a = LogTrim.time("2026-11-09 12:00:00.000 +0800")!
    let b = LogTrim.time("2026-11-09 04:00:00.000 +0000")!
    XCTAssertEqual(a, b)
    XCTAssertNil(LogTrim.time("not a time at all, but long enough to look"))
    XCTAssertNil(LogTrim.time("2026-11-09"))
  }
}
