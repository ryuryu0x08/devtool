import Foundation
import XCTest
@testable import QuotaCore

final class ModelRoutesTests: XCTestCase {
  func testARequestGoesWhereItsModelIsListedAndAModelBothListIsAConflict() {
    let r = ModelRoutes(company: ["claude-a", "shared"], second: ["glm-b", "shared"])
    XCTAssertEqual(r.route("claude-a"), .company)
    XCTAssertEqual(r.route("glm-b"), .second)
    XCTAssertEqual(r.route("shared"), .conflict("shared"))
    XCTAssertEqual(r.conflicts, ["shared"])
    // Unknown, or none named: the company's.
    XCTAssertEqual(r.route("other"), .company)
    XCTAssertEqual(r.route(nil), .company)
    XCTAssertEqual(ModelRoutes().route("glm-b"), .company)
  }

  func testTheModelARequestAsksFor() {
    XCTAssertEqual(ModelRoutes.model(in: Data(#"{"max_tokens":1,"model":"glm-b","stream":true}"#.utf8)), "glm-b")
    XCTAssertNil(ModelRoutes.model(in: Data(#"{"model":""}"#.utf8)))
    XCTAssertNil(ModelRoutes.model(in: Data(#"{"model":3}"#.utf8)))
    XCTAssertNil(ModelRoutes.model(in: Data(#"["model"]"#.utf8)))
    XCTAssertNil(ModelRoutes.model(in: Data("not json".utf8)))
    XCTAssertNil(ModelRoutes.model(in: Data()))
    XCTAssertEqual(ModelRoutes.model(inPath: "/v1/models/glm-b"), "glm-b")
    XCTAssertEqual(ModelRoutes.model(inPath: "/v1/models/glm%2Db?x=1"), "glm-b")
    XCTAssertNil(ModelRoutes.model(inPath: "/v1/models"))
    XCTAssertNil(ModelRoutes.model(inPath: "/v1/models/a/b"))
    XCTAssertNil(ModelRoutes.model(inPath: "/v1/messages"))
    XCTAssertTrue(ModelRoutes.isList("/v1/models"))
    XCTAssertTrue(ModelRoutes.isList("/v1/models/?limit=1000"))
    XCTAssertFalse(ModelRoutes.isList("/v1/models/glm-b"))
    XCTAssertFalse(ModelRoutes.isList("/v1/messages"))
  }

  func testBothListsAsOneWithAModelBothListOnce() throws {
    let company = Data(#"{"data":[{"id":"claude-a","type":"model","display_name":"A"},{"id":"shared","type":"model"}],"has_more":true,"first_id":"claude-a","last_id":"shared"}"#.utf8)
    let second = Data(#"{"data":[{"id":"glm-b","type":"model"},{"id":"shared","type":"model","display_name":"theirs"}]}"#.utf8)
    let merged = try XCTUnwrap(ModelRoutes.merge(company: company, second: second))
    XCTAssertEqual(ModelRoutes.ids(in: merged), ["claude-a", "shared", "glm-b"])
    let o = try XCTUnwrap(JSONSerialization.jsonObject(with: merged) as? [String: Any])
    XCTAssertEqual(o["has_more"] as? Bool, false)
    XCTAssertEqual(o["first_id"] as? String, "claude-a")
    XCTAssertEqual(o["last_id"] as? String, "glm-b")
    // The company's entry for a model both list stays (with its fields).
    let shared = (o["data"] as? [[String: Any]])?.first { $0["id"] as? String == "shared" }
    XCTAssertNil(shared?["display_name"])
    // The second unreadable or missing: the company's list as it is (has_more set false).
    XCTAssertEqual(ModelRoutes.ids(in: try XCTUnwrap(ModelRoutes.merge(company: company, second: Data("oops".utf8)))), ["claude-a", "shared"])
    XCTAssertEqual(ModelRoutes.ids(in: try XCTUnwrap(ModelRoutes.merge(company: company, second: nil))), ["claude-a", "shared"])
    // The company's not a list: nothing to merge into.
    XCTAssertNil(ModelRoutes.merge(company: Data(#"{"error":"x"}"#.utf8), second: second))
  }

  func testTheConflictReplyNamesTheModelInAnErrorClientsRead() throws {
    let o = try XCTUnwrap(JSONSerialization.jsonObject(with: ModelRoutes.conflictReply("shared")) as? [String: Any])
    XCTAssertEqual(o["type"] as? String, "error")
    let e = try XCTUnwrap(o["error"] as? [String: Any])
    XCTAssertEqual(e["type"] as? String, "invalid_request_error")
    XCTAssertTrue((e["message"] as? String ?? "").contains("shared"))
  }

  func testAMappedModelGoesWhereItsMappingSaysBeforeAnyList() {
    let r = ModelRoutes(company: ["claude-haiku-5-5", "shared"], second: ["deepseek-chat", "shared"],
                        renames: ["claude-haiku-5-5": .init(toOther: true, model: "deepseek-chat"), "shared": .init(toOther: false, model: "claude-x")])
    XCTAssertEqual(r.route("claude-haiku-5-5"), .renamed(.init(toOther: true, model: "deepseek-chat")))
    // A mapping decides a model both list too.
    XCTAssertEqual(r.route("shared"), .renamed(.init(toOther: false, model: "claude-x")))
    XCTAssertEqual(r.route("deepseek-chat"), .second)
  }

  func testOnlyTheTopLevelModelValueChangesEveryOtherByteStays() throws {
    let body = #"{ "system": [{"type":"text","text":"say \"model\": \"x\"","model":"inner"}],"model" : "claude-haiku-5-5",  "max_tokens":1.0e1, "metadata":{"model":"m"} }"#
    let out = try XCTUnwrap(ModelRoutes.renaming(Data(body.utf8), to: "deepseek-chat"))
    XCTAssertEqual(String(decoding: out, as: UTF8.self),
                   #"{ "system": [{"type":"text","text":"say \"model\": \"x\"","model":"inner"}],"model" : "deepseek-chat",  "max_tokens":1.0e1, "metadata":{"model":"m"} }"#)
    // First member, unicode and escapes around it.
    XCTAssertEqual(String(decoding: try XCTUnwrap(ModelRoutes.renaming(Data(#"{"model":"a","x":"缓存é"}"#.utf8), to: "b")), as: UTF8.self), #"{"model":"b","x":"缓存é"}"#)
    // None at the top level, not a string, or not an object: nothing to change.
    XCTAssertNil(ModelRoutes.renaming(Data(#"{"messages":[{"model":"a"}]}"#.utf8), to: "b"))
    XCTAssertNil(ModelRoutes.renaming(Data(#"{"model":3}"#.utf8), to: "b"))
    XCTAssertNil(ModelRoutes.renaming(Data(#"["model","a"]"#.utf8), to: "b"))
    XCTAssertNil(ModelRoutes.renaming(Data(), to: "b"))
  }
}
