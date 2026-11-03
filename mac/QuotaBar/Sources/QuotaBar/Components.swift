// Pieces shared by the menu bar panel and the dashboard.
import QuotaCore
import SwiftUI

extension KeyState.Kind {
  var color: Color {
    switch self {
    case .withinDaily: return .green
    case .onOverflow: return .orange
    case .out: return .red
    }
  }
}

/// A number that rolls to its new value.
struct RollingNumber: View {
  let value: Double?
  var font: Font = .system(size: 28, weight: .semibold, design: .rounded)

  var body: some View {
    Text(Fmt.num(value))
      .font(font)
      .monospacedDigit()
      .contentTransition(.numericText(value: value ?? 0))
      .animation(.snappy, value: value)
  }
}

struct Chip: View {
  let text: String
  let color: Color

  var body: some View {
    Text(text)
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 7)
      .padding(.vertical, 2.5)
      .foregroundStyle(color)
      .background(color.opacity(0.14), in: Capsule())
  }
}

/// Today's quota and the overflow as two segments, sized by their limits (200 + 100 reads as two
/// thirds and one third), each filled as far as it is used.
struct QuotaMeter: View {
  let q: Usage
  let state: KeyState
  var height: CGFloat = 8

  var body: some View {
    let dl = max(0, q.dailyLimit ?? 0), ol = max(0, q.overLimit ?? 0)
    GeometryReader { g in
      let gap: CGFloat = dl > 0 && ol > 0 ? 3 : 0
      let w = max(0, g.size.width - gap)
      HStack(spacing: gap) {
        if dl > 0 {
          segment(fill: Fmt.pct(q.daily, dl), color: .accentColor, full: state.kind != .withinDaily && ol <= 0)
            .frame(width: w * dl / (dl + ol))
        }
        if ol > 0 {
          segment(fill: Fmt.pct(q.over, ol), color: .orange, full: state.kind == .out)
            .frame(width: w * ol / (dl + ol))
        }
      }
    }
    .frame(height: height)
  }

  private func segment(fill: Double, color: Color, full: Bool) -> some View {
    let c = full ? Color.red : color
    return GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(c.opacity(0.16))
        Capsule().fill(c.gradient).frame(width: g.size.width * min(1, max(0, fill / 100)))
      }
    }
    .animation(.smooth(duration: 0.5), value: fill)
  }
}

/// A rounded card background that reads well in light and dark mode.
struct CardBackground: ViewModifier {
  var padding: CGFloat = 14

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(.separator.opacity(0.6), lineWidth: 0.5))
  }
}

extension View {
  func card(padding: CGFloat = 14) -> some View { modifier(CardBackground(padding: padding)) }
}

/// "用于 Claude Code", or a mark when Claude Code already uses this key.
struct UseButton: View {
  @Environment(Store.self) private var store
  let k: KeyEntry
  var compact = false

  var body: some View {
    if store.activeToken == k.key {
      Label(compact ? "使用中" : "Claude Code 使用中", systemImage: "checkmark.circle.fill")
        .font(.caption.weight(.medium))
        .foregroundStyle(.green)
        .help("~/.claude/settings.json 里的 ANTHROPIC_AUTH_TOKEN 就是这个 key")
    } else {
      Button {
        withAnimation(.snappy) { store.use(k) }
      } label: {
        Label(compact ? "切换" : "用于 Claude Code", systemImage: "arrow.left.arrow.right")
          .font(.caption.weight(.medium))
      }
      .buttonStyle(.bordered)
      .controlSize(.small)
      .help("把 Claude Code 的 ANTHROPIC_AUTH_TOKEN 换成这个 key")
    }
  }
}

/// The message after an action, fading out by itself.
struct NoticeBanner: View {
  @Environment(Store.self) private var store

  var body: some View {
    if let n = store.notice {
      HStack(alignment: .top, spacing: 8) {
        Image(systemName: n.bad ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
          .foregroundStyle(n.bad ? .red : .green)
        Text(n.text).font(.callout).fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
        Button { withAnimation { store.notice = nil } } label: { Image(systemName: "xmark") }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
      }
      .padding(10)
      .background((n.bad ? Color.red : Color.green).opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
      .transition(.move(edge: .top).combined(with: .opacity))
      .task(id: n.id) {
        try? await Task.sleep(for: .seconds(n.bad ? 12 : 5))
        withAnimation { if store.notice?.id == n.id { store.notice = nil } }
      }
    }
  }
}
