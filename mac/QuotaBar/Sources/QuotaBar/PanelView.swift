// The menu bar: the name of the person whose key Claude Code uses and what they can still use
// today, and the panel that opens from it, one row per person.
import QuotaCore
import SwiftUI

struct MenuLabel: View {
  @Environment(Store.self) private var store

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: icon)
      if let p = store.active {
        Text(text(p)).monospacedDigit()
      }
    }
  }

  private func text(_ p: Person) -> String {
    guard let g = store.shown(p).reading else { return p.label }
    return p.label + " " + Fmt.num(KeyState(g.usage).left)
  }

  private var icon: String {
    guard let p = store.active else { return "gauge.with.dots.needle.50percent" }
    switch store.shown(p) {
    case .failing, .noKey: return "exclamationmark.triangle"
    case .waiting: return "gauge.with.dots.needle.50percent"
    case .ok(let g):
      switch KeyState(g.usage).kind {
      case .withinDaily: return "gauge.with.dots.needle.33percent"
      case .onOverflow: return "gauge.with.dots.needle.67percent"
      case .out: return "gauge.with.dots.needle.100percent"
      }
    }
  }
}

struct PanelView: View {
  @Environment(Store.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      header
      NoticeBanner()
      if !store.hasURL {
        empty
      } else {
        if let q = store.poolReading { PoolRow(q: q).transition(.opacity) }
        ScrollView {
          VStack(spacing: 8) {
            ForEach(store.people) { p in
              PersonRow(p: p).transition(.asymmetric(insertion: .scale(scale: 0.97).combined(with: .opacity), removal: .opacity))
            }
          }
        }
        .frame(maxHeight: 460)
        .fixedSize(horizontal: false, vertical: true)
        AddKeyField()
        if store.hasKeyHelper {
          Trouble(text: "settings.json 里还有 apiKeyHelper，Claude Code 可能优先用它给出的 key。")
        }
      }
      Divider().padding(.top, 2)
      footer
    }
    .padding(14)
    .frame(width: 360)
    .animation(.snappy, value: store.notice)
    .animation(.snappy, value: store.people.map(\.id))
    .onAppear { store.readSettings() }
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline) {
      Text("额度").font(.serif(17, .semibold))
      if let t = store.lastRefresh {
        Text("更新于 \(t.formatted(date: .omitted, time: .standard))").font(.ui(11)).foregroundStyle(.secondary)
          .contentTransition(.numericText())
      }
      Spacer()
      RefreshButton()
    }
  }

  private var empty: some View {
    VStack(spacing: 10) {
      Icon(.key, size: 28).foregroundStyle(.secondary)
      Text("填写用量接口地址后，粘贴 key 就能看到额度").font(.ui(12.5)).foregroundStyle(.secondary)
      Button { Windows.showDashboard(store, settings: true) } label: { Text("填写接口地址").font(.ui(12.5, .medium)) }
        .buttonStyle(.borderedProminent)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 16)
  }

  private var footer: some View {
    HStack(spacing: 14) {
      Button { Windows.showDashboard(store) } label: { HStack(spacing: 5) { Icon(.chart, size: 12); Text("看板") } }
      Button { Windows.showDashboard(store, settings: true) } label: { HStack(spacing: 5) { Icon(.gear, size: 12); Text("设置") } }
      Spacer()
      Button("退出") { NSApp.terminate(nil) }
    }
    .buttonStyle(.borderless)
    .font(.ui(12))
  }
}

struct RefreshButton: View {
  @Environment(Store.self) private var store

  var body: some View {
    Button {
      Task { await store.refresh() }
    } label: {
      Icon(.refresh, size: 13)
        .rotationEffect(.degrees(store.refreshing ? 360 : 0))
        .animation(store.refreshing ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: store.refreshing)
    }
    .buttonStyle(.borderless)
    .disabled(store.refreshing)
    .help("立即刷新")
    .keyboardShortcut("r")
  }
}

/// The shared pool, once for everyone.
struct PoolRow: View {
  let q: Usage

  var body: some View {
    let p = Fmt.pct(q.pool, q.poolLimit)
    let color: Color = p >= 100 ? .red : p >= 80 ? .orange : .accentColor
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline, spacing: 4) {
        Text("共用额度池").font(.ui(12, .medium))
        Spacer()
        RollingNumber(value: q.pool, size: 14)
        Text("/ \(Fmt.num(q.poolLimit))").font(.ui(12)).foregroundStyle(.secondary).monospacedDigit()
        Text(String(format: "%.1f%%", p)).font(.ui(11, .semibold)).foregroundStyle(color).monospacedDigit()
          .padding(.leading, 4)
      }
      FillBar(fraction: p / 100, color: color, height: 5)
    }
    .card(padding: 10)
  }
}

struct PersonRow: View {
  @Environment(Store.self) private var store
  let p: Person

  var body: some View {
    let shown = store.shown(p)
    VStack(alignment: .leading, spacing: 7) {
      HStack(spacing: 6) {
        Text(p.label)
          .font(p.name == nil ? .system(size: 13, design: .monospaced) : .serif(15, .semibold))
          .lineLimit(1)
          .contentTransition(.opacity)
        if let g = shown.reading, !shown.stale {
          let s = KeyState(g.usage)
          Chip(text: s.chip, color: s.kind.color)
        }
        Spacer()
        UseButton(p: p, compact: true)
      }
      if let g = shown.reading {
        let s = KeyState(g.usage)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          RollingNumber(value: s.left, size: 22)
          Text("今日还可用").font(.ui(11)).foregroundStyle(.secondary)
          Spacer()
          Text("今日 \(Fmt.num(g.usage.daily))/\(Fmt.num(g.usage.dailyLimit))").font(.ui(11)).foregroundStyle(.secondary).monospacedDigit()
        }
        QuotaMeter(q: g.usage, height: 5)
        if s.poolCaps && !shown.stale {
          Text(s.parts).font(.ui(10.5)).foregroundStyle(.orange)
        }
      }
      trouble(shown)
    }
    .opacity(shown.stale && shown.reading != nil ? 0.85 : 1)
    .card(padding: 10, highlight: store.active?.id == p.id)
    .contextMenu {
      Button("删除「\(p.label)」", role: .destructive) { withAnimation(.snappy) { store.remove(p) } }
    }
  }

  @ViewBuilder
  private func trouble(_ s: Shown) -> some View {
    switch s {
    case .waiting:
      Text(store.adding ? "正在识别…" : "等待第一次刷新…").font(.ui(11)).foregroundStyle(.secondary)
    case .failing(let f, let last):
      Trouble(text: p.name == nil && last == nil ? "还没识别出是谁的 key：" + f.friendly : f.friendly, detail: f.detail, age: last?.at)
    case .noKey(let last):
      Trouble(text: "这个 key 已归到别人名下。粘贴「\(p.label)」的新 key 即可接上。", age: last?.at)
    case .ok:
      EmptyView()
    }
  }
}
