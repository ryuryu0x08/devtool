// The app's typefaces: Anthropic Sans for text, Anthropic Serif for names and large numbers,
// Anthropicons for icons. They are not in the repository (they aren't ours to publish): build.sh
// copies whatever is in ./Fonts into the app. Without them the system font and SF Symbols are
// used. Neither has Chinese: those characters come from the system font either way.
import AppKit
import CoreText
import SwiftUI

enum Weight: Double {
  case light = 300, regular = 400, medium = 500, semibold = 600, bold = 700

  var system: Font.Weight {
    switch self {
    case .light: return .light
    case .regular: return .regular
    case .medium: return .medium
    case .semibold: return .semibold
    case .bold: return .bold
    }
  }
}

@MainActor
enum AppFonts {
  private static var sans: CTFontDescriptor?
  private static var serif: CTFontDescriptor?
  private static var icons: CTFontDescriptor?
  private static var cache: [String: Font] = [:]

  /// Reads the fonts in the app's Resources/Fonts.
  static func load() {
    guard let dir = Bundle.main.resourceURL?.appendingPathComponent("Fonts"),
          let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else { return }
    for url in files where ["ttf", "otf", "woff2", "woff"].contains(url.pathExtension.lowercased()) {
      CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
      guard let ds = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as? [CTFontDescriptor] else { continue }
      for d in ds {
        let family = (CTFontDescriptorCopyAttribute(d, kCTFontFamilyNameAttribute) as? String ?? "").lowercased()
        if family.contains("anthropicons") {
          // Two icon fonts came; the plain one ("fizzy lake") is used, the other only if alone.
          if icons == nil || family.contains("fizzy") { icons = d }
        } else if family.contains("serif") {
          serif = d
        } else if family.contains("sans") {
          sans = d
        }
      }
    }
  }

  static var hasIcons: Bool { icons != nil }

  static func font(_ d: CTFontDescriptor?, _ name: String, _ size: CGFloat, _ w: Weight) -> Font {
    guard let d else { return .system(size: size, weight: w.system) }
    let key = "\(name)-\(size)-\(w.rawValue)"
    if let f = cache[key] { return f }
    // The variable fonts: weight, and optical size (the "Text" cut at small sizes, "Display" large).
    let axes: [NSNumber: NSNumber] = [tag("wght"): NSNumber(value: w.rawValue), tag("opsz"): NSNumber(value: min(48, max(16, Double(size))))]
    let v = CTFontDescriptorCreateCopyWithAttributes(d, [kCTFontVariationAttribute: axes] as CFDictionary)
    let f = Font(CTFontCreateWithFontDescriptor(v, size, nil))
    cache[key] = f
    return f
  }

  static func sansFont(_ size: CGFloat, _ w: Weight) -> Font { font(sans, "sans", size, w) }
  static func serifFont(_ size: CGFloat, _ w: Weight) -> Font { font(serif, "serif", size, w) }
  static func iconFont(_ size: CGFloat) -> Font? { icons.map { Font(CTFontCreateWithFontDescriptor($0, size, nil)) } }

  private static func tag(_ s: String) -> NSNumber {
    NSNumber(value: s.unicodeScalars.reduce(UInt32(0)) { $0 << 8 | $1.value })
  }
}

extension Font {
  /// Text: Anthropic Sans.
  @MainActor static func ui(_ size: CGFloat, _ w: Weight = .regular) -> Font { AppFonts.sansFont(size, w) }
  /// Names and large numbers: Anthropic Serif.
  @MainActor static func serif(_ size: CGFloat, _ w: Weight = .regular) -> Font { AppFonts.serifFont(size, w) }
}

/// An icon from Anthropicons, or the matching SF Symbol without it.
enum Glyph {
  case refresh, gear, plus, check, checkFilled, warning, close, chart, swap, key, trash, eye, eyeOff, info, gauge

  var code: UInt32 {
    switch self {
    case .refresh: return 0xE11D
    case .gear: return 0xE0D6
    case .plus: return 0xE001
    case .check: return 0xE03B
    case .checkFilled: return 0xE03D
    case .warning: return 0xE109
    case .close: return 0xE10F
    case .chart: return 0xE030
    case .swap: return 0xE016
    case .key: return 0xE091
    case .trash: return 0xE101
    case .eye: return 0xE069
    case .eyeOff: return 0xE06A
    case .info: return 0xE08F
    case .gauge: return 0xE12F
    }
  }

  var symbol: String {
    switch self {
    case .refresh: return "arrow.clockwise"
    case .gear: return "gearshape"
    case .plus: return "plus"
    case .check: return "checkmark"
    case .checkFilled: return "checkmark.circle.fill"
    case .warning: return "exclamationmark.triangle"
    case .close: return "xmark"
    case .chart: return "chart.xyaxis.line"
    case .swap: return "arrow.left.arrow.right"
    case .key: return "key.horizontal"
    case .trash: return "trash"
    case .eye: return "eye"
    case .eyeOff: return "eye.slash"
    case .info: return "info.circle"
    case .gauge: return "gauge.with.dots.needle.50percent"
    }
  }
}

struct Icon: View {
  let glyph: Glyph
  var size: CGFloat = 13

  init(_ glyph: Glyph, size: CGFloat = 13) { self.glyph = glyph; self.size = size }

  var body: some View {
    if let f = AppFonts.iconFont(size), let s = UnicodeScalar(glyph.code) {
      Text(String(Character(s))).font(f)
    } else {
      Image(systemName: glyph.symbol).font(.system(size: size * 0.85, weight: .medium))
    }
  }
}
