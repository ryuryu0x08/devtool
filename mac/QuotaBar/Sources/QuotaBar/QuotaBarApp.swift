// QuotaBar lives in the menu bar (no Dock icon). The dashboard is an ordinary window, opened from
// the panel; it also opens by itself while nothing is set up yet.
import AppKit
import SwiftUI

@main
struct QuotaBarApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate
  @State private var store = Store.shared

  var body: some Scene {
    MenuBarExtra {
      PanelView().environment(store)
    } label: {
      MenuLabel().environment(store)
    }
    .menuBarExtraStyle(.window)
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ n: Notification) {
    MainActor.assumeIsolated {
      NSApp.mainMenu = editMenu()
      let store = Store.shared
      let args = CommandLine.arguments
      if !store.configured || args.contains("--dashboard") || args.contains("--settings") {
        Windows.showDashboard(store, settings: !store.configured || args.contains("--settings"))
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

/// A menu-bar-only app has no menu bar of its own, and so no ⌘C / ⌘V / ⌘A / ⌘Z in its text
/// fields unless a menu carries them: this one isn't shown, it only provides those shortcuts.
@MainActor
private func editMenu() -> NSMenu {
  let edit = NSMenu(title: "Edit")
  edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
  edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
  edit.addItem(.separator())
  edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
  edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
  edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
  edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
  let window = NSMenu(title: "Window")
  window.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
  let main = NSMenu()
  for m in [NSMenu(title: "QuotaBar"), edit, window] {
    let item = NSMenuItem()
    item.submenu = m
    main.addItem(item)
  }
  return main
}

extension Store {
  static let shared = Store()
}

@MainActor
enum Windows {
  private static var dashboard: NSWindow?
  private static var others: [NSWindow] = []

  static func keep(_ w: NSWindow) { others.append(w) }

  /// Brings the dashboard to the front (opening it if needed), with the settings sheet if asked.
  static func showDashboard(_ store: Store, settings: Bool = false) {
    let model = DashboardModel.shared
    if dashboard == nil {
      let host = NSHostingController(rootView: DashboardRoot(model: model).environment(store))
      host.sceneBridgingOptions = [.toolbars, .title]
      let w = NSWindow(contentViewController: host)
      w.title = "额度看板"
      w.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
      w.toolbarStyle = .unified
      w.setContentSize(NSSize(width: 980, height: 760))
      w.isReleasedWhenClosed = false
      w.setFrameAutosaveName("dashboard")
      if w.frame.origin == .zero { w.center() }
      dashboard = w
    }
    model.showSettings = settings || model.showSettings
    NSApp.activate(ignoringOtherApps: true)
    dashboard?.makeKeyAndOrderFront(nil)
  }
}

@MainActor @Observable
final class DashboardModel {
  static let shared = DashboardModel()
  var showSettings = false
}

private struct DashboardRoot: View {
  @Bindable var model: DashboardModel

  var body: some View {
    DashboardView(showSettings: $model.showSettings)
  }
}
