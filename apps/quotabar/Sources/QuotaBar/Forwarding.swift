// The local forwarder's running side: starting it on its port (taking the port back from an older
// QuotaBar left running), checking it still answers, and telling when it stopped by itself.
// What to do about it (the settings, Desktop's address) is the Store's.
import AppKit
import Foundation
import QuotaCore

@MainActor
final class Forwarding {
  private var forwarder: LocalForwarder?
  /// Counts starts and stops: a start that another start or a stop came after while it was
  /// under way gives up (it would leave a forwarder nobody holds, on a port).
  private var attempt = 0
  /// Told when the running forwarder stopped by itself (the system ended its listener).
  var onStop: ((String) -> Void)?
  /// Told of each request through the running forwarder.
  var onRequest: (() -> Void)?

  /// The running forwarder's port.
  var port: UInt16? { forwarder?.port }

  /// The key the forwarder sends in place of the client's (nil: the client's).
  var key: String? {
    get { forwarder?.key }
    set { forwarder?.key = newValue }
  }

  /// The other gateway (nil: none), and which models go to it. Kept here too, so that a
  /// forwarder started later gets them.
  var second: LocalForwarder.Gateway? {
    didSet { forwarder?.second = second }
  }
  var routes = ModelRoutes() {
    didSet { forwarder?.routes = routes }
  }
  /// The model sent to the other gateway when the company's answers 403 (nil: no fallback).
  var fallback: String? {
    didSet { forwarder?.fallback = fallback }
  }
  /// How long requests skip the company's gateway after a 403 (seconds).
  var fallbackFor: TimeInterval = 300 {
    didSet { forwarder?.fallbackFor = fallbackFor }
  }
  /// Told when a 403 started the fallback, and until when.
  var onFallback: ((Date) -> Void)?

  /// The requests of the last 10 minutes, kept across restarts of the forwarder.
  let requests = RequestLog()
  /// Names for keys in the request log (people's, the other gateway's).
  var keyNames: [String: String] = [:] {
    didSet { forwarder?.keyNames = keyNames }
  }

  /// Told of both model lists the forwarder read when a client asked for them.
  var onModels: ((_ company: [String], _ other: [String]) -> Void)?

  func stop() {
    attempt += 1
    forwarder?.stop()
    forwarder = nil
  }

  /// Starts a forwarder to `target` on `preferred`, or the next free port; returns the port, once
  /// it really answers there. Throws CancellationError if another start or a stop came meanwhile.
  func start(target: URL, preferred: UInt16, key: String?) async throws -> UInt16 {
    stop()
    let mine = attempt
    let f = try LocalForwarder(target: target)
    f.log = { ForwardLog.write($0) }
    f.key = key
    f.second = second
    f.routes = routes
    f.requestLog = requests
    f.keyNames = keyNames
    f.fallback = fallback
    f.fallbackFor = fallbackFor
    f.onFallback = { [weak self, weak f] until in
      Task { @MainActor in
        guard let self, let f, self.forwarder === f else { return }
        self.onFallback?(until)
      }
    }
    f.onModels = { [weak self, weak f] mine, theirs in
      Task { @MainActor in
        guard let self, let f, self.forwarder === f else { return }
        self.onModels?(mine, theirs)
      }
    }
    f.onRequest = { [weak self, weak f] in
      Task { @MainActor in
        guard let self, let f, self.forwarder === f else { return }
        self.onRequest?()
      }
    }
    f.onStop = { [weak self, weak f] why in
      Task { @MainActor in
        guard let self, let f, self.forwarder === f else { return }
        self.onStop?(why)
      }
    }
    await Self.reclaim(preferred)
    guard mine == attempt else { throw CancellationError() }
    let p = try await f.start(preferred: preferred)
    guard mine == attempt else {
      f.stop()
      throw CancellationError()
    }
    guard await Self.answers(p) else {
      f.stop()
      throw LocalForwarder.Failure.notAnswering(p)
    }
    guard mine == attempt else {
      f.stop()
      throw CancellationError()
    }
    forwarder = f
    return p
  }

  /// Something accepts connections on 127.0.0.1:`p`.
  static func answers(_ p: UInt16) async -> Bool {
    await Task.detached { LocalForwarder.accepting(p) }.value
  }

  /// Port `p` is held by another QuotaBar (an older one an update left running): that one is
  /// ended, so that the port, the one Desktop uses, stays the same. Any other program holding it
  /// is left alone (the forwarder then takes the next port).
  private static func reclaim(_ p: UInt16) async {
    guard !LocalForwarder.free(p) else { return }
    let out = (try? await Task.detached { try SourceUpdate.run(["lsof", "-nP", "-t", "-iTCP:\(p)", "-sTCP:LISTEN"], in: URL(fileURLWithPath: "/"), timeout: 5) }.value) ?? ""
    let mine = ProcessInfo.processInfo.processIdentifier
    let others = out.split(separator: "\n").compactMap { pid_t($0.trimmingCharacters(in: .whitespaces)) }
      .filter { $0 != mine }
      .compactMap { NSRunningApplication(processIdentifier: $0) }
      .filter { $0.bundleIdentifier == Bundle.main.bundleIdentifier }
    guard !others.isEmpty else { return }
    ForwardLog.write("端口 \(p) 被另一个 QuotaBar (\(others.map { String($0.processIdentifier) }.joined(separator: ", "))) 占着, 结束它")
    others.forEach { $0.terminate() }
    for _ in 0..<30 where others.contains(where: { !$0.isTerminated }) { try? await Task.sleep(for: .milliseconds(100)) }
    others.filter { !$0.isTerminated }.forEach { $0.forceTerminate() }
    for _ in 0..<20 where !LocalForwarder.free(p) { try? await Task.sleep(for: .milliseconds(100)) }
  }
}
