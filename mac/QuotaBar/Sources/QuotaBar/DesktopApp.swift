// Claude Desktop the running app: whether it runs, when it was opened, and relaunching it (it
// reads its configuration only at launch).
import AppKit
import QuotaCore

@MainActor
enum DesktopApp {
  static var apps: [NSRunningApplication] {
    NSRunningApplication.runningApplications(withBundleIdentifier: ClaudeDesktop.bundleID)
  }

  static var running: Bool { !apps.isEmpty }

  /// A running Desktop was opened before `t` (so hasn't read what changed since).
  static func openedBefore(_ t: Date) -> Bool {
    apps.contains { ($0.launchDate ?? .distantPast) < t }
  }

  enum Relaunch { case done, didNotQuit, notFound }

  /// Quits Desktop and opens it again.
  static func relaunch() async -> Relaunch {
    let apps = self.apps
    let url = apps.first?.bundleURL ?? NSWorkspace.shared.urlForApplication(withBundleIdentifier: ClaudeDesktop.bundleID)
    apps.forEach { $0.terminate() }
    for _ in 0..<60 where apps.contains(where: { !$0.isTerminated }) {
      try? await Task.sleep(for: .milliseconds(250))
    }
    guard apps.allSatisfy(\.isTerminated) else { return .didNotQuit }
    guard let url else { return .notFound }
    let c = NSWorkspace.OpenConfiguration()
    c.activates = false
    _ = try? await NSWorkspace.shared.openApplication(at: url, configuration: c)
    return .done
  }
}
