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
  /// Send the whole reply and the end at once, with no pause.
  var together = false
  /// Like a gateway: keep the connection for more requests unless asked to close it.
  var keepAlive = false
  /// A gateway's model list: GET …/v1/models answers these ids (with `modelsStatus`).
  var models: [String]?
  var modelsStatus = 200
  /// The status of the other replies when keeping connections (403: a quota used up).
  var replyStatus = 200

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
      if let models = self.models, head.hasPrefix("GET "), head.split(separator: " ")[1].contains("/v1/models") {
        let body = self.modelsStatus == 200
          ? "{\"data\":[" + models.map { "{\"id\":\"\($0)\",\"type\":\"model\"}" }.joined(separator: ",") + "],\"has_more\":false}"
          : "{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"bad key\"}}"
        let reply = "HTTP/1.1 \(self.modelsStatus) X\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: close\r\n\r\n" + body
        c.send(content: Data(reply.utf8), contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
        return
      }
      if self.keepAlive {
        let body = "{\"ok\":true}"
        let close = head.lowercased().contains("\r\nconnection: close")
        let reply = "HTTP/1.1 \(self.replyStatus) X\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: keep-alive\r\n\r\n" + body
        c.send(content: Data(reply.utf8), completion: .contentProcessed { _ in
          if close { c.cancel() } else { self.read(c, Data(buf[(r.upperBound + length)...])) }
        })
        return
      }
      self.reply(c)
    }
  }

  private func reply(_ c: NWConnection) {
    let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n"
    if together {
      c.send(content: Data((head + "data: one\n\ndata: two\n\n").utf8), contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
      return
    }
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

  func testManyRequestsInARowAllGetTheirWholeReply() async throws {
    // The API's last data and its closing arrive together here, as from many servers.
    let up = Upstream()
    up.together = true
    try await up.start()
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:\(up.port)/api")!)
    let port = try await f.start(preferred: 48030)
    defer { f.stop() }
    let session = URLSession(configuration: .ephemeral)
    for i in 0..<30 {
      var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/v1/billing/usage")!, timeoutInterval: 5)
      req.setValue("Bearer sk-\(i)", forHTTPHeaderField: "Authorization")
      let (data, resp) = try await session.data(for: req)
      XCTAssertEqual((resp as? HTTPURLResponse)?.statusCode, 200, "request \(i)")
      XCTAssertEqual(String(decoding: data, as: UTF8.self), "data: one\n\ndata: two\n\n", "request \(i)")
    }
  }

  /// What a client that keeps connections open (Claude Desktop's) does: a second request right
  /// after the first, on the same connection. It must not reach the API unrewritten.
  func testASecondRequestOnTheSameConnectionIsNotPassedOnRaw() async throws {
    let up = Upstream()
    up.keepAlive = true
    try await up.start()
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:\(up.port)/api")!)
    let port = try await f.start(preferred: 48050)
    defer { f.stop() }
    let two = "POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nConnection: keep-alive\r\nContent-Length: 2\r\n\r\n{}"
      + "GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\nConnection: keep-alive\r\n\r\n"
    let reply = try await rawExchange(port: port, send: two)
    XCTAssertTrue(reply.hasPrefix("HTTP/1.1 200 OK\r\n"), reply)
    XCTAssertTrue(reply.contains("\r\nConnection: close\r\n"), reply)
    XCTAssertEqual(reply.components(separatedBy: "HTTP/1.1 ").count - 1, 1, "one reply on this connection")
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertEqual(up.heads.map { $0.components(separatedBy: "\r\n")[0] }, ["POST /api/v1/messages HTTP/1.1"])
    XCTAssertEqual(up.bodies, ["{}"])
  }

  func testAChunkedBodyIsPassedOnWhole() async throws {
    let up = Upstream()
    up.together = true
    try await up.start()
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:\(up.port)/api")!)
    let port = try await f.start(preferred: 48070)
    defer { f.stop() }
    let req = "POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n4;ext=1\r\n:1}\n\r\n0\r\n\r\n"
    let reply = try await rawExchange(port: port, send: req)
    XCTAssertTrue(reply.hasPrefix("HTTP/1.1 200 OK"), reply)
    let head = up.heads[0].lowercased()
    XCTAssertTrue(head.contains("transfer-encoding: chunked"))
  }

  func testWhereABodyEnds() {
    XCTAssertEqual(LocalForwarder.framing("POST / HTTP/1.1\r\nContent-Length: 12"), .length(12))
    XCTAssertEqual(LocalForwarder.framing("POST / HTTP/1.1\r\ntransfer-encoding: gzip, chunked\r\nContent-Length: 3"), .chunked)
    XCTAssertEqual(LocalForwarder.framing("GET / HTTP/1.1\r\nHost: x"), LocalForwarder.Framing.none)
    XCTAssertNil(LocalForwarder.framing("POST / HTTP/1.1\r\nContent-Length: -1"))
    XCTAssertEqual(LocalForwarder.bodyEnd(.length(3), Data("abcdef".utf8)), 3)
    XCTAssertNil(LocalForwarder.bodyEnd(.length(3), Data("ab".utf8)))
    let chunked = Data("3\r\nabc\r\n0\r\nX-T: 1\r\n\r\nNEXT".utf8)
    XCTAssertEqual(LocalForwarder.bodyEnd(.chunked, chunked), chunked.count - 4)
    XCTAssertNil(LocalForwarder.bodyEnd(.chunked, Data("3\r\nab".utf8)))
    XCTAssertNil(LocalForwarder.bodyEnd(.chunked, Data("3\r\nabc\r\n0\r\n".utf8)))
    XCTAssertEqual(LocalForwarder.bodyEnd(.chunked, Data("zz\r\n".utf8)), -1)
    XCTAssertEqual(LocalForwarder.rewriteReply("HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5\r\nContent-Length: 2"),
                   "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n")
  }

  /// Sends `send` on one TCP connection and returns everything that comes back until it closes.
  private func rawExchange(port: UInt16, send: String) async throws -> String {
    let c = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
    let q = DispatchQueue(label: "raw")
    return await withCheckedContinuation { (k: CheckedContinuation<String, Never>) in
      var got = Data()
      func read() {
        c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { d, _, done, e in
          if let d { got.append(d) }
          if done || e != nil { c.cancel(); k.resume(returning: String(decoding: got, as: UTF8.self)) } else { read() }
        }
      }
      c.stateUpdateHandler = { if case .ready = $0 { c.send(content: Data(send.utf8), completion: .contentProcessed { _ in read() }) } }
      c.start(queue: q)
    }
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

  func testAnAPIThatNeverAnswersGets502InTime() async throws {
    // 10.255.255.1 is not routed: the connection neither succeeds nor fails by itself.
    let f = try LocalForwarder(target: URL(string: "http://10.255.255.1:9/api")!)
    f.connectTimeout = 1
    let p = try await f.start(preferred: 48010)
    defer { f.stop() }
    let started = Date()
    let (_, resp) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:\(p)/v1/models")!)
    XCTAssertEqual((resp as? HTTPURLResponse)?.statusCode, 502)
    XCTAssertLessThan(Date().timeIntervalSince(started), 5)
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

  /// What the app checks before showing the forwarder as on, and at each refresh after.
  func testItAnswersWhileRunningAndStoppingItIsNotTakenForAFailure() async throws {
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:9/api")!)
    let stops = Counter()
    f.onStop = { _ in stops.add() }
    let p = try await f.start(preferred: 48110)
    XCTAssertTrue(LocalForwarder.accepting(p))
    _ = try await f.start(preferred: p)
    XCTAssertTrue(LocalForwarder.accepting(p))
    f.stop()
    try await Task.sleep(for: .milliseconds(500))
    XCTAssertFalse(LocalForwarder.accepting(p))
    XCTAssertEqual(stops.n, 0)
  }

  func testWhenItIsNeeded() {
    XCTAssertTrue(LocalForwarder.needed(for: "http://api-ai-coding.bilibili.co/api"))
    XCTAssertFalse(LocalForwarder.needed(for: "https://api.example.com"))
    XCTAssertFalse(LocalForwarder.needed(for: "http://127.0.0.1:8080"))
    XCTAssertFalse(LocalForwarder.needed(for: "http://localhost/api"))
    XCTAssertNoThrow(try LocalForwarder(target: URL(string: "https://x/api")!))
    XCTAssertThrowsError(try LocalForwarder(target: URL(string: "ftp://x/api")!))
  }

  func testWithAKeyItGoesInPlaceOfTheClients() throws {
    let f = try LocalForwarder(target: URL(string: "https://api.example/api")!)
    f.key = "sk-now"
    XCTAssertEqual(f.rewrite("POST /v1/messages HTTP/1.1\r\nauthorization: Bearer sk-desktop\r\nX-Api-Key: sk-desktop\r\nContent-Length: 2"),
                   "POST /api/v1/messages HTTP/1.1\r\nAuthorization: Bearer sk-now\r\nContent-Length: 2\r\nHost: api.example\r\nConnection: close\r\n\r\n")
    // x-api-key alone counts as a key sent.
    XCTAssertEqual(f.rewrite("GET /v1/models HTTP/1.1\r\nx-api-key: sk-desktop"),
                   "GET /api/v1/models HTTP/1.1\r\nAuthorization: Bearer sk-now\r\nHost: api.example\r\nConnection: close\r\n\r\n")
    // A request with no key of its own (a web page's) doesn't get it.
    XCTAssertEqual(f.rewrite("GET /v1/models HTTP/1.1"),
                   "GET /api/v1/models HTTP/1.1\r\nHost: api.example\r\nConnection: close\r\n\r\n")
    f.key = ""
    XCTAssertNil(f.key)
  }

  /// What the app learns where Desktop is from: each request taken, none turned away.
  func testEachRequestTakenIsTold() async throws {
    let up = Upstream()
    try await up.start()
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:\(up.port)/api")!)
    let told = Counter()
    f.onRequest = { told.add() }
    let port = try await f.start(preferred: 48130)
    defer { f.stop() }
    for _ in 0..<2 {
      var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/v1/models")!)
      req.setValue("Bearer sk-x", forHTTPHeaderField: "Authorization")
      _ = try await URLSession.shared.data(for: req)
    }
    let away = try await rawExchange(port: port, send: "GET /v1/models HTTP/1.1\r\nHost: evil.example\r\n\r\n")
    XCTAssertTrue(away.hasPrefix("HTTP/1.1 403"), away)
    XCTAssertEqual(told.n, 2)
  }

  func testOnlyRequestsAddressedToThisMachine() {
    XCTAssertTrue(LocalForwarder.fromThisMachine("POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1:47831"))
    XCTAssertTrue(LocalForwarder.fromThisMachine("POST /v1/messages HTTP/1.1\r\nhost: LOCALHOST:47831"))
    XCTAssertTrue(LocalForwarder.fromThisMachine("POST /v1/messages HTTP/1.1\r\nHost: [::1]:47831"))
    XCTAssertTrue(LocalForwarder.fromThisMachine("GET / HTTP/1.0"))
    // DNS rebinding: a site's own name, pointed at 127.0.0.1.
    XCTAssertFalse(LocalForwarder.fromThisMachine("POST /v1/messages HTTP/1.1\r\nHost: evil.example:47831"))
    XCTAssertFalse(LocalForwarder.fromThisMachine("POST /v1/messages HTTP/1.1\r\nHost: 127.0.0.1.evil.example"))
  }

  func testTheKeyChangesBetweenRequestsWithNoRestart() async throws {
    let up = Upstream()
    up.keepAlive = true
    try await up.start()
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:\(up.port)/api")!)
    let port = try await f.start(preferred: 47960)
    defer { f.stop() }
    func ask() async throws {
      var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/v1/models")!)
      req.setValue("Bearer sk-desktop", forHTTPHeaderField: "Authorization")
      let (_, resp) = try await URLSession.shared.data(for: req)
      XCTAssertEqual((resp as? HTTPURLResponse)?.statusCode, 200)
    }
    try await ask()
    f.key = "sk-a"
    try await ask()
    f.key = "sk-b"
    try await ask()
    let auth = up.heads.map { $0.components(separatedBy: "\r\n").filter { $0.lowercased().hasPrefix("authorization:") } }
    XCTAssertEqual(auth, [["Authorization: Bearer sk-desktop"], ["Authorization: Bearer sk-a"], ["Authorization: Bearer sk-b"]])
  }

  func testTheHeadIsRewritten() throws {
    let f = try LocalForwarder(target: URL(string: "http://api.example/api")!)
    // No key of ours: the client's goes as it is. Host and Connection change where they were.
    XCTAssertEqual(f.rewrite("GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:47831\r\nConnection: keep-alive\r\nX-Api-Key: k"),
                   "GET /api/v1/models HTTP/1.1\r\nHost: api.example\r\nConnection: close\r\nX-Api-Key: k\r\n\r\n")
    // Every other header as sent, in its order; this connection's own ones (Keep-Alive, TE) go.
    XCTAssertEqual(f.rewrite("POST /v1/messages HTTP/1.1\r\nAuthorization: Bearer k\r\nContent-Type: application/json\r\nanthropic-beta: x\r\nUser-Agent: Claude/1\r\nKeep-Alive: timeout=5\r\nTE: trailers\r\nAccept-Encoding: br\r\nContent-Length: 2"),
                   "POST /api/v1/messages HTTP/1.1\r\nAuthorization: Bearer k\r\nContent-Type: application/json\r\nanthropic-beta: x\r\nUser-Agent: Claude/1\r\nAccept-Encoding: br\r\nContent-Length: 2\r\nHost: api.example\r\nConnection: close\r\n\r\n")
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

private final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var v = 0
  func add() { lock.lock(); v += 1; lock.unlock() }
  var n: Int { lock.lock(); defer { lock.unlock() }; return v }
}

// MARK: - A second gateway

extension LocalForwarderTests {

  /// The company's gateway listing `mine`, a second listing `theirs`, and a forwarder with both.
  private func twoGateways(_ mine: [String], _ theirs: [String], port: UInt16) async throws -> (Upstream, Upstream, LocalForwarder, UInt16) {
    let a = Upstream(), b = Upstream()
    a.models = mine
    b.models = theirs
    a.keepAlive = true
    b.keepAlive = true
    try await a.start()
    try await b.start()
    let f = try LocalForwarder(target: URL(string: "http://127.0.0.1:\(a.port)/api")!)
    f.second = try LocalForwarder.Gateway(url: URL(string: "http://127.0.0.1:\(b.port)/other/")!, key: "sk-second")
    f.routes = ModelRoutes(company: mine, second: theirs)
    let p = try await f.start(preferred: port)
    return (a, b, f, p)
  }

  /// A request through the forwarder: its status and body.
  private func call(_ port: UInt16, _ method: String, _ path: String, body: String? = nil, key: String? = "sk-client") async throws -> (Int, String) {
    var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)\(path)")!)
    req.httpMethod = method
    if let key { req.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
    req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
    req.setValue("tools-2024", forHTTPHeaderField: "anthropic-beta")
    if let body {
      req.httpBody = Data(body.utf8)
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    let (d, r) = try await URLSession.shared.data(for: req)
    return ((r as? HTTPURLResponse)?.statusCode ?? 0, String(decoding: d, as: UTF8.self))
  }

  private func header(_ name: String, _ head: String) -> String? {
    head.components(separatedBy: "\r\n").first { $0.lowercased().hasPrefix(name + ":") }
  }

  func testRequestsGoToTheGatewayThatListsTheirModelWithItsKey() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-a"], ["glm-b"], port: 48200)
    defer { f.stop() }
    f.key = "sk-person"
    var (status, _) = try await call(port, "POST", "/v1/messages?beta=true", body: #"{"model":"glm-b","max_tokens":1}"#)
    XCTAssertEqual(status, 200)
    XCTAssertEqual(b.heads.count, 1)
    XCTAssertEqual(b.heads[0].components(separatedBy: "\r\n")[0], "POST /other/v1/messages?beta=true HTTP/1.1")
    XCTAssertEqual(header("authorization", b.heads[0]), "Authorization: Bearer sk-second")
    XCTAssertEqual(header("host", b.heads[0]), "Host: 127.0.0.1:\(b.port)")
    // Anthropic's version and beta headers reach it, as to the company's.
    XCTAssertEqual(header("anthropic-version", b.heads[0]), "anthropic-version: 2023-06-01")
    XCTAssertEqual(header("anthropic-beta", b.heads[0]), "anthropic-beta: tools-2024")
    XCTAssertEqual(b.bodies[0], #"{"model":"glm-b","max_tokens":1}"#)
    // The company's model, and one neither lists: the company's gateway, with the person's key.
    for m in ["claude-a", "unknown"] {
      (status, _) = try await call(port, "POST", "/v1/messages/count_tokens", body: #"{"model":"\#(m)"}"#)
      XCTAssertEqual(status, 200)
    }
    XCTAssertEqual(a.heads.count, 2)
    XCTAssertEqual(a.heads.map { header("authorization", $0) }, ["Authorization: Bearer sk-person", "Authorization: Bearer sk-person"])
    XCTAssertEqual(header("anthropic-beta", a.heads[0]), "anthropic-beta: tools-2024")
    XCTAssertEqual(b.heads.count, 1)
    // One model by its path.
    (status, _) = try await call(port, "GET", "/v1/models/glm-b")
    XCTAssertEqual(status, 200)
    XCTAssertEqual(b.heads.last?.components(separatedBy: "\r\n")[0], "GET /other/v1/models/glm-b HTTP/1.1")
    // No second gateway any more: everything to the company's.
    f.second = nil
    (status, _) = try await call(port, "POST", "/v1/messages", body: #"{"model":"glm-b"}"#)
    XCTAssertEqual(status, 200)
    XCTAssertEqual(a.heads.count, 3)
  }

  func testTheModelListIsBothListsAsOneEachReadWithItsKey() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-a"], ["glm-b"], port: 48220)
    defer { f.stop() }
    let told = Box<[[String]]>()
    f.onModels = { told.set([$0, $1]) }
    let (status, body) = try await call(port, "GET", "/v1/models?limit=1000")
    XCTAssertEqual(status, 200)
    XCTAssertEqual(ModelRoutes.ids(in: Data(body.utf8)), ["claude-a", "glm-b"])
    XCTAssertEqual(a.heads.count, 1)
    XCTAssertEqual(a.heads[0].components(separatedBy: "\r\n")[0], "GET /api/v1/models?limit=1000 HTTP/1.1")
    XCTAssertEqual(header("authorization", a.heads[0]), "Authorization: Bearer sk-client")
    XCTAssertEqual(header("authorization", b.heads[0]), "Authorization: Bearer sk-second")
    XCTAssertEqual(told.value, [["claude-a"], ["glm-b"]])
    // The second gateway down (or turning the key down): the company's models only.
    b.modelsStatus = 401
    let (s2, body2) = try await call(port, "GET", "/v1/models")
    XCTAssertEqual(s2, 200)
    XCTAssertEqual(ModelRoutes.ids(in: Data(body2.utf8)), ["claude-a"])
    // ...and its models still go to it (the list read before stands).
    _ = try await call(port, "POST", "/v1/messages", body: #"{"model":"glm-b"}"#)
    XCTAssertEqual(b.bodies.last, #"{"model":"glm-b"}"#)
    // A company's gateway with no model list (404): the second's models are the list.
    a.modelsStatus = 404
    b.modelsStatus = 200
    let (s4, body4) = try await call(port, "GET", "/v1/models")
    XCTAssertEqual(s4, 200)
    XCTAssertEqual(ModelRoutes.ids(in: Data(body4.utf8)), ["glm-b"])
    // The company's turning the key down: its answer, as it is.
    a.modelsStatus = 401
    let (s3, body3) = try await call(port, "GET", "/v1/models")
    XCTAssertEqual(s3, 401)
    XCTAssertTrue(body3.contains("authentication_error"), body3)
  }

  func testAModelBothListIsTurnedAwaySayingWhy() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-a", "shared"], ["glm-b", "shared"], port: 48240)
    defer { f.stop() }
    let (status, body) = try await call(port, "POST", "/v1/messages", body: #"{"model":"shared"}"#)
    XCTAssertEqual(status, 409)
    XCTAssertTrue(body.contains("shared") && body.contains("invalid_request_error"), body)
    XCTAssertTrue(a.heads.isEmpty && b.heads.isEmpty)
    // Listed once.
    let (_, list) = try await call(port, "GET", "/v1/models")
    XCTAssertEqual(ModelRoutes.ids(in: Data(list.utf8)), ["claude-a", "shared", "glm-b"])
    XCTAssertEqual(f.routes.conflicts, ["shared"])
  }

  func testWithNoKeySentTheSecondGatewaysKeyIsNotAdded() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-a"], ["glm-b"], port: 48260)
    defer { f.stop(); withExtendedLifetime(a) {} }
    _ = try await call(port, "POST", "/v1/messages", body: #"{"model":"glm-b"}"#, key: nil)
    XCTAssertEqual(b.heads.count, 1)
    XCTAssertNil(header("authorization", b.heads[0]))
  }

  /// What matters for a gateway and its cache arrives as sent: only the key, the path's front,
  /// Host and this connection's own headers change; the body is the same bytes.
  func testOnlyTheKeyPathHostAndConnectionChangeTheRestArrivesByteForByte() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-a"], ["glm-b"], port: 48280)
    defer { f.stop() }
    f.key = "sk-person"
    for (model, up, key, prefix) in [("glm-b", b, "sk-second", "/other"), ("claude-a", a, "sk-person", "/api")] {
      // Odd spacing, key order, escapes and characters: re-encoding JSON would change them.
      let body = "{ \"system\":[{\"type\":\"text\",\"text\":\"缓存 \\u00e9\",\"cache_control\":{\"type\":\"ephemeral\"}}],\n  \"model\" : \"\(model)\", \"max_tokens\":1.0e1 }"
      let head = [
        "POST /v1/messages?beta=true HTTP/1.1",
        "Host: 127.0.0.1:\(port)",
        "User-Agent: claude-cli/9.9.9 (external, cli)",
        "x-api-key: sk-client",
        "anthropic-version: 2023-06-01",
        "anthropic-beta: prompt-caching-2024-07-31,interleaved-thinking-2025-05-14",
        "X-Stainless-Lang: js",
        "Accept-Encoding: gzip, br",
        "Keep-Alive: timeout=5",
        "Connection: keep-alive",
        "Content-Type: application/json",
        "Content-Length: \(body.utf8.count)",
      ]
      _ = try await rawExchange(port: port, send: head.joined(separator: "\r\n") + "\r\n\r\n" + body)
      XCTAssertEqual(up.heads.last?.components(separatedBy: "\r\n"), [
        "POST \(prefix)/v1/messages?beta=true HTTP/1.1",
        "Host: 127.0.0.1:\(up.port)",
        "User-Agent: claude-cli/9.9.9 (external, cli)",
        "Authorization: Bearer \(key)",
        "anthropic-version: 2023-06-01",
        "anthropic-beta: prompt-caching-2024-07-31,interleaved-thinking-2025-05-14",
        "X-Stainless-Lang: js",
        "Accept-Encoding: gzip, br",
        "Connection: close",
        "Content-Type: application/json",
        "Content-Length: \(body.utf8.count)",
      ])
      XCTAssertEqual(up.bodies.last, body)
    }
  }

  func testEachRequestIsRecordedWithItsGatewayModelKeyAndOutcome() async throws {
    // The stand-ins are kept to the end (their listeners use them).
    let (up1, up2, f, port) = try await twoGateways(["claude-a", "shared"], ["glm-b", "shared"], port: 48300)
    defer { f.stop(); withExtendedLifetime((up1, up2)) {} }
    let log = RequestLog()
    f.requestLog = log
    f.key = "sk-person-0001"
    f.keyNames = ["sk-person-0001": "ye", "sk-second": "其他网关的 key"]
    _ = try await call(port, "POST", "/v1/messages?beta=true", body: #"{"model":"glm-b"}"#)
    _ = try await call(port, "POST", "/v1/messages", body: #"{"model":"claude-a"}"#)
    _ = try await call(port, "POST", "/v1/messages", body: #"{"model":"shared"}"#)
    _ = try await call(port, "GET", "/v1/models")
    _ = try await call(port, "POST", "/v1/messages", body: #"{"model":"claude-a"}"#, key: nil)
    // Newest first.
    let r = Array(log.recent().reversed())
    XCTAssertEqual(r.map(\.gateway), [.other, .company, .refused, .both, .company])
    XCTAssertEqual(r.map(\.model), ["glm-b", "claude-a", "shared", nil, "claude-a"])
    XCTAssertEqual(r.map(\.key), ["其他网关的 key", "ye", nil, "ye", nil])
    XCTAssertEqual(r.map(\.status), [200, 200, 409, 200, 200])
    XCTAssertEqual(r[0].path, "/v1/messages")
    XCTAssertTrue(r.allSatisfy { $0.ms != nil })
    // A key with no name: its end only.
    f.keyNames = [:]
    _ = try await call(port, "POST", "/v1/messages", body: #"{"model":"claude-a"}"#)
    XCTAssertEqual(log.recent().first?.key, "…0001")
  }

  func testAMappedModelIsSentAsTheOtherWithOnlyItsNameAndLengthChanged() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-haiku-5-5"], ["deepseek-chat"], port: 48320)
    defer { f.stop(); withExtendedLifetime((a, b)) {} }
    let log = RequestLog()
    f.requestLog = log
    f.keyNames = ["sk-second": "其他网关的 key"]
    f.routes = ModelRoutes(company: ["claude-haiku-5-5"], second: ["deepseek-chat"], renames: ["claude-haiku-5-5": .init(toOther: true, model: "deepseek-chat")])
    let body = #"{"model":"claude-haiku-5-5","messages":[{"role":"user","content":"hi"}],"stream":false}"#
    let (status, _) = try await call(port, "POST", "/v1/messages", body: body)
    XCTAssertEqual(status, 200)
    XCTAssertTrue(a.heads.isEmpty)
    let sent = #"{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}],"stream":false}"#
    XCTAssertEqual(b.bodies.last, sent)
    XCTAssertEqual(header("content-length", b.heads[0]), "Content-Length: \(sent.utf8.count)")
    XCTAssertEqual(header("authorization", b.heads[0]), "Authorization: Bearer sk-second")
    let r = try XCTUnwrap(log.recent().first)
    XCTAssertEqual([r.model, r.mappedTo, r.key], ["claude-haiku-5-5", "deepseek-chat", "其他网关的 key"])
    XCTAssertEqual(r.gateway, .other)
    XCTAssertEqual(r.status, 200)
  }

  func testA403FromTheCompanyIsSentToTheOtherGatewayAsTheFallbackModelAndSoAreTheNextOnes() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-opus-5-5"], ["deepseek-v4.1-flash"], port: 48340)
    defer { f.stop(); withExtendedLifetime((a, b)) {} }
    let log = RequestLog()
    f.requestLog = log
    f.fallback = "deepseek-v4.1-flash"
    let started = Box<Date>()
    f.onFallback = { started.set($0) }
    a.replyStatus = 403
    let body = #"{"model":"claude-opus-5-5","max_tokens":1}"#
    // The client gets the other gateway's answer, not the 403.
    var (status, _) = try await call(port, "POST", "/v1/messages", body: body)
    XCTAssertEqual(status, 200)
    XCTAssertEqual(a.bodies, [body])
    XCTAssertEqual(b.bodies, [#"{"model":"deepseek-v4.1-flash","max_tokens":1}"#])
    XCTAssertEqual(header("authorization", b.heads[0]), "Authorization: Bearer sk-second")
    XCTAssertNotNil(started.value)
    XCTAssertNotNil(f.fallbackUntil)
    // The next one goes straight there.
    (status, _) = try await call(port, "POST", "/v1/messages", body: body)
    XCTAssertEqual(status, 200)
    XCTAssertEqual(a.bodies.count, 1)
    XCTAssertEqual(b.bodies.count, 2)
    let r = Array(log.recent().reversed())
    XCTAssertEqual(r.map(\.gateway), [.company, .other, .other])
    XCTAssertEqual(r.map(\.status), [403, 200, 200])
    XCTAssertEqual(r.map(\.mappedTo), [nil, "deepseek-v4.1-flash", "deepseek-v4.1-flash"])
    // Turned off: a 403 goes back as it is.
    f.fallback = nil
    XCTAssertNil(f.fallbackUntil)
    (status, _) = try await call(port, "POST", "/v1/messages", body: body)
    XCTAssertEqual(status, 403)
    XCTAssertEqual(b.bodies.count, 2)
  }

  func testOnlyA403FallsBackAndOnlyForAModelOfTheCompany() async throws {
    let (a, b, f, port) = try await twoGateways(["claude-opus-5-5"], ["deepseek-v4.1-flash"], port: 48360)
    defer { f.stop(); withExtendedLifetime((a, b)) {} }
    f.fallback = "deepseek-v4.1-flash"
    a.replyStatus = 500
    let (status, _) = try await call(port, "POST", "/v1/messages", body: #"{"model":"claude-opus-5-5"}"#)
    XCTAssertEqual(status, 500)
    XCTAssertTrue(b.heads.isEmpty)
    XCTAssertNil(f.fallbackUntil)
    // A request with no model (a GET): no fallback either.
    a.replyStatus = 403
    let (s2, _) = try await call(port, "GET", "/v1/billing/usage")
    XCTAssertEqual(s2, 403)
    XCTAssertTrue(b.heads.isEmpty)
  }

  func testAGatewayMustBeHTTP() {
    XCTAssertThrowsError(try LocalForwarder.Gateway(url: URL(string: "ftp://x")!, key: "k"))
    XCTAssertEqual(ModelLists.listURL(URL(string: "http://h:8080/api/")!)?.absoluteString, "http://h:8080/api/v1/models")
    XCTAssertEqual(ModelLists.listURL(URL(string: "https://h/")!)?.absoluteString, "https://h/v1/models")
  }
}

/// A value set from any thread.
private final class Box<T>: @unchecked Sendable {
  private let lock = NSLock()
  private var v: T?
  func set(_ x: T) { lock.lock(); v = x; lock.unlock() }
  var value: T? { lock.lock(); defer { lock.unlock() }; return v }
}

