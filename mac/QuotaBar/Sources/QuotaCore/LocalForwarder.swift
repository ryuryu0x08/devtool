// A forwarder on 127.0.0.1 to the model API (http or https): Claude Desktop accepts http only for
// this machine, so it is pointed here and the forwarder passes each request on. With `key` set,
// that key goes with every request instead of the one Desktop sent: the key changes here at once,
// with no restart of Desktop (which reads its own only at launch). One request per
// connection, read whole (head and body); its head is rewritten (the API's path in front of the
// path asked for, the API's Host, Connection: close), and so is the reply's (Connection: close, so
// that a client keeping connections open doesn't send its next request down this one). The reply's
// body is passed on as it comes, so streamed replies arrive as they are sent.
import Foundation
import Network

public final class LocalForwarder: @unchecked Sendable {
  public enum Failure: Error, Equatable, LocalizedError {
    case notHTTP
    case noPort(UInt16)
    case notAnswering(UInt16)

    public var errorDescription: String? {
      switch self {
      case .notHTTP: return "转发只用于 http:// 或 https:// 地址"
      case .noPort(let p): return "端口 \(p) 起都被占用"
      case .notAnswering(let p): return "端口 \(p) 开了但连不上"
      }
    }
  }

  /// The port tried first unless one was used before: rarely taken.
  public static let defaultPort: UInt16 = 47831

  public let target: URL
  public private(set) var port: UInt16?
  /// How long to wait for the model API to accept a connection before answering 502.
  public var connectTimeout: TimeInterval = 15
  /// Told what happens to each request (for the app's log).
  public var log: (@Sendable (String) -> Void)?
  /// Told (on the forwarder's queue) when the listener stops by itself after it started (the
  /// system ended it, e.g. around sleep): the port no longer answers. Not called for `stop()`.
  public var onStop: (@Sendable (String) -> Void)?
  private let host: String
  private let targetPort: UInt16
  private let tls: Bool
  private let lock = NSLock()
  private var _key: String?

  /// The key sent with every request in place of the client's (nil: the client's as it is).
  public var key: String? {
    get { lock.lock(); defer { lock.unlock() }; return _key }
    set { lock.lock(); _key = newValue.flatMap { $0.isEmpty ? nil : $0 }; lock.unlock() }
  }
  private let prefix: String
  private let queue = DispatchQueue(label: "QuotaBar.LocalForwarder")
  private var listener: NWListener?
  /// Set by `stop()` for the listener it ends, so that its ending isn't taken for a failure.
  private var stopping = Flag()

  public init(target: URL) throws {
    let scheme = target.scheme?.lowercased()
    guard scheme == "http" || scheme == "https", let h = target.host, !h.isEmpty else { throw Failure.notHTTP }
    self.target = target
    host = h
    tls = scheme == "https"
    targetPort = UInt16(target.port ?? (tls ? 443 : 80))
    var p = target.path
    while p.hasSuffix("/") { p.removeLast() }
    prefix = p
  }

  /// The address to give Claude Desktop once started.
  public var url: String? { port.map { "http://127.0.0.1:\($0)" } }

  /// The address of a forwarder on `port`.
  public static func url(port: UInt16) -> String { "http://127.0.0.1:\(port)" }

  /// Needed for `url`: http, and not this machine.
  public static func needed(for url: String) -> Bool {
    guard let u = URL(string: url.trimmingCharacters(in: .whitespaces)), u.scheme?.lowercased() == "http", let h = u.host?.lowercased() else { return false }
    return !["127.0.0.1", "localhost", "::1", "[::1]"].contains(h)
  }

  /// Starts on `preferred`, or the next free port after it (up to `tries` ports). Returns the port.
  public func start(preferred: UInt16 = LocalForwarder.defaultPort, tries: Int = 20) async throws -> UInt16 {
    stop()
    for i in 0..<tries {
      let p = preferred &+ UInt16(i)
      // The port it had: a forwarder just stopped may take a moment to let go of it.
      if i == 0 {
        for _ in 0..<10 where !Self.free(p) { try? await Task.sleep(for: .milliseconds(100)) }
      }
      if p == 0 || !Self.free(p) { continue }
      if let l = await listen(on: p) {
        listener = l
        port = p
        return p
      }
    }
    throw Failure.noPort(preferred)
  }

