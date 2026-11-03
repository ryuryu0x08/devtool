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
  var size: CGFloat = 28
  /// An older reading (the latest failed): shown lighter.
  var stale = false

  var body: some View {
    Text(Fmt.num(value))
      .font(.serif(size, .medium))
      .monospacedDigit()
      .foregroundStyle(stale ? .secondary : .primary)
      .contentTransition(.numericText(value: value ?? 0))
      .animation(.snappy, value: value)
  }
}

struct Chip: View {
  let text: String
  let color: Color

  var body: some View {
    Text(text)
      .font(.ui(10.5, .semibold))
      .padding(.horizontal, 7)
      .padding(.vertical, 2.5)
      .foregroundStyle(color)
      .background(color.opacity(0.13), in: Capsule())
      .contentTransition(.opacity)
  }
}

/// A bar filled to `fraction` (0…1), keeping its colour whether or not the window is in front.
struct FillBar: View {
  let fraction: Double
  let color: Color
  var height: CGFloat = 8

  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        Capsule().fill(color.opacity(0.15))
        Capsule().fill(color.gradient).frame(width: g.size.width * min(1, max(0, fraction)))
      }
    }
    .frame(height: height)
    .animation(.smooth(duration: 0.5), value: fraction)
  }
}

/// Today's quota and the overflow as two segments, sized by their limits (200 + 100 reads as two
/// thirds and one third), each filled as far as it is used.
struct QuotaMeter: View {
  let q: Usage
  var height: CGFloat = 8

  var body: some View {
    let s = KeyState(q)
    let dl = max(0, q.dailyLimit ?? 0), ol = max(0, q.overLimit ?? 0)
    GeometryReader { g in
      let gap: CGFloat = dl > 0 && ol > 0 ? 3 : 0
      let w = max(0, g.size.width - gap)
      HStack(spacing: gap) {
        if dl > 0 {
          FillBar(fraction: Fmt.pct(q.daily, dl) / 100, color: s.kind != .withinDaily && ol <= 0 ? .red : .accentColor, height: height)
            .frame(width: w * dl / (dl + ol))
        }
        if ol > 0 {
          FillBar(fraction: Fmt.pct(q.over, ol) / 100, color: s.kind == .out ? .red : .orange, height: height)
            .frame(width: w * ol / (dl + ol))
        }
      }
    }
    .frame(height: height)
  }
}

/// A rounded card background that reads well in light and dark mode.
struct CardBackground: ViewModifier {
  var padding: CGFloat = 14
  var highlight = false

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .background(.background.secondary, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: 12, style: .continuous)
          .strokeBorder(highlight ? AnyShapeStyle(Color.green.opacity(0.75)) : AnyShapeStyle(.separator.opacity(0.6)), lineWidth: highlight ? 1.5 : 0.5)
      )
      .animation(.snappy, value: highlight)
  }
}

extension View {
  func card(padding: CGFloat = 14, highlight: Bool = false) -> some View { modifier(CardBackground(padding: padding, highlight: highlight)) }
}

/// "用于 Claude Code", or a mark when Claude Code already uses this person's key.
struct UseButton: View {
  @Environment(Store.self) private var store
  let p: Person
  var compact = false

  var body: some View {
    Group {
      if store.active?.id == p.id {
        HStack(spacing: 4) {
          Icon(.checkFilled, size: 12)
          Text(compact ? "使用中" : "Claude Code 使用中")
        }
        .font(.ui(11.5, .medium))
        .foregroundStyle(.green)
        .help("Claude Code 的 ANTHROPIC_AUTH_TOKEN 是这个人的 key")
        .transition(.opacity.combined(with: .scale(scale: 0.9)))
      } else if !p.key.isEmpty && (p.name != nil || p.lastGood != nil) {
        Button {
          store.use(p)
        } label: {
          HStack(spacing: 4) {
            Icon(.swap, size: 11)
            Text(compact ? "切换" : "用于 Claude Code")
          }
          .font(.ui(11.5, .medium))
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .help("把 Claude Code 的 ANTHROPIC_AUTH_TOKEN 换成这个人的 key")
        .transition(.opacity.combined(with: .scale(scale: 0.9)))
      }
    }
    .animation(.snappy, value: store.active?.id)
  }
}

/// Where a key is pasted to add it: Return adds it, its name is found by itself.
struct AddKeyField: View {
  @Environment(Store.self) private var store
  @State private var text = ""
  @FocusState private var focused: Bool

  var body: some View {
    HStack(spacing: 8) {
      Group {
        if store.adding {
          ProgressView().controlSize(.small).frame(width: 14, height: 14)
        } else {
          Icon(.key, size: 13).foregroundStyle(.secondary)
        }
      }
      .frame(width: 16)
      TextField("", text: $text, prompt: Text("粘贴新 key，回车添加").font(.ui(12.5)))
        .textFieldStyle(.plain)
        .font(.system(size: 12.5, design: .monospaced))
        .focused($focused)
        .onSubmit(submit)
        .disabled(store.adding)
      if !text.isEmpty && !store.adding {
        Button(action: submit) { Icon(.plus, size: 12) }
          .buttonStyle(.borderless)
          .help("添加")
          .transition(.opacity)
      }
    }
    .padding(.horizontal, 10)
    .frame(height: 32)
    .background(.background.secondary, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    .overlay(
      RoundedRectangle(cornerRadius: 9, style: .continuous)
        .strokeBorder(focused ? AnyShapeStyle(Color.accentColor.opacity(0.7)) : AnyShapeStyle(.separator.opacity(0.6)), lineWidth: focused ? 1.5 : 0.5)
    )
    .animation(.snappy(duration: 0.2), value: focused)
    .animation(.snappy(duration: 0.2), value: text.isEmpty)
  }

  private func submit() {
    let t = text
    guard !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    text = ""
    Task { await store.add(t) }
  }
}

/// The message after an action, fading out by itself.
struct NoticeBanner: View {
  @Environment(Store.self) private var store

  var body: some View {
    if let n = store.notice {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Icon(n.bad ? .warning : .checkFilled, size: 12)
          .foregroundStyle(n.bad ? .orange : .green)
        Text(n.text).font(.ui(12)).fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
        Button { withAnimation(.snappy) { store.notice = nil } } label: { Icon(.close, size: 10) }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .background((n.bad ? Color.orange : Color.green).opacity(0.1), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
      .transition(.move(edge: .top).combined(with: .opacity))
      .task(id: n.id) {
        try? await Task.sleep(for: .seconds(n.bad ? 10 : 5))
        withAnimation(.snappy) { if store.notice?.id == n.id { store.notice = nil } }
      }
    }
  }
}

/// A person's state when the last reading failed or the key is gone: kindly, with the details on hover.
struct Trouble: View {
  let text: String
  var detail: String?
  var age: Date?

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Icon(.info, size: 11)
      VStack(alignment: .leading, spacing: 1) {
        Text(text)
        if let age {
          Text("显示的是 \(age.formatted(.relative(presentation: .named))) 的数据").foregroundStyle(.tertiary)
        }
      }
    }
    .font(.ui(11))
    .foregroundStyle(.secondary)
    .fixedSize(horizontal: false, vertical: true)
    .help(detail ?? "")
  }
}

extension Shown {
  var reading: GoodReading? {
    switch self {
    case .ok(let g): return g
    case .failing(_, let g), .noKey(let g): return g
    case .waiting: return nil
    }
  }

  var stale: Bool {
    if case .ok = self { return false }
    return true
  }
}
