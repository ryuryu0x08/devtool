// The menu bar: the icon with what the key Claude Code uses can still use today, and the panel
// that opens from it, one row per key.
import QuotaCore
import SwiftUI

struct MenuLabel: View {
  @Environment(Store.self) private var store

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: icon)
      if let text { Text(text).monospacedDigit() }
    }
  }

  /// What the key Claude Code uses can still use today.
  private var text: String? {
    guard let k = store.activeKey, let r = store.latest[k.id], case .ok(let q, _) = r.reply else { return nil }
    return Fmt.num(KeyState(q).left)
  }

  private var icon: String {
    guard let k = store.activeKey, let r = store.latest[k.id] else { return "gauge.with.dots.needle.50percent" }
    guard case .ok(let q, _) = r.reply else { return "exclamationmark.triangle" }
    switch KeyState(q).kind {
    case .withinDaily: return "gauge.with.dots.needle.33percent"
    case .onOverflow: return "gauge.with.dots.needle.67percent"
    case .out: return "gauge.with.dots.needle.100percent"
    }
  }
}

struct PanelView: View {
  @Environment(Store.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      header
      NoticeBanner()
      if !store.configured {
        empty
      } else {
        if let q = store.poolReading { PoolRow(q: q) }
        ScrollView {
          VStack(spacing: 8) {
            ForEach(store.keys) { k in KeyRow(k: k) }
          }
        }
        .frame(maxHeight: 460)
        .fixedSize(horizontal: false, vertical: true)
        if store.hasKeyHelper {
          Label("settings.json 里还有 apiKeyHelper，Claude Code 可能优先用它给出的 key。", systemImage: "info.circle")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      Divider()
      footer
    }
    .padding(14)
    .frame(width: 360)
    .animation(.snappy, value: store.notice)
    .onAppear { store.readSettings() }
  }

  private var header: some View {
    HStack {
      Text("额度").font(.headline)
      if let t = store.lastRefresh {
        Text("更新于 \(t.formatted(date: .omitted, time: .standard))").font(.caption).foregroundStyle(.secondary)
      }
      Spacer()
      RefreshButton()
    }
  }

  private var empty: some View {
    VStack(spacing: 8) {
      Image(systemName: "key.horizontal").font(.largeTitle).foregroundStyle(.secondary)
      Text("先填写用量接口地址，再添加 key").foregroundStyle(.secondary)
      Button("打开设置") { Windows.showDashboard(store, settings: true) }
        .buttonStyle(.borderedProminent)
    }
    .frame(maxWidth: .infinity)
    .padding(.vertical, 16)
  }

  private var footer: some View {
    HStack {
      Button { Windows.showDashboard(store) } label: { Label("看板", systemImage: "chart.xyaxis.line") }
      Button { Windows.showDashboard(store, settings: true) } label: { Label("设置", systemImage: "gearshape") }
      Spacer()
      Button("退出") { NSApp.terminate(nil) }
    }
    .buttonStyle(.borderless)
    .font(.callout)
  }
}

struct RefreshButton: View {
  @Environment(Store.self) private var store

  var body: some View {
    Button {
      Task { await store.refresh() }
    } label: {
      Image(systemName: "arrow.clockwise")
        .rotationEffect(.degrees(store.refreshing ? 360 : 0))
        .animation(store.refreshing ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: store.refreshing)
    }
    .buttonStyle(.borderless)
    .disabled(store.refreshing)
    .help("立即刷新")
    .keyboardShortcut("r")
  }
}

/// The shared pool, once for all keys.
struct PoolRow: View {
  let q: Usage

  var body: some View {
    let p = Fmt.pct(q.pool, q.poolLimit)
    let color: Color = p >= 100 ? .red : p >= 80 ? .orange : .accentColor
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .firstTextBaseline) {
        Text("共用额度池").font(.subheadline.weight(.medium))
        Spacer()
        RollingNumber(value: q.pool, font: .callout.weight(.semibold))
        Text("/ \(Fmt.num(q.poolLimit))").font(.callout).foregroundStyle(.secondary).monospacedDigit()
        Text(String(format: "%.1f%%", p)).font(.caption.weight(.semibold)).foregroundStyle(color).monospacedDigit()
      }
      ProgressView(value: min(1, p / 100)).tint(color)
    }
    .card(padding: 10)
  }
}

struct KeyRow: View {
  @Environment(Store.self) private var store
  let k: KeyEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 6) {
        Text(store.title(k)).font(.subheadline.weight(.semibold)).lineLimit(1)
        if let r = store.latest[k.id], case .ok(let q, _) = r.reply {
          let s = KeyState(q)
          Chip(text: s.chip, color: s.kind.color)
        }
        Spacer()
        UseButton(k: k, compact: true)
      }
      switch store.latest[k.id]?.reply {
      case nil:
        Text("等待第一次刷新…").font(.caption).foregroundStyle(.secondary)
      case .failed(let why, _)?:
        Text(why).font(.caption).foregroundStyle(.red).lineLimit(3)
      case .ok(let q, _)?:
        let s = KeyState(q)
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          RollingNumber(value: s.left, font: .system(size: 22, weight: .semibold, design: .rounded))
          Text("今日还可用").font(.caption).foregroundStyle(.secondary)
          Spacer()
          Text("今日 \(Fmt.num(q.daily))/\(Fmt.num(q.dailyLimit))").font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }
        QuotaMeter(q: q, state: s, height: 6)
        if s.poolCaps {
          Text(s.parts).font(.caption2).foregroundStyle(.orange)
        }
      }
    }
    .card(padding: 10)
    .overlay(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .strokeBorder(Color.green.opacity(store.activeToken == k.key ? 0.7 : 0), lineWidth: 1.5)
    )
    .animation(.snappy, value: store.activeToken)
  }
}