  public func stop() {
    stopping.set()
    listener?.cancel()
    listener = nil
    port = nil
  }

  /// Nothing else listens on 127.0.0.1:`p`. (A listener of Network.framework can share a port
  /// another program holds, so this asks the system with a plain socket first.) Connections that
  /// just ended (TIME_WAIT, after requests passed through) don't count: the port is still ours.
  public static func free(_ p: UInt16) -> Bool {
    let s = socket(AF_INET, SOCK_STREAM, 0)
    guard s >= 0 else { return false }
    defer { Darwin.close(s) }
    var yes: Int32 = 1
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
    var a = sockaddr_in()
    a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    a.sin_family = sa_family_t(AF_INET)
    a.sin_port = p.bigEndian
    a.sin_addr.s_addr = inet_addr("127.0.0.1")
    let r = withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    return r == 0
  }

  /// Something accepts connections on 127.0.0.1:`p` (a forwarder that really runs there).
  public static func accepting(_ p: UInt16) -> Bool {
    let s = socket(AF_INET, SOCK_STREAM, 0)
    guard s >= 0 else { return false }
    defer { Darwin.close(s) }
    var a = sockaddr_in()
    a.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    a.sin_family = sa_family_t(AF_INET)
    a.sin_port = p.bigEndian
    a.sin_addr.s_addr = inet_addr("127.0.0.1")
    let r = withUnsafePointer(to: &a) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
    return r == 0
  }

