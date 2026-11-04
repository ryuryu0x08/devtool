import Foundation
import XCTest
@testable import QuotaCore

final class PeopleTests: XCTestCase {
  private let r1 = GoodReading(at: Date(timeIntervalSince1970: 1), usage: Usage(daily: 1))
  private let r2 = GoodReading(at: Date(timeIntervalSince1970: 2), usage: Usage(daily: 2))

  func testANewKeyShowsItsStartUntilItsNameIsKnown() {
    var ps: [Person] = []
    guard case .added(let id) = People.add("  sk-abcdefghijk\n", to: &ps) else { return XCTFail() }
    XCTAssertEqual(ps.map(\.key), ["sk-abcdefghijk"])
    XCTAssertEqual(ps[0].label, "sk-abcdefg...")
    XCTAssertEqual(People.add("sk-abcdefghijk", to: &ps), .exists(id: id))
    XCTAssertEqual(People.add(" ", to: &ps), .empty)
    People.bind(id: id, name: "yy", reading: r1, in: &ps)
    XCTAssertEqual(ps, [Person(id: id, name: "yy", key: "sk-abcdefghijk", lastGood: r1)])
    XCTAssertEqual(ps[0].label, "yy")
  }

  func testANewKeyOfAKnownNameTakesThePlaceOfTheOldKey() {
    var ps = [Person(id: "a", name: "野", key: "sk-old", lastGood: r1), Person(id: "b", name: "66", key: "sk-66")]
    guard case .added(let id) = People.add("sk-new", to: &ps) else { return XCTFail() }
    let b = People.bind(id: id, name: "野", reading: r2, in: &ps)
    XCTAssertEqual(b, People.Bound(id: "a", replaced: "sk-old", merged: id))
    // Same person (id, place in the list), new key, the new reading.
    XCTAssertEqual(ps, [Person(id: "a", name: "野", key: "sk-new", lastGood: r2), Person(id: "b", name: "66", key: "sk-66")])
  }

  func testTheSameKeyReadAgainOnlyUpdatesTheReading() {
    var ps = [Person(id: "a", name: "野", key: "sk-1", lastGood: r1)]
    XCTAssertEqual(People.bind(id: "a", name: "野", reading: r2, in: &ps), People.Bound(id: "a", replaced: nil, merged: nil))
    XCTAssertEqual(ps, [Person(id: "a", name: "野", key: "sk-1", lastGood: r2)])
    // No name in the reply: the reading still counts.
    People.bind(id: "a", name: "", reading: r1, in: &ps)
    XCTAssertEqual(ps[0].lastGood, r1)
    XCTAssertEqual(ps[0].name, "野")
  }

  func testAKeyThatTurnsOutToBeSomeoneElsesGoesToThem() {
    // a's key now reads as 66: it is 66's key; a keeps the name and waits for a new key.
    var ps = [Person(id: "a", name: "野", key: "sk-1"), Person(id: "b", name: "66", key: "sk-66")]
    XCTAssertEqual(People.bind(id: "a", name: "66", reading: r1, in: &ps), People.Bound(id: "b", replaced: "sk-66", merged: nil))
    XCTAssertEqual(ps, [Person(id: "a", name: "野", key: ""), Person(id: "b", name: "66", key: "sk-1", lastGood: r1)])
    // To a name not seen before: a new person, next to a.
    var qs = [Person(id: "a", name: "野", key: "sk-1")]
    let b = People.bind(id: "a", name: "新", reading: r1, in: &qs)!
    XCTAssertEqual(qs.map(\.name), ["野", "新"])
    XCTAssertEqual(qs.map(\.key), ["", "sk-1"])
    XCTAssertEqual(qs[1].id, b.id)
  }
}
