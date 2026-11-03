// A forwarder on 127.0.0.1 to a plain-http model API: Claude Desktop accepts http only for this
// machine, so it is pointed here and the forwarder passes each request on. One request per
// connection (Connection: close): the request's head is rewritten (the API's path in front of the
// path asked for, the API's Host), then both directions are passed through as they come, so
// streamed replies arrive as they are sent.
import Foundation
import Network

public final class LocalForwarder: @unchecked Sendable {
  public enum Failure: Error, Equatable, LocalizedError {
    case notHTTP
    case noPort(UInt16)

    public var errorDescription: String? {
      switch self {
      case .notHTTP: return "转发只用于 http:// 地址"
      case .noPort(let p): return "端口 \(p) 起都被占用"
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
  private let host: String
  private let targetPort: UInt16
  private let prefix: String
  private let queue = DispatchQueue(label: "QuotaBar.LocalForwarder")
  private var listener: NWListener?

  public init(target: URL) throws {
    guard target.scheme?.lowercased() == "http", let h = target.host, !h.isEmpty else { throw Failure.notHTTP }
    self.target = target
    host = h
    targetPort = UInt16(target.port ?? 80)
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
    listener?.cancel()
    listener = nil
    port = nil
  }

  /// Nothing else listens on 127.0.0.1:`p`. (A listener of Network.framework can share a port
  /// another program holds, so this asks the system with a plain socket first.) Connections that
  /// just ended (TIME_WAIT, after requests passed through) don't count: the port is still ours.
  static func free(_ p: UInt16) -> Bool {
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

  private func listen(on p: UInt16) async -> NWListener? {
    let params = NWParameters.tcp
    params.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: p)!)
    guard let l = try? NWListener(using: params) else { return nil }
    l.newConnectionHandler = { [weak self] c in self?.handle(c) }
    return await withCheckedContinuation { (k: CheckedContinuation<NWListener?, Never>) in
      // The state handler runs on `queue` only; this is set once there.
      let once = Once()
      l.stateUpdateHandler = { s in
        switch s {
        case .ready: if once.first() { k.resume(returning: l) }
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

  /// Reads up to the end of the request's head ("\r\n\r\n"), then forwards.
  private func readHead(_ c: NWConnection, _ got: Data) {
    c.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self else { return }
      var buf = got
      if let data { buf.append(data) }
      if let r = buf.range(of: Data("\r\n\r\n".utf8)) {
        let head = String(decoding: buf[..<r.lowerBound], as: UTF8.self)
        let rest = buf[r.upperBound...]
        guard let req = self.rewrite(head) else { return self.reply(c, 400, "bad request") }
        self.forward(c, Data(req.utf8) + rest)
      } else if complete || error != nil {
        c.cancel()
      } else if buf.count > 64 * 1024 {
        self.reply(c, 431, "request head too large")
      } else {
        self.readHead(c, buf)
      }
    }
  }

  /// The head as the API should get it: its path in front, its Host, and Connection: close.
  func rewrite(_ head: String) -> String? {
    var lines = head.components(separatedBy: "\r\n")
    guard !lines.isEmpty else { return nil }
    let parts = lines[0].split(separator: " ", omittingEmptySubsequences: true)
    guard parts.count == 3, parts[1].hasPrefix("/") else { return nil }
    lines[0] = "\(parts[0]) \(prefix)\(parts[1]) \(parts[2])"
    let drop: Set<String> = ["host", "connection", "proxy-connection", "keep-alive"]
    var out = [lines[0]]
    for l in lines.dropFirst() {
      let name = l.split(separator: ":", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
      if !drop.contains(name) && !l.isEmpty { out.append(l) }
    }
    out.append("Host: " + (targetPort == 80 ? host : "\(host):\(targetPort)"))
    out.append("Connection: close")
    return out.joined(separator: "\r\n") + "\r\n\r\n"
  }

  private func forward(_ c: NWConnection, _ first: Data) {
    let up = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: targetPort)!, using: .tcp)
    // The state handler runs on `queue` only.
    let started = Once()
    up.stateUpdateHandler = { [weak self] s in
      guard let self else { return }
      switch s {
      case .ready:
        guard started.first() else { return }
        let line = String(decoding: first.prefix(while: { $0 != 13 }), as: UTF8.self)
        self.log?("\(line) → \(self.host):\(self.targetPort) (\(up.currentPath?.remoteEndpoint.map { "\($0)" } ?? "?"))")
        up.send(content: first, completion: .contentProcessed { e in
          if e != nil { return self.close(c, up) }
          self.pipe(c, to: up, last: false)
          self.pipe(up, to: c, last: true)
        })
      case .failed(let e), .waiting(let e):
        if started.first() {
          up.cancel()
          self.log?("can't reach \(self.host):\(self.targetPort): \(e)")
          self.reply(c, 502, "QuotaBar 本地转发连不上 \(self.host):\(self.targetPort)（\(e)）")
        } else if case .failed = s {
          self.close(c, up)
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

  /// Passes what `from` sends on to `to`. `last`: when `from` is done, so is the exchange.
  private func pipe(_ from: NWConnection, to: NWConnection, last: Bool) {
    from.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
      guard let self else { return }
      let finish = complete || error != nil
      let content = (data?.isEmpty ?? true) ? nil : data
      if last || error != nil {
        self.log?("\(last ? "reply" : "request") \(content?.count ?? 0) bytes" + (complete ? ", end" : "") + (error.map { ", \($0)" } ?? ""))
      }
      if content == nil && !finish { return self.pipe(from, to: to, last: last) }
      to.send(content: content, contentContext: finish ? .finalMessage : .defaultMessage, isComplete: finish, completion: .contentProcessed { e in
        if let e { self.log?("passing on failed: \(e)") }
        if e != nil { return self.close(from, to) }
        if !finish { self.pipe(from, to: to, last: last) } else if last { self.close(from, to) }
      })
    }
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
