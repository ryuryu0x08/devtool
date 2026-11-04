// The two questions switching a key can ask, as standard macOS alerts.
import AppKit

@MainActor
enum Dialogs {
  enum OtherAPI { case replace, keyOnly, cancel }

  /// Claude Code or Desktop points at another model API than `wanted`.
  static func otherAPI(current: [String], wanted: String) -> OtherAPI {
    let a = NSAlert()
    a.messageText = "接口不是设置里的地址"
    a.informativeText = current.joined(separator: "\n") + "\n\n设置里：\(wanted)"
    a.addButton(withTitle: "一并换接口")
    a.addButton(withTitle: "只换 key")
    a.addButton(withTitle: "取消")
    switch run(a) {
    case .alertFirstButtonReturn: return .replace
    case .alertSecondButtonReturn: return .keyOnly
    default: return .cancel
    }
  }

  /// Desktop got a new key: relaunch it now? And remember the answer?
  static func restartDesktop() -> (now: Bool, remember: Bool) {
    let a = NSAlert()
    a.messageText = "重启 Claude Desktop？"
    a.informativeText = "Desktop 的改动重启后生效。"
    a.addButton(withTitle: "重启")
    a.addButton(withTitle: "稍后")
    a.showsSuppressionButton = true
    a.suppressionButton?.title = "记住我的选择（可在设置里改）"
    let r = run(a)
    return (r == .alertFirstButtonReturn, a.suppressionButton?.state == .on)
  }

  private static func run(_ a: NSAlert) -> NSApplication.ModalResponse {
    StatusBar.shared.closePanel()
    NSApp.activate(ignoringOtherApps: true)
    if let icon = NSImage(named: "AppIcon") ?? NSApp.applicationIconImage { a.icon = icon }
    return a.runModal()
  }
}
