import Foundation
import XCTest
@testable import QuotaCore

final class ModelRoutesTests: XCTestCase {
  func testARequestGoesToTheFirstGatewayThatListsItsModel() {
    let r = ModelRoutes(company: ["claude-a", "shared"], lists: [.init(id: "glm", models: ["glm-b", "shared", "both"]), .init(id: "ds", models: ["ds-c", "both"])])
    XCTAssertEqual(r.route("claude-a"), .company)
    XCTAssertEqual(r.route("glm-b"), .gateway("glm"))
    XCTAssertEqual(r.route("ds-c"), .gateway("ds"))
    // Listed by several: the first in order (the company's first).
    XCTAssertEqual(r.route("shared"), .company)
    XCTAssertEqual(r.route("both"), .gateway("glm"))
    XCTAssertEqual(r.taken(from: "glm"), ["shared"])
    XCTAssertEqual(r.taken(from: "ds"), ["both"])
    XCTAssertEqual(r.models(of: "ds"), ["ds-c", "both"])
    XCTAssertNil(r.models(of: "gone"))
    // The order turned round: the other one has it.
    XCTAssertEqual(ModelRoutes(lists: [.init(id: "ds", models: ["both"]), .init(id: "glm", models: ["both"])]).route("both"), .gateway("ds"))
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

  func testAllListsAsOneWithAModelSeveralListOnce() throws {
    let company = Data(#"{"data":[{"id":"claude-a","type":"model","display_name":"A"},{"id":"shared","type":"model"}],"has_more":true,"first_id":"claude-a","last_id":"shared"}"#.utf8)
    let second = Data(#"{"data":[{"id":"glm-b","type":"model"},{"id":"shared","type":"model","display_name":"theirs"}]}"#.utf8)
    let third = Data(#"{"data":[{"id":"ds-c","type":"model"},{"id":"glm-b","type":"model"}]}"#.utf8)
    let merged = try XCTUnwrap(ModelRoutes.merge(company: company, others: [second, nil, Data("oops".utf8), third]))
    XCTAssertEqual(ModelRoutes.ids(in: merged), ["claude-a", "shared", "glm-b", "ds-c"])
    let o = try XCTUnwrap(JSONSerialization.jsonObject(with: merged) as? [String: Any])
    XCTAssertEqual(o["has_more"] as? Bool, false)
    XCTAssertEqual(o["first_id"] as? String, "claude-a")
    XCTAssertEqual(o["last_id"] as? String, "ds-c")
    // The first entry for a model several list stays (with its fields).
    let shared = (o["data"] as? [[String: Any]])?.first { $0["id"] as? String == "shared" }
    XCTAssertNil(shared?["display_name"])
    XCTAssertEqual(ModelRoutes.ids(in: try XCTUnwrap(ModelRoutes.merge(company: company, others: []))), ["claude-a", "shared"])
    // The company's not a list: nothing to merge into.
    XCTAssertNil(ModelRoutes.merge(company: Data(#"{"error":"x"}"#.utf8), others: [second]))
  }

  func testModelsTypedInAreAddedToAListOrStandForOne() throws {
    let list = Data(#"{"data":[{"id":"a","type":"model"}],"has_more":false}"#.utf8)
    XCTAssertEqual(ModelRoutes.ids(in: try XCTUnwrap(ModelRoutes.adding(["b", "a", "b"], to: list))), ["a", "b"])
    XCTAssertEqual(ModelRoutes.ids(in: try XCTUnwrap(ModelRoutes.adding(["x"], to: nil))), ["x"])
    XCTAssertEqual(ModelRoutes.ids(in: try XCTUnwrap(ModelRoutes.adding([], to: list))), ["a"])
    XCTAssertNil(ModelRoutes.adding([], to: nil))
  }

  func testAMappedModelGoesWhereItsMappingSaysBeforeAnyList() {
    let r = ModelRoutes(company: ["claude-haiku-5-5", "shared"], lists: [.init(id: "ds", models: ["deepseek-chat", "shared"])],
                        renames: ["claude-haiku-5-5": .init(gateway: "ds", model: "deepseek-chat"), "shared": .init(gateway: nil, model: "claude-x")])
    XCTAssertEqual(r.route("claude-haiku-5-5"), .renamed(.init(gateway: "ds", model: "deepseek-chat")))
    XCTAssertEqual(r.route("shared"), .renamed(.init(gateway: nil, model: "claude-x")))
    XCTAssertEqual(r.route("deepseek-chat"), .gateway("ds"))
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
