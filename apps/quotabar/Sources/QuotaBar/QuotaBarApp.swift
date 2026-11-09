// QuotaBar lives in the menu bar (no Dock icon). The dashboard is an ordinary window, opened from
// the panel; it also opens by itself while nothing is set up yet.
import AppKit
import QuotaCore
import SwiftUI

@main
struct QuotaBarApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate
  @State private var store: Store

  init() {
    // Opened by the update in place of an older one: that one is to be gone first (it holds the
    // forwarder's port, which this one is to keep).
    if let pid = AppSwap.previous(in: CommandLine.arguments) { Self.replace(pid) }
    _store = State(initialValue: Store.shared)
    AppFonts.load()
  }

  /// Waits for the app this one replaces to quit; if it is still there after that, ends it (it is
  /// the same app, an older build: two would be in the menu bar, and it holds the port).
  private static func replace(_ pid: pid_t) {
    AppSwap.wait(for: pid)
    guard kill(pid, 0) == 0 else { return }
    guard let old = NSRunningApplication(processIdentifier: pid), old.bundleIdentifier == Bundle.main.bundleIdentifier else {
      LogFile("update.log").write("旧版本 (\(pid)) 没退出, 但已不是 QuotaBar, 不处理")
      return
    }
    LogFile("update.log").write("旧版本 (\(pid)) 15 秒没退出, 结束它")
    old.terminate()
    AppSwap.wait(for: pid, limit: 3)
    if kill(pid, 0) == 0 { old.forceTerminate(); AppSwap.wait(for: pid, limit: 3) }
  }

  // The menu bar item is StatusBar's (it decides between the panel and the dashboard); SwiftUI
  // only needs a scene, and this one shows nothing.
  var body: some Scene {
    MenuBarExtra("QuotaBar", isInserted: .constant(false)) { EmptyView() }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  /// Opened again (Spotlight, Launchpad, Finder) while it runs: the dashboard, so the app is
  /// there even when macOS hid its menu bar item for want of room.
  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
    MainActor.assumeIsolated { Windows.show(.dashboard, Store.shared) }
    return false
  }

  func applicationDidFinishLaunching(_ n: Notification) {
    MainActor.assumeIsolated {
      editShortcuts()
      let store = Store.shared
      StatusBar.shared.start(store)
      Updater.shared.start(store)
      // CI: the update's last step, from a given build (replace this app, open it, quit).
      if let i = CommandLine.arguments.firstIndex(of: "--reinstall-from"), i + 1 < CommandLine.arguments.count {
        let built = URL(fileURLWithPath: CommandLine.arguments[i + 1])
        Task { try? await Task.sleep(for: .seconds(3)); await Updater.shared.reinstall(from: built) }
      }
      let args = CommandLine.arguments
      let empty = !store.hasURL || store.people.isEmpty
      if empty || args.contains("--settings") {
        Windows.show(.settings, store)
      } else if args.contains("--dashboard") {
        Windows.show(.dashboard, store)
      } else if args.contains("--requests") {
        Windows.show(.requests, store)
      }
      // The panel in a window of its own, to look at it without clicking the menu bar.
      if CommandLine.arguments.contains("--panel-window") {
        let w = NSWindow(contentViewController: NSHostingController(rootView: PanelView().environment(store)))
        w.title = "QuotaBar"
        w.isReleasedWhenClosed = false
        w.setFrameTopLeftPoint(NSPoint(x: 40, y: (NSScreen.main?.visibleFrame.maxY ?? 800) - 20))
        w.makeKeyAndOrderFront(nil)
        Windows.keep(w)
      }
    }
  }
}

