// Pieces shared by the menu bar panel and the dashboard.
import AppKit
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
          Text("使用中")
        }
        .font(.ui(11.5, .medium))
        .foregroundStyle(.green)
        .help("Claude Code 正在用这个 key")
        .transition(.opacity.combined(with: .scale(scale: 0.9)))
      } else if !p.key.isEmpty && (p.name != nil || p.lastGood != nil) {
        Button {
          store.use(p)
        } label: {
          HStack(spacing: 4) {
            Icon(.swap, size: 11)
            Text(compact ? "切换" : "用于 Claude")
          }
          .font(.ui(11.5, .medium))
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .help("Claude Code 和 Desktop 都改用这个人的 key")
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
      TextField("", text: $text, prompt: Text("粘贴 key, 回车添加").font(.ui(12.5)))
        .textFieldStyle(.plain)
        .font(.mono(12.5))
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
/// While requests fall back to the other gateway: why, and to which model. Stays as long as it
/// lasts (under the notices, which come and go above it).
struct FallbackBanner: View {
  @Environment(Store.self) private var store

  var body: some View {
    if let why = store.fallingBack, let m = store.fallbackModelNow {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Icon(.swap, size: 12).foregroundStyle(.purple)
        VStack(alignment: .leading, spacing: 2) {
          Text("降级中: \(why)").font(.ui(12, .medium))
          Text("改用其他网关的 \(m), 额度恢复后自动切回").font(.ui(11)).foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
        Button { Windows.show(.requests, store) } label: { Text("请求记录").font(.ui(11.5)) }
          .buttonStyle(.link)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .background(Color.purple.opacity(0.1), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
      .transition(.opacity)
    }
  }
}

struct NoticeBanner: View {
  @Environment(Store.self) private var store

  var body: some View {
    if let n = store.notice {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Icon(n.bad ? .warning : .checkFilled, size: 12)
          .foregroundStyle(n.bad ? .orange : .green)
        Text(n.text).font(.ui(12)).fixedSize(horizontal: false, vertical: true)
        Spacer(minLength: 0)
        if n.restartDesktop {
          Button { store.restartDesktop() } label: { Text("重启 Desktop").font(.ui(11.5, .medium)) }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
        }
        Button { withAnimation(.snappy) { store.notice = nil } } label: { Icon(.close, size: 10) }
          .buttonStyle(.plain)
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 10)
      .padding(.vertical, 8)
      .background((n.bad ? Color.orange : Color.green).opacity(0.1), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
      .transition(.move(edge: .top).combined(with: .opacity))
      .task(id: n.id) {
        try? await Task.sleep(for: .seconds(n.bad || n.restartDesktop ? 15 : 5))
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
      // The details (HTTP status, the API's message) in a bubble: the menu bar panel shows no
      // tooltips.
      if let detail, !detail.isEmpty {
        InfoTip(text: detail, size: 11)
      } else {
        Icon(.info, size: 11)
      }
      VStack(alignment: .leading, spacing: 1) {
        Text(text)
        if let age {
          Text("\(age.formatted(.relative(presentation: .named)))的数据").foregroundStyle(.tertiary)
        }
      }
    }
    .font(.ui(11))
    .foregroundStyle(.secondary)
    .fixedSize(horizontal: false, vertical: true)
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

/// A switch that keeps its colour while the window is in the background (the system's turns
/// grey then, which reads as "off").
struct BlueSwitch: ToggleStyle {
  func makeBody(configuration c: Configuration) -> some View {
    HStack {
      c.label
      Spacer()
      SwitchKnob(on: c.$isOn)
    }
  }
}

private struct SwitchKnob: View {
  @Binding var on: Bool
  @Environment(\.isEnabled) private var enabled

  var body: some View {
    Capsule()
      .fill(on ? Color.accentColor : Color.secondary.opacity(0.25))
      .frame(width: 34, height: 20)
      .overlay(alignment: on ? .trailing : .leading) {
        Circle()
          .fill(.white)
          .shadow(color: .black.opacity(0.25), radius: 1, y: 0.5)
          .padding(2)
      }
      .opacity(enabled ? 1 : 0.45)
      .contentShape(Capsule())
      .onTapGesture { if enabled { withAnimation(.snappy(duration: 0.2)) { on.toggle() } } }
      .accessibilityElement()
      .accessibilityAddTraits(.isButton)
      .accessibilityValue(on ? "开" : "关")
      .accessibilityAction { on.toggle() }
  }
}


/// An ⓘ that shows a text in a bubble while the pointer is on it (a moment after, so that
/// passing over it doesn't flash one); a click keeps it open, to select and copy the text, until
/// a click elsewhere. `.help` tooltips don't show in a toggle's label or in the menu bar panel.
struct InfoTip: View {
  let text: String
  var size: CGFloat = 12
  /// Shown once it appears (for the CI screenshot).
  var showAtStart = false
  @State private var shown = false
  @State private var over = false
  /// Opened by a click: stays open (to select and copy the text) until a click elsewhere.
  @State private var pinned = false

  var body: some View {
    Icon(.info, size: size)
      .foregroundStyle(over || shown ? Color.accentColor : Color.secondary)
      .frame(width: size + 4, height: size + 4)
      .contentShape(Rectangle())
      .onHover { on in
        over = on
        if on {
          Task {
            try? await Task.sleep(for: .milliseconds(250))
            if over { shown = true }
          }
        } else if !pinned {
          shown = false
        }
      }
      .onTapGesture {
        pinned = !(shown && pinned)
        shown = pinned
      }
      .onChange(of: shown) { _, now in if !now { pinned = false } }
      .popover(isPresented: $shown, arrowEdge: .bottom) {
        // A set width the text is wrapped to (a "most" width lets it wrap narrower than the
        // bubble, leaving its right side empty).
        Text(text)
          .font(.ui(12))
          .lineSpacing(2)
          .textSelection(.enabled)
          .fixedSize(horizontal: false, vertical: true)
          .frame(width: 300, alignment: .leading)
          .padding(.horizontal, 12)
          .padding(.vertical, 8)
      }
      .animation(.snappy(duration: 0.15), value: over)
      .task {
        guard showAtStart else { return }
        try? await Task.sleep(for: .seconds(1))
        shown = true
      }
  }
}

/// A segmented choice in the app's fonts (the system's segmented and pop-up controls draw their
/// titles in the system font, whatever the view says).
struct Segmented<Value: Hashable>: View {
  @Binding var selection: Value
  let options: [(Value, String)]
  @Namespace private var thumb

  var body: some View {
    HStack(spacing: 2) {
      ForEach(options.indices, id: \.self) { i in
        let value = options[i].0
        let on = value == selection
        Text(options[i].1)
          .font(.ui(12, on ? .medium : .regular))
          .foregroundStyle(on ? .primary : .secondary)
          .padding(.horizontal, 10)
          .frame(minHeight: 22)
          .background {
            if on {
              RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(Color(nsColor: .controlColor))
                .shadow(color: .black.opacity(0.12), radius: 1, y: 0.5)
                .matchedGeometryEffect(id: "thumb", in: thumb)
            }
          }
          .contentShape(Rectangle())
          .onTapGesture {
            guard !on else { return }
            withAnimation(.snappy(duration: 0.2)) { selection = value }
          }
          .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
      }
    }
    .padding(2)
    .background(Color.primary.opacity(0.07), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
    .fixedSize()
  }
}
