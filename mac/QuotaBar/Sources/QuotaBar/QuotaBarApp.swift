// QuotaBar lives in the menu bar (no Dock icon). The dashboard is an ordinary window, opened from
// the panel; it also opens by itself while nothing is set up yet.
import AppKit
import SwiftUI

@main
struct QuotaBarApp: App {
  @NSApplicationDelegateAdaptor private var delegate: AppDelegate
  @State private var store = Store.shared

  init() { AppFonts.load() }

  // The menu bar item is StatusBar's (it decides between the panel and the dashboard); SwiftUI
  // only needs a scene, and this one shows nothing.
  var body: some Scene {
    MenuBarExtra("QuotaBar", isInserted: .constant(false)) { EmptyView() }
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  func applicationDidFinishLaunching(_ n: Notification) {
    MainActor.assumeIsolated {
      editShortcuts()
      let store = Store.shared
      StatusBar.shared.start(store)
      Updater.shared.start(store)
      let args = CommandLine.arguments
      let empty = !store.hasURL || store.people.isEmpty
      if empty || args.contains("--dashboard") || args.contains("--settings") {
        Windows.showDashboard(store, settings: empty || args.contains("--settings"))
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

@MainActor
enum Windows {
  private static var dashboard: NSWindow?
  private static var others: [NSWindow] = []

  static func keep(_ w: NSWindow) { others.append(w) }

  static var dashboardOpen: Bool { dashboard?.isVisible == true }

  /// Brings the dashboard to the front (opening it if needed), with the settings sheet if asked.
  static func showDashboard(_ store: Store, settings: Bool = false) {
    StatusBar.shared.closePanel()
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
