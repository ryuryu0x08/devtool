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
      if self.keepAlive {
        let body = "{\"ok\":true}"
        let close = head.lowercased().contains("\r\nconnection: close")
        let reply = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\nConnection: keep-alive\r\n\r\n" + body
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
    let req = "POST /v1/messages HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{\"a\"\r\n4;ext=1\r\n:1}\n\r\n0\r\n\r\n"
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
                   "POST /api/v1/messages HTTP/1.1\r\nContent-Length: 2\r\nAuthorization: Bearer sk-now\r\nHost: api.example\r\nUser-Agent: QuotaBar\r\nConnection: close\r\n\r\n")
    // A request with no key of its own gets it too.
    XCTAssertEqual(f.rewrite("GET /v1/models HTTP/1.1"),
                   "GET /api/v1/models HTTP/1.1\r\nAuthorization: Bearer sk-now\r\nHost: api.example\r\nUser-Agent: QuotaBar\r\nConnection: close\r\n\r\n")
    f.key = ""
    XCTAssertNil(f.key)
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
    XCTAssertEqual(f.rewrite("GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:47831\r\nConnection: keep-alive\r\nX-Api-Key: k"),
                   "GET /api/v1/models HTTP/1.1\r\nHost: api.example\r\nUser-Agent: QuotaBar\r\nConnection: close\r\n\r\n")
    // Only the headers the Python forwarder passes on, and the body's framing.
    XCTAssertEqual(f.rewrite("POST /v1/messages HTTP/1.1\r\nAuthorization: Bearer k\r\nContent-Type: application/json\r\nanthropic-beta: x\r\nUser-Agent: Claude/1\r\nAccept-Encoding: br\r\nContent-Length: 2"),
                   "POST /api/v1/messages HTTP/1.1\r\nAuthorization: Bearer k\r\nContent-Type: application/json\r\nContent-Length: 2\r\nHost: api.example\r\nUser-Agent: QuotaBar\r\nConnection: close\r\n\r\n")
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
