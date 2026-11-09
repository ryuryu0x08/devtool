// A forwarder on 127.0.0.1 to the model API (http or https): Claude Desktop accepts http only for
// this machine, so it is pointed here and the forwarder passes each request on. With `key` set,
// that key goes with every request instead of the one Desktop sent: the key changes here at once,
// with no restart of Desktop (which reads its own only at launch). One request per
// connection, read whole (head and body). Passed on as it came except for what has to change: the
// key (when one goes in place of the client's), the API's path in front of the path asked for, its
// Host, and this connection's own headers (Connection: close). Every other header and the body go
// byte for byte as sent, so nothing a gateway or its cache looks at changes. The reply likewise
// (Connection: close, so that a client keeping connections open doesn't send its next request down
// this one); its body is passed on as it comes, so streamed replies arrive as they are sent.
//
// With a second gateway set, requests go to the gateway whose model list has the model they ask
// for (ModelRoutes), with that gateway's key; GET /v1/models answers both lists as one.
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

  /// A gateway besides the model API (`target`): the requests for its models go to it.
  public struct Gateway: Equatable, Sendable {
    public let url: URL
    /// Sent as a Bearer token with each request to it.
    public let key: String
    let up: Upstream

    public init(url: URL, key: String) throws {
      self.url = url
      self.key = key
      up = try Upstream(url)
    }

    public static func == (a: Gateway, b: Gateway) -> Bool { a.url == b.url && a.key == b.key }
  }

  public let target: URL
  public private(set) var port: UInt16?
  /// How long to wait for the model API to accept a connection before answering 502.
  public var connectTimeout: TimeInterval = 15
  /// Told what happens to each request (for the app's log).
  public var log: (@Sendable (String) -> Void)?
  /// Told of each request taken (from this machine, well formed), on the forwarder's queue: the
  /// client goes through here now.
  public var onRequest: (@Sendable () -> Void)?
  /// Told (on the forwarder's queue) when the listener stops by itself after it started (the
  /// system ended it, e.g. around sleep): the port no longer answers. Not called for `stop()`.
  public var onStop: (@Sendable (String) -> Void)?
  /// Told (on a background queue) of both model lists, when a client asked for them and both
  /// were read, so that the app shows what it saw.
  public var onModels: (@Sendable (_ company: [String], _ second: [String]) -> Void)?
  /// Where each request is recorded (the app keeps one across forwarders); nil: nowhere.
  public var requestLog: RequestLog?
  private let company: Upstream
  private let lock = NSLock()
  private var _keyNames: [String: String] = [:]

  /// Names for keys (a person's, the other gateway's), for the request log; other keys show
  /// their last characters only.
  public var keyNames: [String: String] {
    get { lock.lock(); defer { lock.unlock() }; return _keyNames }
    set { lock.lock(); _keyNames = newValue; lock.unlock() }
  }
  private var _key: String?
  private var _second: Gateway?
  private var _routes = ModelRoutes()

  /// The second gateway (nil: everything goes to `target`).
  public var second: Gateway? {
    get { lock.lock(); defer { lock.unlock() }; return _second }
    set { lock.lock(); _second = newValue; lock.unlock() }
  }

  /// Which models go to the second gateway (and which both list).
  public var routes: ModelRoutes {
    get { lock.lock(); defer { lock.unlock() }; return _routes }
    set { lock.lock(); _routes = newValue; lock.unlock() }
  }

  /// The key sent with every request in place of the client's (nil: the client's as it is).
  public var key: String? {
    get { lock.lock(); defer { lock.unlock() }; return _key }
    set { lock.lock(); _key = newValue.flatMap { $0.isEmpty ? nil : $0 }; lock.unlock() }
  }
  private let queue = DispatchQueue(label: "QuotaBar.LocalForwarder")
  private var listener: NWListener?
  /// Set by `stop()` for the listener it ends, so that its ending isn't taken for a failure.
  private var stopping = Flag()

  public init(target: URL) throws {
    company = try Upstream(target)
    self.target = target
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
        guard Self.requestLine(head) != nil, let framing = Self.framing(head) else { return self.reply(c, 400, "bad request") }
        self.onRequest?()
        self.readBody(c, head: head, framing: framing, got: Data(buf[r.upperBound...]), ended: complete || error != nil)
      } else if complete || error != nil {
        c.cancel()
      } else if buf.count > 64 * 1024 {
        self.reply(c, 431, "request head too large")
      } else {
        self.readHead(c, buf)
      }
    }
  }

  private func readBody(_ c: NWConnection, head: String, framing: Framing, got: Data, ended: Bool) {
    switch Self.bodyEnd(framing, got) {
    case .some(-1):
      return reply(c, 400, "bad chunked body")
    case .some(let end):
      return dispatch(c, head: head, body: Data(got.prefix(end)))
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

  /// This connection's own headers (hop by hop, RFC 9110 7.6.1): not passed on. Also Expect: the
  /// body was read whole already, so the gateway is not to wait for a 100 Continue.
  static let hopByHop: Set<String> = ["keep-alive", "proxy-connection", "proxy-authorization", "te", "upgrade", "expect"]

  /// Method and path of the request line; nil if it isn't one.
  static func requestLine(_ head: String) -> (method: String, path: String)? {
    let parts = (head.components(separatedBy: "\r\n").first ?? "").split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count == 3, parts[1].hasPrefix("/") else { return nil }
    return (String(parts[0]), String(parts[1]))
  }

  /// The client sent a key (Authorization or x-api-key). Only then does a key of ours go in its
  /// place: a request with none (a web page's, say) doesn't get one.
  static func sentKey(_ head: String) -> Bool {
    head.components(separatedBy: "\r\n").dropFirst().contains { l in
      let n = l.split(separator: ":", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
      return n == "authorization" || n == "x-api-key"
    }
  }

  /// The head as the model API (`target`) should get it, with `key` in place of the client's.
  func rewrite(_ head: String) -> String? {
    rewrite(head, to: company, key: Self.sentKey(head) ? key : nil)
  }

  /// The head as `up` should get it. Changed, each where it was: the request line (the gateway's
  /// path in front), the key (`key`, if any, as the Authorization in place of the client's
  /// Authorization or x-api-key), Host, and Connection (close; the other hop-by-hop headers go).
  /// Every other header as sent, in its order.
  func rewrite(_ head: String, to up: Upstream, key: String?) -> String? {
    let lines = head.components(separatedBy: "\r\n")
    guard let line = Self.requestLine(head), let version = lines[0].split(separator: " ").last else { return nil }
    var out = ["\(line.method) \(up.prefix)\(line.path) \(version)"]
    var keyed = false, hosted = false, closed = false
    for l in lines.dropFirst() where !l.isEmpty {
      let name = (l.split(separator: ":", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? "").lowercased()
      if let key, name == "authorization" || name == "x-api-key" {
        if !keyed { out.append("Authorization: Bearer " + key) }
        keyed = true
      } else if name == "host" {
        if !hosted { out.append("Host: " + up.hostHeader) }
        hosted = true
      } else if name == "connection" {
        if !closed { out.append("Connection: close") }
        closed = true
      } else if !Self.hopByHop.contains(name) {
        out.append(l)
      }
    }
    if let key, !keyed { out.append("Authorization: Bearer " + key) }
    if !hosted { out.append("Host: " + up.hostHeader) }
    if !closed { out.append("Connection: close") }
    return out.joined(separator: "\r\n") + "\r\n\r\n"
  }

  /// The key a client sent: Authorization's Bearer token, or x-api-key.
  static func clientKey(_ head: String) -> String? {
    if let a = header("authorization", in: head) {
      let parts = a.split(separator: " ", maxSplits: 1)
      return parts.count == 2 && parts[0].lowercased() == "bearer" ? String(parts[1]).trimmingCharacters(in: .whitespaces) : a
    }
    return header("x-api-key", in: head)
  }

  /// A key as the request log shows it: its name, or its last characters.
  private func label(_ key: String?) -> String? {
    guard let key, !key.isEmpty else { return nil }
    return keyNames[key] ?? RequestLog.mask(key)
  }

  /// Where a whole request goes: with a second gateway, by the model it asks for (a model both
  /// gateways list is turned away, GET /v1/models answers both lists); else to the model API.
  /// Each is recorded in the request log, with the gateway and the key it went with.
  private func dispatch(_ c: NWConnection, head: String, body: Data) {
    let sent = Self.sentKey(head)
    guard let line = Self.requestLine(head) else { return reply(c, 400, "bad request") }
    let (method, path) = line
    let model = ModelRoutes.model(inPath: path) ?? ModelRoutes.model(in: body)
    let companyKey = sent ? (key ?? Self.clientKey(head)) : nil
    if let second {
      if method == "GET" && ModelRoutes.isList(path) {
        let id = requestLog?.add(method: method, path: path, model: nil, gateway: .both, key: label(companyKey))
        return listModels(c, head: head, path: path, second: second, record: id)
      }
      switch routes.route(model) {
      case .conflict(let m):
        log?("\(method) \(path): 模型 \(m) 两个网关都有, 未转发")
        if let id = requestLog?.add(method: method, path: path, model: m, gateway: .refused, key: nil) { requestLog?.finish(id, status: 409, note: "两个网关都有这个模型") }
        return reply(c, 409, ModelRoutes.conflictReply(m), json: true)
      case .second:
        guard let req = rewrite(head, to: second.up, key: sent ? second.key : nil) else { return reply(c, 400, "bad request") }
        let id = requestLog?.add(method: method, path: path, model: model, gateway: .other, key: sent ? label(second.key) : nil)
        return forward(c, Data(req.utf8) + body, to: second.up, record: id)
      case .company:
        break
      }
    }
    guard let req = rewrite(head) else { return reply(c, 400, "bad request") }
    let id = requestLog?.add(method: method, path: path, model: model, gateway: .company, key: label(companyKey))
    forward(c, Data(req.utf8) + body, to: company, record: id)
  }

  /// GET /v1/models with a second gateway: both lists as one (ModelRoutes.merge), each read with
  /// that gateway's key; the routes follow what was read. The model API's answer, if not a list
  /// (a key turned down, say), is passed back as it is; the second's failing leaves its models out.
  private func listModels(_ c: NWConnection, head: String, path: String, second: Gateway, record: Int?) {
    let sent = Self.sentKey(head)
    let companyAuth = sent ? (key.map { "Bearer " + $0 } ?? Self.header("authorization", in: head)) : nil
    let secondAuth = sent ? "Bearer " + second.key : nil
    let version = Self.header("anthropic-version", in: head)
    let companyURL = company.url(path)
    Task { [weak self] in
      async let a = ModelLists.get(companyURL, auth: companyAuth, version: version)
      async let b = ModelLists.get(second.up.url(path), auth: secondAuth, version: version)
      let (got, theirs) = await (a, b)
      guard let self else { return }
      // A model API with no model list (404) lists nothing: the second's models are the list.
      let mine = got.map { $0.status == 404 ? ModelLists.Reply(status: 200, body: Data(#"{"data":[]}"#.utf8)) : $0 }
      let theirIDs = theirs.flatMap { (200..<300).contains($0.status) ? ModelRoutes.ids(in: $0.body) : nil }
      self.queue.async {
        guard let mine, (200..<300).contains(mine.status), let merged = ModelRoutes.merge(company: mine.body, second: theirIDs == nil ? nil : theirs?.body) else {
          self.log?("GET \(path): 公司网关 " + (mine.map { "\($0.status)" } ?? "连不上"))
          if let record { self.requestLog?.finish(record, status: mine?.status ?? 502, note: mine == nil ? "连不上公司网关" : nil) }
          if let mine { return self.reply(c, mine.status, mine.body, json: true) }
          return self.reply(c, 502, "QuotaBar 本地转发连不上 \(self.company.label)")
        }
        let myIDs = ModelRoutes.ids(in: mine.body) ?? []
        if let theirIDs {
          self.routes = ModelRoutes(company: myIDs, second: theirIDs)
          self.onModels?(myIDs, theirIDs)
        } else {
          self.log?("GET \(path): 其他网关 " + (theirs.map { "\($0.status)" } ?? "连不上") + ", 只列公司网关的模型")
        }
        let r = self.routes
        self.log?("GET \(path): \(ModelRoutes.ids(in: merged)?.count ?? 0) 个模型" + (r.conflicts.isEmpty ? "" : ", 两边都有: " + r.conflicts.sorted().joined(separator: ", ")))
        if let record { self.requestLog?.finish(record, status: 200, note: theirIDs == nil ? "其他网关的列表没读到" : nil) }
        self.reply(c, 200, merged, json: true)
      }
    }
  }

  /// A header's value in the request head, if it is there.
  static func header(_ name: String, in head: String) -> String? {
    for l in head.components(separatedBy: "\r\n").dropFirst() {
      let kv = l.split(separator: ":", maxSplits: 1)
      if kv.count == 2, kv[0].trimmingCharacters(in: .whitespaces).lowercased() == name { return kv[1].trimmingCharacters(in: .whitespaces) }
    }
    return nil
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

  private func forward(_ c: NWConnection, _ request: Data, to target: Upstream, record: Int?) {
    // Straight to the API, as curl and the Python forwarder go: Network.framework would otherwise
    // follow the system's proxy (Clash and the like set one), sending this plain-server request
    // to a proxy, which answers it with an empty 400.
    let params = target.tls ? NWParameters(tls: NWProtocolTLS.Options(), tcp: NWProtocolTCP.Options()) : NWParameters.tcp
    params.preferNoProxies = true
    let up = NWConnection(host: NWEndpoint.Host(target.host), port: NWEndpoint.Port(rawValue: target.port)!, using: params)
    // The state handler runs on `queue` only.
    let started = Once()
    up.stateUpdateHandler = { [weak self] s in
      guard let self else { return }
      switch s {
      case .ready:
        guard started.first() else { return }
        let line = String(decoding: request.prefix(while: { $0 != 13 }), as: UTF8.self)
        self.log?("\(line) → \(target.label) (\(up.currentPath?.remoteEndpoint.map { "\($0)" } ?? "?"))")
        up.send(content: request, completion: .contentProcessed { e in
          if e != nil { return self.close(c, up) }
          self.replyHead(up, to: c, Data(), record: record)
        })
      case .failed(let e), .waiting(let e):
        // Once connected, the API closing (or failing) is seen while the reply is passed on,
        // which sends all of it first; closing the client here would drop what is still to come.
        if started.first() {
          up.cancel()
          self.log?("can't reach \(target.label): \(e)")
          if let record { self.requestLog?.finish(record, status: 502, note: "连不上 \(target.label)") }
          self.reply(c, 502, "QuotaBar 本地转发连不上 \(target.label) (\(e))")
        }
      default: break
      }
    }
    up.start(queue: queue)
    // Nothing within the time limit (no answer, a name that never resolves): say so.
    queue.asyncAfter(deadline: .now() + connectTimeout) { [weak self] in
      guard let self, started.first() else { return }
      up.cancel()
      self.log?("no connection to \(target.label) within \(Int(self.connectTimeout)) s")
      if let record { self.requestLog?.finish(record, status: 502, note: "\(Int(self.connectTimeout)) 秒内没连上 \(target.label)") }
      self.reply(c, 502, "QuotaBar 本地转发在 \(Int(self.connectTimeout)) 秒内没连上 \(target.label)")
    }
  }

  /// Reads the reply's head, passes it on rewritten, then the rest as it comes.
  private func replyHead(_ up: NWConnection, to c: NWConnection, _ got: Data, record: Int?) {
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
        if let record { self.requestLog?.finish(record, status: code) }
        self.send(Data(head.utf8) + buf[r.upperBound...], to: c) { ok in
          guard ok else { return self.close(up, c) }
          if complete || error != nil { return self.finish(up, c) }
          self.pipe(up, to: c)
        }
      } else if complete || error != nil || buf.count > 64 * 1024 {
        // No reply head: pass on what came, and end.
        if let record { self.requestLog?.finish(record, status: 0, note: "没有收到回复") }
        self.send(buf, to: c) { _ in self.finish(up, c) }
      } else {
        self.replyHead(up, to: c, buf, record: record)
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
    reply(c, status, Data(text.utf8), json: false)
  }

  private func reply(_ c: NWConnection, _ status: Int, _ body: Data, json: Bool) {
    let reason = [200: "OK", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 409: "Conflict", 413: "Content Too Large", 431: "Request Header Fields Too Large", 502: "Bad Gateway"][status] ?? (status < 400 ? "OK" : "Error")
    let type = json ? "application/json" : "text/plain; charset=utf-8"
    let head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
    c.send(content: Data(head.utf8) + body, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in c.cancel() })
  }
}

/// Where requests go: host, port, TLS, and the path put in front of the client's.
struct Upstream: Equatable, Sendable {
  let host: String
  let port: UInt16
  let tls: Bool
  let prefix: String

  init(_ url: URL) throws {
    let scheme = url.scheme?.lowercased()
    guard scheme == "http" || scheme == "https", let h = url.host, !h.isEmpty else { throw LocalForwarder.Failure.notHTTP }
    host = h
    tls = scheme == "https"
    port = UInt16(url.port ?? (tls ? 443 : 80))
    var p = url.path
    while p.hasSuffix("/") { p.removeLast() }
    prefix = p
  }

  /// The Host header: the name, with the port unless it is the scheme's own.
  var hostHeader: String { port == (tls ? 443 : 80) ? host : "\(host):\(port)" }
  /// "host:port", for the log and messages.
  var label: String { "\(host):\(port)" }

  /// The address of the client's `path` (with its query) here.
  func url(_ path: String) -> URL {
    URL(string: (tls ? "https://" : "http://") + hostHeader + prefix + path) ?? URL(fileURLWithPath: "/")
  }
}

/// Reading a /v1/models list: straight to the gateway (not through the system's proxy, as the
/// forwarder goes), within 15 s.
public enum ModelLists {
  public struct Reply: Sendable { public let status: Int; public let body: Data }

  public static func get(_ url: URL, auth: String?, version: String? = nil) async -> Reply? {
    var req = URLRequest(url: url, timeoutInterval: 15)
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    req.setValue("QuotaBar", forHTTPHeaderField: "User-Agent")
    if let auth { req.setValue(auth, forHTTPHeaderField: "Authorization") }
    if let version { req.setValue(version, forHTTPHeaderField: "anthropic-version") }
    let conf = URLSessionConfiguration.ephemeral
    conf.connectionProxyDictionary = [:]
    let session = URLSession(configuration: conf)
    defer { session.finishTasksAndInvalidate() }
    guard let (data, resp) = try? await session.data(for: req), let http = resp as? HTTPURLResponse else { return nil }
    return Reply(status: http.statusCode, body: data)
  }

  /// The ids `url` lists with `key` (as a Bearer token); nil when it can't be read.
  public static func ids(_ url: URL, key: String?) async -> [String]? {
    guard let r = await get(url, auth: key.map { "Bearer " + $0 }), (200..<300).contains(r.status) else { return nil }
    return ModelRoutes.ids(in: r.body)
  }

  /// The /v1/models address of a gateway whose API is at `base` ("http://h/api" → "http://h/api/v1/models").
  public static func listURL(_ base: URL) -> URL? {
    guard let up = try? Upstream(base) else { return nil }
    return up.url("/v1/models")
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
