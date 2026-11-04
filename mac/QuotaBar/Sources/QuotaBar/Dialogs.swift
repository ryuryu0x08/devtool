// The questions QuotaBar asks (switching a key, restarting Desktop), in a dialog of its own: the
// app's fonts and colours, the reason first, the buttons in one row (the main one on the right,
// Return; Esc cancels). Shown in the middle of the screen, waiting for the answer like an alert.
import AppKit
import SwiftUI

@MainActor
enum Dialogs {
  enum OtherAPI { case replace, keyOnly, cancel }

  /// Claude Code or Desktop points at another model API than `wanted`.
  static func otherAPI(current: [String], wanted: String) -> OtherAPI {
    let r = ask(Ask(
      title: "接口和设置里的不同",
      message: "切换 key 时要不要把接口也改成设置里的？",
      lines: current + ["设置里：" + wanted.replacingOccurrences(of: "\n", with: "，")],
      buttons: [.init("取消", .cancel), .init("只换 key"), .init("一并换接口", .main)]))
    switch r.button {
    case 2: return .replace
    case 1: return .keyOnly
    default: return .cancel
    }
  }

  /// Desktop's configuration changed (`why`): relaunch it now? And remember the answer?
  static func restartDesktop(why: String) -> (now: Bool, remember: Bool) {
    let r = ask(Ask(
      title: "重启 Claude Desktop？",
      message: why + "。",
      note: "Desktop 只在启动时读取配置，重启会中断正在进行的对话。",
      remember: "记住我的选择",
      buttons: [.init("稍后", .cancel), .init("重启", .main)]))
    return (r.button == 1, r.remember)
  }

  // MARK: - The dialog

  struct Ask {
    var title: String
    var message: String
    /// Addresses and the like, in the monospaced font.
    var lines: [String] = []
    var note: String?
    /// The label of a "remember" checkbox, if there is one.
    var remember: String?
    var buttons: [DialogButton]
  }

  struct DialogButton {
    enum Kind { case normal, main, cancel }
    let title: String
    let kind: Kind
    init(_ title: String, _ kind: Kind = .normal) { self.title = title; self.kind = kind }
  }

  /// Shows `a` and waits for a button (its index; Esc and closing give the cancel one's).
  private static func ask(_ a: Ask) -> (button: Int, remember: Bool) {
    StatusBar.shared.closePanel()
    let cancel = a.buttons.firstIndex { $0.kind == .cancel } ?? 0
    var remember = false
    let panel = DialogPanel()
    let view = DialogView(ask: a) { i, r in
      remember = r
      NSApp.stopModal(withCode: NSApplication.ModalResponse(rawValue: i))
    }
    let host = NSHostingView(rootView: view)
    panel.contentView = host
    panel.setContentSize(host.fittingSize)
    panel.onCancel = { NSApp.stopModal(withCode: NSApplication.ModalResponse(rawValue: cancel)) }
    panel.center()
    NSApp.activate(ignoringOtherApps: true)
    panel.makeKeyAndOrderFront(nil)
    let r = NSApp.runModal(for: panel).rawValue
    panel.orderOut(nil)
    return (a.buttons.indices.contains(r) ? r : cancel, remember)
  }
}

/// A window with no title bar of its own (the content draws everything), rounded like a
/// system one; Esc cancels.
private final class DialogPanel: NSPanel {
  var onCancel: (() -> Void)?

  init() {
    super.init(contentRect: NSRect(x: 0, y: 0, width: 360, height: 200), styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
    titleVisibility = .hidden
    titlebarAppearsTransparent = true
    isMovableByWindowBackground = true
    level = .modalPanel
    isReleasedWhenClosed = false
    for b in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] { standardWindowButton(b)?.isHidden = true }
  }

  override var canBecomeKey: Bool { true }
  override func cancelOperation(_ sender: Any?) { onCancel?() }
}

private struct DialogView: View {
  let ask: Dialogs.Ask
  let done: (Int, Bool) -> Void
  @State private var remember = false

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 10) {
        if let icon = NSImage(named: "AppIcon") ?? NSApp.applicationIconImage {
          Image(nsImage: icon).resizable().frame(width: 28, height: 28)
        }
        Text(ask.title).font(.ui(15, .semibold))
      }
      VStack(alignment: .leading, spacing: 8) {
        Text(ask.message).font(.ui(13))
        if !ask.lines.isEmpty {
          VStack(alignment: .leading, spacing: 3) {
            ForEach(ask.lines, id: \.self) { Text($0).font(.mono(11.5)).textSelection(.enabled) }
          }
          .padding(.horizontal, 10)
          .padding(.vertical, 8)
          .frame(maxWidth: .infinity, alignment: .leading)
          .background(Color.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 7))
        }
        if let note = ask.note { Text(note).font(.ui(11.5)).foregroundStyle(.secondary) }
      }
      .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 8) {
        if let label = ask.remember {
          Toggle(isOn: $remember) { Text(label).font(.ui(12)).foregroundStyle(.secondary) }
            .toggleStyle(.checkbox)
        }
        Spacer(minLength: 12)
        ForEach(ask.buttons.indices, id: \.self) { i in
          let b = ask.buttons[i]
          Button { done(i, remember) } label: { Text(b.title).font(.ui(13, b.kind == .main ? .medium : .regular)) }
            .buttonStyle(DialogButtonStyle(main: b.kind == .main))
            .keyboardShortcut(Self.shortcut(b.kind))
        }
      }
      .padding(.top, 4)
    }
    .padding(.horizontal, 20)
    .padding(.top, 20)
    .padding(.bottom, 16)
    .frame(width: 380, alignment: .leading)
  }

  /// Return for the main button, Esc for the cancel one.
  private static func shortcut(_ k: Dialogs.DialogButton.Kind) -> KeyboardShortcut? {
    switch k {
    case .main: return .defaultAction
    case .cancel: return .cancelAction
    case .normal: return nil
    }
  }
}

private struct DialogButtonStyle: ButtonStyle {
  let main: Bool

  func makeBody(configuration c: Configuration) -> some View {
    c.label
      .padding(.horizontal, 14)
      .frame(minWidth: 64, minHeight: 28)
      .foregroundStyle(main ? Color.white : Color.primary)
      .background(main ? Color.accentColor : Color.primary.opacity(0.08), in: RoundedRectangle(cornerRadius: 7))
      .opacity(c.isPressed ? 0.75 : 1)
      .contentShape(RoundedRectangle(cornerRadius: 7))
  }
}