/// A menu-bar-only app has no menu bar of its own, so ⌘X / ⌘C / ⌘V / ⌘A / ⌘Z don't reach its
/// text fields by themselves: they are sent on here to whatever has the focus.
@MainActor
private func editShortcuts() {
  NSEvent.addLocalMonitorForEvents(matching: .keyDown) { e in
    let mods = e.modifierFlags.intersection(.deviceIndependentFlagsMask)
    guard mods == .command || mods == [.command, .shift], let key = e.charactersIgnoringModifiers?.lowercased() else { return e }
    let action: Selector?
    switch (key, mods == .shift.union(.command)) {
    case ("x", false): action = #selector(NSText.cut(_:))
    case ("c", false): action = #selector(NSText.copy(_:))
    case ("v", false): action = #selector(NSText.paste(_:))
    case ("a", false): action = #selector(NSText.selectAll(_:))
    case ("z", false): action = Selector(("undo:"))
    case ("z", true): action = Selector(("redo:"))
    case ("w", false): action = #selector(NSWindow.performClose(_:))
    default: action = nil
    }
    guard let action, NSApp.sendAction(action, to: nil, from: nil) else { return e }
    return nil
  }
}

extension Store {
  static let shared = Store()
}

/// The app's one window: the dashboard, the settings, or the request list, one at a time (opening
/// another page shows it in the same window). Only from the dashboard do the settings open over it
/// (a sheet), so that closing them goes back there.
@MainActor
enum Windows {
  private static var window: NSWindow?
  /// Windows kept open besides it (the panel in a window, for CI).
  private static var others: [NSWindow] = []

  static func keep(_ w: NSWindow) { others.append(w) }

  static var isOpen: Bool { window?.isVisible == true }

  /// Brings the window to the front on `page` (opening it if needed).
  static func show(_ page: WindowPage, _ store: Store) {
    StatusBar.shared.closePanel()
    let model = DashboardModel.shared
    model.showSettings = false
    let w = window ?? make(store)
    if window == nil || model.page != page || !w.isVisible {
      if window != nil, w.isVisible { w.saveFrame(usingName: model.page.frameName) }
      model.page = page
      arrange(w, for: page)
    }
    window = w
    NSApp.activate(ignoringOtherApps: true)
    w.makeKeyAndOrderFront(nil)
  }

  /// The window in front again, on the page it shows.
  static func front() {
    NSApp.activate(ignoringOtherApps: true)
    window?.makeKeyAndOrderFront(nil)
  }

  /// Closed (the settings page's 完成).
  static func close() { window?.performClose(nil) }

  private static func make(_ store: Store) -> NSWindow {
    let host = NSHostingController(rootView: WindowRoot(model: DashboardModel.shared).environment(store))
    host.sceneBridgingOptions = [.toolbars, .title]
    let w = NSWindow(contentViewController: host)
    w.isReleasedWhenClosed = false
    w.toolbarStyle = .unified
    return w
  }

  /// The page's title, style and size: the size it last had, else its own.
  private static func arrange(_ w: NSWindow, for page: WindowPage) {
    w.title = page.title
    var style: NSWindow.StyleMask = [.titled, .closable, .miniaturizable]
    if page != .settings { style.insert(.resizable) }
    if page == .dashboard { style.insert(.fullSizeContentView) }
    w.styleMask = style
    if !w.setFrameUsingName(page.frameName) {
      w.setContentSize(page.size)
      w.center()
    }
  }
}

/// What the window shows.
enum WindowPage: Equatable {
  case dashboard, settings, requests

  var title: String {
    switch self {
    case .dashboard: return "额度看板"
    case .settings: return "设置"
    case .requests: return "请求记录"
    }
  }

  /// Where its frame is kept ("dashboard": as before there was one window for all three).
  var frameName: String {
    switch self {
    case .dashboard: return "dashboard"
    case .settings: return "settings"
    case .requests: return "requests"
    }
  }

  var size: NSSize {
    switch self {
    case .dashboard: return NSSize(width: 980, height: 760)
    case .settings: return NSSize(width: 600, height: 640)
    case .requests: return NSSize(width: 900, height: 480)
    }
  }
}

@MainActor @Observable
final class DashboardModel {
  static let shared = DashboardModel()
  var page = WindowPage.dashboard
  /// The settings over the dashboard (opened from it).
  var showSettings = false
}

private struct WindowRoot: View {
  @Bindable var model: DashboardModel

  var body: some View {
    switch model.page {
    case .dashboard: DashboardView(showSettings: $model.showSettings)
    case .settings: SettingsView(done: { Windows.close() })
    case .requests: RequestsView()
    }
  }
}
