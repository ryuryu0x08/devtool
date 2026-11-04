// The menu bar item: the name of the person whose key Claude Code uses and what they can still
// use today. A click opens the panel, or, while the dashboard window is open, brings that to the
// front instead: one of the two at a time.
import AppKit
import Observation
import QuotaCore
import SwiftUI

@MainActor
final class StatusBar: NSObject {
  static let shared = StatusBar()

  private var item: NSStatusItem?
  private let popover = NSPopover()

  func start(_ store: Store) {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    self.item = item
    item.button?.target = self
    item.button?.action = #selector(click)
    item.button?.imagePosition = .imageLeading
    popover.behavior = .transient
    popover.animates = true
    let host = NSHostingController(rootView: PanelView().environment(store))
    host.sizingOptions = .preferredContentSize
    popover.contentViewController = host
    update(store)
  }

  @objc private func click() {
    if Windows.dashboardOpen {
      Windows.showDashboard(Store.shared)
    } else if popover.isShown {
      popover.performClose(nil)
    } else if let b = item?.button {
      Store.shared.readSettings()
      if let p = Store.shared.active, Store.shared.failures[p.id] != nil { Task { await Store.shared.refresh() } }
      popover.show(relativeTo: b.bounds, of: b, preferredEdge: .minY)
      popover.contentViewController?.view.window?.makeKey()
    }
  }

  func closePanel() {
    if popover.isShown { popover.performClose(nil) }
  }

  /// While a dialog asks something, the panel stays open (it would close as soon as the dialog
  /// takes the focus, as if the app went away); afterwards it closes on a click outside again.
  func holdPanel(_ hold: Bool) {
    popover.behavior = hold ? .applicationDefined : .transient
  }

  /// The panel's window, while it is open (a dialog is placed by it).
  var panelWindow: NSWindow? { popover.isShown ? popover.contentViewController?.view.window : nil }

  /// Redraws the item whenever what it shows changes.
  private func update(_ store: Store) {
    let (symbol, text) = withObservationTracking {
      Self.content(store)
    } onChange: {
      Task { @MainActor in self.update(store) }
    }
    guard let b = item?.button else { return }
    let img = NSImage(systemSymbolName: symbol, accessibilityDescription: "QuotaBar")
    img?.isTemplate = true
    b.image = img
    b.attributedTitle = NSAttributedString(string: text.map { " " + $0 } ?? "", attributes: [
      .font: NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular),
    ])
  }

  static func content(_ store: Store) -> (String, String?) {
    guard let p = store.active else { return ("gauge.with.dots.needle.50percent", nil) }
    let g: GoodReading
    switch store.shown(p) {
    case .noKey:
      return ("exclamationmark.triangle", p.label)
    case .failing(_, let last):
      // A failed reading among good ones shows the last good one until it goes on (the panel
      // and the dashboard say what failed).
      guard let last, !store.troubleInBar(p) else { return ("exclamationmark.triangle", p.label) }
      g = last
    case .waiting:
      return ("gauge.with.dots.needle.50percent", p.label)
    case .ok(let r):
      g = r
    }
    do {
      let s = KeyState(g.usage)
      let symbol: String
      switch s.kind {
      case .withinDaily: symbol = "gauge.with.dots.needle.33percent"
      case .onOverflow: symbol = "gauge.with.dots.needle.67percent"
      case .out: symbol = "gauge.with.dots.needle.100percent"
      }
      return (symbol, p.label + " " + Fmt.num(s.left))
    }
  }
}
