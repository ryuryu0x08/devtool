import Foundation
import Network
import XCTest
@testable import QuotaCore

/// A stand-in model API on 127.0.0.1: records each request's head and body, then answers with a
/// stream of two events 300 ms apart.
private final class Upstream: @unchecked Sendable {
  let queue = DispatchQueue(label: "Upstream")
  var listener: NWListener!
  var port: UInt16 = 0
  var heads: [String] = []
  var bodies: [String] = []

  func start() async throws {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: params)
    listener.newConnectionHandler = { [unowned self] c in
      c.start(queue: self.queue)
      self.read(c, Data())
    }
    await withCheckedContinuation { (k: CheckedContinuation<Void, Never>) in
      listener.stateUpdateHandler = { if case .ready = $0 { k.resume() } }
      listener.start(queue: queue)
    }
    port = listener.port!.rawValue
  }

  private func read(_ c: NWConnection, _ got: Data) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [unowned self] data, _, _, _ in
      var buf = got
      if let data { buf.append(data) }
      guard let r = buf.range(of: Data("\r\n\r\n".utf8)) else { return self.read(c, buf) }
      let head = String(decoding: buf[..<r.lowerBound], as: UTF8.self)
      let length = head.components(separatedBy: "\r\n")
        .first { $0.lowercased().hasPrefix("content-length:") }
        .flatMap { Int($0.split(separator: ":")[1].trimmingCharacters(in: .whitespaces)) } ?? 0
      guard buf.count - r.upperBound >= length else { return self.read(c, buf) }
      self.heads.append(head)
      self.bodies.append(String(decoding: buf[r.upperBound..<(r.upperBound + length)], as: UTF8.self))
      self.reply(c)
    }
  }

  private func reply(_ c: NWConnection) {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n"
    c.send(content: Data((head + "data: one\n\n").utf8), completion: .contentProcessed { _ in
      self.queue.asyncAfter(deadline: .now() + 0.3) {
        c.send(content: Data("data: two\n\n".utf8), contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
      }
    })
  }
}

final class LocalForwarderTests: XCTestCase {
  func testPassesRequestsOnToTheAPIWithItsPathAndHostAndStreamsTheReply() async throws {
    let up = Upstream()
    try await up.start()
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:\(up.port)/api/")!)
    let port = try await f.start(preferred: 47900)
    defer { f.stop() }
    XCTAssertEqual(f.url, "http://127.0.0.1:\(port)")

    var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/v1/messages?beta=true")!)
    req.httpMethod = "POST"
    req.setValue("Bearer sk-x", forHTTPHeaderField: "Authorization")
    req.httpBody = Data(#"{"model":"m","stream":true}"#.utf8)
    let started = Date()
    let (bytes, resp) = try await URLSession.shared.bytes(for: req)
    XCTAssertEqual((resp as? HTTPURLResponse)?.statusCode, 200)
    var lines: [(String, TimeInterval)] = []
    for try await line in bytes.lines { lines.append((line, Date().timeIntervalSince(started))) }

    XCTAssertEqual(lines.map(\.0), ["data: one", "data: two"])
    // The first event came before the second was sent: streamed, not held back.
    XCTAssertLessThan(lines[0].1 + 0.2, lines[1].1)
    let head = up.heads[0].components(separatedBy: "\r\n")
    XCTAssertEqual(head[0], "POST /api/v1/messages?beta=true HTTP/1.1")
    XCTAssertTrue(head.contains("Host: 127.0.0.1:\(up.port)"))
    XCTAssertTrue(head.contains("Authorization: Bearer sk-x"))
    XCTAssertTrue(head.contains("Connection: close"))
    XCTAssertEqual(up.bodies[0], #"{"model":"m","stream":true}"#)
  }

  func testATakenPortMovesToTheNextAndAnUnreachableAPIAnswers502() async throws {
    let f1 = try LocalForwarder(target: URL(string: "http://127.0.0.1:9/api")!)
    let f2 = try LocalForwarder(target: URL(string: "http://127.0.0.1:9/api")!)
    let p1 = try await f1.start(preferred: 47950)
    let p2 = try await f2.start(preferred: p1)
    defer { f1.stop(); f2.stop() }
    XCTAssertEqual(p2, p1 + 1)
    // Held by another program (a plain socket): skipped too.
    let s = socket(AF_INET, SOCK_STREAM, 0)
    defer { Darwin.close(s) }
    var a = sockaddr_in()
    a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    a.sin_family = sa_family_t(AF_INET)
    a.sin_port = UInt16(47970).bigEndian
    a.sin_addr.s_addr = inet_addr("127.0.0.1")
    _ = withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    Darwin.listen(s, 1)
    XCTAssertFalse(LocalForwarder.free(47970))
    let f3 = try LocalForwarder(target: URL(string: "http://127.0.0.1:9/api")!)
    let p3 = try await f3.start(preferred: 47970)
    XCTAssertEqual(p3, 47971)
    f3.stop()

    let (data, resp) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(p1)/v1/models")!)
    XCTAssertEqual((resp as? HTTPURLResponse)?.statusCode, 502)
    XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("连不上 127.0.0.1:9"))
  }

  func testRestartingKeepsThePort() async throws {
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:9/api")!)
    let p = try await f.start(preferred: 47990)
    for _ in 0..<3 {
      let again = try await f.start(preferred: p)
      XCTAssertEqual(again, p)
    }
    f.stop()
  }

  func testWhenItIsNeeded() {
    XCTAssertTrue(LocalForwarder.needed(for: "http://api-ai-coding.bilibili.co/api"))
    XCTAssertFalse(LocalForwarder.needed(for: "https://api.example.com"))
    XCTAssertFalse(LocalForwarder.needed(for: "http://127.0.0.1:8080"))
    XCTAssertFalse(LocalForwarder.needed(for: "http://localhost/api"))
    XCTAssertThrowsError(try LocalForwarder(target: URL(string: "https://x/api")!))
  }

  func testTheHeadIsRewritten() throws {
    let f = try LocalForwarder(target: URL(string: "http://api.example/api")!)
    XCTAssertEqual(f.rewrite("GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:47831\r\nConnection: keep-alive\r\nX-Api-Key: k"),
                   "GET /api/v1/models HTTP/1.1\r\nX-Api-Key: k\r\nHost: api.example\r\nConnection: close\r\n\r\n")
    XCTAssertNil(f.rewrite("GET http://elsewhere/ HTTP/1.1"))
  }

  func testDesktopsAddressIsReplacedWithoutAskingOnlyWhenItIsOurs() {
    let ours = ["http://127.0.0.1:47831", "http://api.example/api"]
    XCTAssertEqual(DesktopURL.change(current: "http://127.0.0.1:47832/", want: "http://127.0.0.1:47832", ours: ours), .same)
    XCTAssertEqual(DesktopURL.change(current: "http://127.0.0.1:47831", want: "http://127.0.0.1:47832", ours: ours), .replace)
    XCTAssertEqual(DesktopURL.change(current: "http://api.example/api/", want: "http://127.0.0.1:47832", ours: ours), .replace)
    XCTAssertEqual(DesktopURL.change(current: "https://other.example", want: "http://127.0.0.1:47832", ours: ours), .ask)
    XCTAssertEqual(DesktopURL.change(current: nil, want: "http://127.0.0.1:47832", ours: ours), .ask)
  }
}
