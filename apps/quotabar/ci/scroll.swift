// Scrolls the window under the screen's centre to its end (for the CI screenshots).
import CoreGraphics
import Foundation

let at = CGPoint(x: 700, y: 560)
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: at, mouseButton: .left)?.post(tap: .cghidEventTap)
for _ in 0..<20 {
  let e = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -400, wheel2: 0, wheel3: 0)
  e?.location = at
  e?.post(tap: .cghidEventTap)
  usleep(30_000)
}