  private func listen(on p: UInt16) async -> NWListener? {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: p)!)
    guard let l = try? NWListener(using: params) else { return nil }
    l.newConnectionHandler = { [weak self] c in self?.handle(c) }
    let stopping = Flag()
    self.stopping = stopping
    return await withCheckedContinuation { (k: CheckedContinuation<NWListener?, Never>) in
      // The state handler runs on `queue` only; this is set once there.
      let once = Once()
      let started = Flag()
      l.stateUpdateHandler = { [weak self] s in
        switch s {
        case .ready:
          started.set()
          if once.first() { k.resume(returning: l) }
        case .failed(let e) where started.isSet:
          l.cancel()
          if !stopping.isSet { stopping.set(); self?.onStop?("监听出错: \(e.localizedDescription)") }
        case .cancelled where started.isSet:
          if !stopping.isSet { stopping.set(); self?.onStop?("监听被系统关闭") }
        case .failed, .cancelled, .waiting: if once.first() { l.cancel(); k.resume(returning: nil) }
        default: break
        }
      }
      l.start(queue: queue)
    }
  }

  // MARK: - One connection

  private func handle(_ c: NWConnection) {
    c.start(queue: queue)
    readHead(c, Data())
  }

  /// The largest request body passed on (Desktop sends JSON, with images at most a few MB).
  static let maxBody = 64 * 1024 * 1024

  /// Reads one whole request (its head, then its body by Content-Length or chunked framing),
  /// then forwards it. Only that one: the reply tells the client to close, so a client that
  /// keeps connections open sends its next request on a new one, which is rewritten too.
  private func readHead(_ c: NWConnection, _ got: Data) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self else { return }
      var buf = got
      if let data { buf.append(data) }
      if let r = buf.range(of: Data("\r\n\r\n".utf8)) {
        let head = String(decoding: buf[..<r.lowerBound], as: UTF8.self)
        guard Self.fromThisMachine(head) else { return self.reply(c, 403, "QuotaBar 本地转发只接受本机程序的请求") }
        guard let req = self.rewrite(head), let framing = Self.framing(head) else { return self.reply(c, 400, "bad request") }
        self.readBody(c, head: Data(req.utf8), framing: framing, got: Data(buf[r.upperBound...]), ended: complete || error != nil)
      } else if complete || error != nil {
        c.cancel()
      } else if buf.count > 64 * 1024 {
        self.reply(c, 431, "request head too large")
      } else {
        self.readHead(c, buf)
      }
    }
  }

  private func readBody(_ c: NWConnection, head: Data, framing: Framing, got: Data, ended: Bool) {
    switch Self.bodyEnd(framing, got) {
    case .some(-1):
      return reply(c, 400, "bad chunked body")
    case .some(let end):
      return forward(c, head + got.prefix(end))
    case nil where ended:
      return c.cancel()
    case nil where got.count > Self.maxBody:
      return reply(c, 413, "request too large")
    case nil:
      c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, complete, error in
        self?.readBody(c, head: head, framing: framing, got: got + (data ?? Data()), ended: complete || error != nil)
      }
    }
  }

  enum Framing: Equatable { case none, length(Int), chunked }

  /// How the request's body is delimited; nil when the head says something unusable.
  static func framing(_ head: String) -> Framing? {
    var length: Int?, chunked = false
    for l in head.components(separatedBy: "\r\n").dropFirst() {
      let kv = l.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
      guard kv.count == 2 else { continue }
      switch kv[0].lowercased() {
      case "transfer-encoding": chunked = kv[1].lowercased().contains("chunked")
      case "content-length":
        guard let n = Int(kv[1]), n >= 0 else { return nil }
        length = n
      default: break
      }
    }
    if chunked { return .chunked }
    return length.map { $0 > 0 ? .length($0) : .none } ?? Framing.none
  }

  /// Where the body ends in `d` (the bytes after the head): nil while incomplete, -1 when the
  /// chunked framing is broken.
  static func bodyEnd(_ f: Framing, _ d: Data) -> Int? {
    switch f {
    case .none: return 0
    case .length(let n): return d.count >= n ? n : nil
    case .chunked:
      let b = [UInt8](d)
      var i = 0
      func line() -> String? {
        var j = i
        while j + 1 < b.count { if b[j] == 13 && b[j + 1] == 10 { break }; j += 1 }
        guard j + 1 < b.count else { return nil }
        defer { i = j + 2 }
        return String(decoding: b[i..<j], as: UTF8.self)
      }
      while true {
        guard let sizeLine = line() else { return nil }
        let hex = sizeLine.split(separator: ";", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        guard let size = Int(hex, radix: 16), size >= 0 else { return -1 }
        if size == 0 {
          // Trailers, up to an empty line.
          while true {
            guard let t = line() else { return nil }
            if t.isEmpty { return i }
          }
        }
        guard i + size + 2 <= b.count else { return nil }
        guard b[i + size] == 13, b[i + size + 1] == 10 else { return -1 }
        i += size + 2
      }
    }
  }

  /// The request headers passed on, as the Python forwarder that works with these gateways does
  /// (some turn down Desktop's other headers, with an empty 400), and the body's framing.
  static let passed: Set<String> = ["authorization", "content-type", "accept", "content-length", "transfer-encoding"]

  /// The head as the API should get it: its path in front, the headers above, its Host, and
  /// Connection: close. The names of the headers left out go to the log (not their values).
  func rewrite(_ head: String) -> String? {
    let lines = head.components(separatedBy: "\r\n")
    guard !lines.isEmpty else { return nil }
    let parts = lines[0].split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count == 3, parts[1].hasPrefix("/") else { return nil }
    var out = ["\(parts[0]) \(prefix)\(parts[1]) \(parts[2])"]
    var left: [String] = []
    // The key goes only in place of one the client sent: a request with none (a web page's, say)
    // doesn't get it.
    let sent = lines.dropFirst().contains { l in
      let n = l.split(separator: ":", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
      return n == "authorization" || n == "x-api-key"
    }
    let key = sent ? self.key : nil
    for l in lines.dropFirst() where !l.isEmpty {
      let name = l.split(separator: ":", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
      if key != nil && name.lowercased() == "authorization" { continue }
      if Self.passed.contains(name.lowercased()) { out.append(l) } else { left.append(name) }
    }
    if let key { out.append("Authorization: Bearer " + key) }
    out.append("Host: " + (targetPort == (tls ? 443 : 80) ? host : "\(host):\(targetPort)"))
    out.append("User-Agent: QuotaBar")
    out.append("Connection: close")
    if !left.isEmpty { log?("left out: " + left.joined(separator: ", ")) }
    return out.joined(separator: "\r\n") + "\r\n\r\n"
  }

  /// The request was addressed to this machine (its Host header, if any, is 127.0.0.1, localhost
  /// or ::1). A web page that got its name to point here (DNS rebinding) sends its own name: it
  /// is turned away, so it can't use the forwarder, and the key it sends.
  static func fromThisMachine(_ head: String) -> Bool {
    for l in head.components(separatedBy: "\r\n").dropFirst() {
      let kv = l.split(separator: ":", maxSplits: 1)
      guard kv.count == 2, kv[0].trimmingCharacters(in: .whitespaces).lowercased() == "host" else { continue }
      var h = kv[1].trimmingCharacters(in: .whitespaces).lowercased()
      if h.hasPrefix("[") {
        h = String(h.prefix { $0 != "]" }) + "]"
      } else if let colon = h.firstIndex(of: ":") {
        h = String(h[..<colon])
      }
      return ["127.0.0.1", "localhost", "[::1]"].contains(h)
    }
    return true
  }

  /// The reply's head for the client: Connection: close, so it doesn't send another request on
  /// this connection (which would reach the API without the path and Host rewritten).
  static func rewriteReply(_ head: String) -> String {
    let lines = head.components(separatedBy: "\r\n")
    guard let status = lines.first else { return head + "\r\n\r\n" }
    let out = [status] + without(["connection", "proxy-connection", "keep-alive"], lines.dropFirst()) + ["Connection: close"]
    return out.joined(separator: "\r\n") + "\r\n\r\n"
  }

  private static func without(_ names: Set<String>, _ lines: ArraySlice<String>) -> [String] {
    lines.filter { l in
      let name = l.split(separator: ":", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
      return !l.isEmpty && !names.contains(name)
    }
  }

  private func forward(_ c: NWConnection, _ request: Data) {
    // Straight to the API, as curl and the Python forwarder go: Network.framework would otherwise
    // follow the system's proxy (Clash and the like set one), sending this plain-server request
    // to a proxy, which answers it with an empty 400.
    let params = tls ? NWParameters(tls: NWProtocolTLS.Options(), tcp: NWProtocolTCP.Options()) : NWParameters.tcp
    params.preferNoProxies = true
    let up = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: targetPort)!, using: params)
    // The state handler runs on `queue` only.
    let started = Once()
    up.stateUpdateHandler = { [weak self] s in
      guard let self else { return }
      switch s {
      case .ready:
        guard started.first() else { return }
        let line = String(decoding: request.prefix(while: { $0 != 13 }), as: UTF8.self)
        self.log?("\(line) → \(self.host):\(self.targetPort) (\(up.currentPath?.remoteEndpoint.map { "\($0)" } ?? "?"))")
        up.send(content: request, completion: .contentProcessed { e in
          if e != nil { return self.close(c, up) }
          self.replyHead(up, to: c, Data())
        })
      case .failed(let e), .waiting(let e):
        // Once connected, the API closing (or failing) is seen while the reply is passed on,
        // which sends all of it first; closing the client here would drop what is still to come.
        if started.first() {
          up.cancel()
          self.log?("can't reach \(self.host):\(self.targetPort): \(e)")
          self.reply(c, 502, "QuotaBar 本地转发连不上 \(self.host):\(self.targetPort) (\(e))")
        }
      default: break
      }
    }
    up.start(queue: queue)
    // Nothing within the time limit (no answer, a name that never resolves): say so.
    queue.asyncAfter(deadline: .now() + connectTimeout) { [weak self] in
      guard let self, started.first() else { return }
      up.cancel()
      self.log?("no connection to \(self.host):\(self.targetPort) within \(Int(self.connectTimeout)) s")
      self.reply(c, 502, "QuotaBar 本地转发在 \(Int(self.connectTimeout)) 秒内没连上 \(self.host):\(self.targetPort)")
    }
  }

  /// Reads the reply's head, passes it on rewritten, then the rest as it comes.
  private func replyHead(_ up: NWConnection, to c: NWConnection, _ got: Data) {
    up.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self else { return }
      var buf = got
      if let data { buf.append(data) }
      if let r = buf.range(of: Data("\r\n\r\n".utf8)) {
        let head = Self.rewriteReply(String(decoding: buf[..<r.lowerBound], as: UTF8.self))
        // ("\r\n" is one Character in Swift: split on the string, not on "\r".)
        let status = head.components(separatedBy: "\r\n").first ?? ""
        let code = Int(status.split(separator: " ").dropFirst().first ?? "") ?? 0
        self.log?(status + (code >= 400 ? " — " + String(decoding: buf[r.upperBound...].prefix(300), as: UTF8.self) : ""))
        self.send(Data(head.utf8) + buf[r.upperBound...], to: c) { ok in
          guard ok else { return self.close(up, c) }
          if complete || error != nil { return self.finish(up, c) }
          self.pipe(up, to: c)
        }
      } else if complete || error != nil || buf.count > 64 * 1024 {
        // No reply head: pass on what came, and end.
        self.send(buf, to: c) { _ in self.finish(up, c) }
      } else {
        self.replyHead(up, to: c, buf)
      }
    }
  }

  /// Passes the rest of the reply on as it comes, then ends the exchange.
  private func pipe(_ up: NWConnection, to c: NWConnection) {
    up.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self else { return }
      if let error { self.log?("reply ended: \(error)") }
      // The data first, the end on its own after it: an end sent along with the last data,
      // with the connection closed right after, can lose that data.
      self.send(data, to: c) { ok in
        guard ok else { return self.close(up, c) }
        if complete || error != nil { self.finish(up, c) } else { self.pipe(up, to: c) }
      }
    }
  }

  /// The reply is all passed on: end it, let the client close first, then close both.
  private func finish(_ up: NWConnection, _ c: NWConnection) {
    c.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
      self?.queue.asyncAfter(deadline: .now() + 2) { self?.close(up, c) }
    })
  }

  private func send(_ data: Data?, to: NWConnection, then: @escaping (Bool) -> Void) {
    guard let data, !data.isEmpty else { return then(true) }
    to.send(content: data, completion: .contentProcessed { [weak self] e in
      if let e, e != .posix(.ECANCELED) { self?.log?("passing on failed: \(e)") }
      then(e == nil)
    })
  }

  private func close(_ a: NWConnection, _ b: NWConnection) {
    a.cancel()
    b.cancel()
  }

  private func reply(_ c: NWConnection, _ status: Int, _ text: String) {
    let body = Data(text.utf8)
    let head = "HTTP/1.1 \(status) \(status == 502 ? "Bad Gateway" : "Bad Request")\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
    c.send(content: Data(head.utf8) + body, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
  }
}

/// Set once, read from any thread.
private final class Flag: @unchecked Sendable {
  private let lock = NSLock()
  private var v = false
  func set() { lock.lock(); v = true; lock.unlock() }
  var isSet: Bool { lock.lock(); defer { lock.unlock() }; return v }
}

/// True the first time only (used from one serial queue).
private final class Once: @unchecked Sendable {
  private var done = false
  func first() -> Bool {
    defer { done = true }
    return !done
  }
}

/// What to do with Claude Desktop's gateway address when switching.
public enum DesktopURL {
  public enum Change: Equatable, Sendable {
    /// Already the address wanted.
    case same
    /// One of ours (an earlier forwarder, or the model API itself): replace without asking.
    case replace
    /// Something else: ask first.
    case ask
  }

  /// `current` is Desktop's address now; `want` the one it should have (the forwarder's, or the
  /// model API's); `ours` the addresses this app set up (its forwarders and the model API).
  public static func change(current: String?, want: String, ours: [String]) -> Change {
    if ClaudeSettings.sameURL(current, want) { return .same }
    if ours.contains(where: { ClaudeSettings.sameURL(current, $0) }) { return .replace }
    return .ask
  }
}
