// The dashboard window: the shared pool, a card per key, and the trends.
import Charts
import QuotaCore
import SwiftUI

struct DashboardView: View {
  @Environment(Store.self) private var store
  @Binding var showSettings: Bool

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        NoticeBanner()
        if !store.configured {
          ContentUnavailableView {
            Label("还没有可查询的 key", systemImage: "key.horizontal")
          } description: {
            Text("在设置里填写用量接口地址并添加 key，每个 key 一张卡片。")
          } actions: {
            Button("打开设置") { showSettings = true }.buttonStyle(.borderedProminent)
          }
          .frame(maxWidth: .infinity, minHeight: 360)
        } else {
          if let q = store.poolReading { PoolCard(q: q) }
          KeyGrid()
          TrendsCard()
        }
      }
      .padding(20)
      .animation(.snappy, value: store.notice)
    }
    .frame(minWidth: 640, minHeight: 480)
    .toolbar {
      ToolbarItem(placement: .status) {
        if let t = store.lastRefresh {
          Text("每 \(store.config.interval) 秒刷新 · 更新于 \(t.formatted(date: .omitted, time: .standard))")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      ToolbarItem { RefreshButton() }
      ToolbarItem {
        Button { showSettings = true } label: { Label("设置", systemImage: "gearshape") }
          .keyboardShortcut(",")
      }
    }
    .sheet(isPresented: $showSettings) { SettingsView() }
    .onAppear { store.readSettings() }
  }
}

/// The key cards, as many to a row as fit (at least 280 wide), the cards of a row as tall as
/// the tallest.
struct KeyGrid: View {
  @Environment(Store.self) private var store
  @State private var width: CGFloat = 900

  var body: some View {
    let keys = store.keys
    let cols = max(1, Int((width + 14) / (280 + 14)))
    Grid(horizontalSpacing: 14, verticalSpacing: 14) {
      ForEach(Array(stride(from: 0, to: keys.count, by: cols)), id: \.self) { i in
        GridRow {
          ForEach(keys[i..<min(i + cols, keys.count)]) { k in
            KeyCard(k: k)
          }
          ForEach(0..<(cols - min(cols, keys.count - i)), id: \.self) { _ in
            Color.clear.frame(maxWidth: .infinity, maxHeight: 0)
          }
        }
      }
    }
    .frame(maxWidth: .infinity)
    .background(GeometryReader { g in
      Color.clear
        .onAppear { width = g.size.width }
        .onChange(of: g.size.width) { _, w in width = w }
    })
  }
}

struct PoolCard: View {
  let q: Usage

  var body: some View {
    let p = Fmt.pct(q.pool, q.poolLimit)
    let color: Color = p >= 100 ? .red : p >= 80 ? .orange : .accentColor
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          Text("共用额度池").font(.subheadline).foregroundStyle(.secondary)
          HStack(alignment: .firstTextBaseline, spacing: 4) {
            RollingNumber(value: q.pool)
            Text("/ \(Fmt.num(q.poolLimit))").foregroundStyle(.secondary).monospacedDigit()
          }
        }
        Spacer()
        Text(String(format: "%.1f%%", p))
          .font(.system(size: 22, weight: .semibold, design: .rounded)).monospacedDigit()
          .foregroundStyle(color)
          .contentTransition(.numericText(value: p))
          .animation(.snappy, value: p)
      }
      FillBar(fraction: p / 100, color: color)
      Text(p >= 100
           ? "共用额度池已满：今日额度用完后无法再用超额。"
           : "还剩 \(Fmt.num((q.poolLimit ?? 0) - (q.pool ?? 0)))。今日额度用完后，超额从这里扣，每人最多用到自己的超额上限；池子剩的不够时，超额以池子剩余为准。")
        .font(.caption).foregroundStyle(.secondary)
    }
    .card()
  }
}

struct KeyCard: View {
  @Environment(Store.self) private var store
  let k: KeyEntry

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Text(store.title(k)).font(.headline).lineLimit(1)
        if !k.name.isEmpty, let t = store.latest[k.id]?.reply.title, !t.isEmpty, t != k.name {
          Text(t).font(.caption).foregroundStyle(.secondary).lineLimit(1)
        }
        Spacer()
        if let r = store.latest[k.id], case .ok(let q, _) = r.reply {
          let s = KeyState(q)
          Chip(text: s.chip, color: s.kind.color)
        }
      }
      switch store.latest[k.id]?.reply {
      case nil:
        Text("等待第一次刷新…").foregroundStyle(.secondary)
      case .failed(let why, _)?:
        Label(why, systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(.red).font(.callout)
      case .ok(let q, _)?:
        let s = KeyState(q)
        VStack(alignment: .leading, spacing: 2) {
          Text("今日还可用").font(.caption).foregroundStyle(.secondary)
          RollingNumber(value: s.left, font: .system(size: 32, weight: .semibold, design: .rounded))
          Text(s.parts).font(.caption).foregroundStyle(s.poolCaps ? .orange : .secondary)
        }
        QuotaMeter(q: q, state: s)
        HStack(spacing: 14) {
          legend(color: .accentColor, "今日", q.daily, q.dailyLimit)
          if (q.overLimit ?? 0) > 0 { legend(color: .orange, "超额", q.over, q.overLimit) }
        }
      }
      Spacer(minLength: 0)
      Divider()
      HStack {
        if let at = store.latest[k.id]?.at {
          Text(at.formatted(date: .omitted, time: .standard)).font(.caption).foregroundStyle(.tertiary)
        }
        Spacer()
        UseButton(k: k)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .card()
    .overlay(
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .strokeBorder(Color.green.opacity(store.activeToken == k.key ? 0.7 : 0), lineWidth: 1.5)
    )
    .animation(.snappy, value: store.activeToken)
  }

  private func legend(color: Color, _ label: String, _ used: Double?, _ limit: Double?) -> some View {
    HStack(spacing: 5) {
      Circle().fill(color).frame(width: 7, height: 7)
      Text(label).foregroundStyle(.secondary)
      Text(Fmt.num(used)).fontWeight(.semibold)
      Text("/ \(Fmt.num(limit))").foregroundStyle(.secondary)
    }
    .font(.caption).monospacedDigit()
  }
}

/// Each key's use today and the shared pool over time.
struct TrendsCard: View {
  @Environment(Store.self) private var store
  @AppStorage("range") private var range = 86400
  @State private var hover: Date?

  private struct Point: Identifiable {
    var id: String { series + "@" + String(t.timeIntervalSince1970) }
    var t: Date
    var v: Double
    var series: String
  }

  var body: some View {
    let now = Date()
    let from = now.addingTimeInterval(-Double(range))
    let shown = store.history.filter { $0.t >= from }
    let names = seriesNames()
    let usage = shown.compactMap { s -> Point? in
      guard let v = s.daily, let n = names[s.key] else { return nil }
      return Point(t: s.t, v: v, series: n)
    }
    let pool = Dictionary(shown.compactMap { s in s.pool.map { (s.t, $0) } }, uniquingKeysWith: { a, _ in a })
      .map { Point(t: $0.key, v: $0.value, series: "共用池") }
      .sorted { $0.t < $1.t }

    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Text("趋势").font(.headline)
        Spacer()
        Picker("", selection: $range) {
          Text("1 小时").tag(3600)
          Text("6 小时").tag(6 * 3600)
          Text("24 小时").tag(86400)
          Text("7 天").tag(7 * 86400)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .fixedSize()
      }
      if usage.isEmpty {
        Text("这段时间还没有数据：App 运行期间每 5 分钟记一个点，保留 7 天。")
          .font(.callout).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, minHeight: 120)
      } else {
        chart("今日用量（含超额部分）", usage, from: from, to: now)
        if !pool.isEmpty { chart("共用额度池", pool, from: from, to: now, color: .orange) }
      }
    }
    .card()
    .animation(.smooth, value: range)
  }

  /// One name per key; two keys with the same name are told apart by their number.
  private func seriesNames() -> [String: String] {
    var out: [String: String] = [:], seen: [String: Int] = [:]
    for (i, k) in store.keys.enumerated() {
      let t = store.title(k)
      seen[t, default: 0] += 1
      out[k.id] = seen[t]! > 1 ? "\(t) #\(i + 1)" : t
    }
    return out
  }

  @ViewBuilder
  private func chart(_ title: String, _ points: [Point], from: Date, to: Date, color: Color? = nil) -> some View {
    let at = hover.flatMap { h in points.min { abs($0.t.timeIntervalSince(h)) < abs($1.t.timeIntervalSince(h)) }?.t }
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
      Chart {
        ForEach(points) { p in
          LineMark(x: .value("时间", p.t), y: .value("用量", p.v))
            .foregroundStyle(by: .value("key", p.series))
            .interpolationMethod(.monotone)
            .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round))
        }
        if let at {
          RuleMark(x: .value("时间", at))
            .foregroundStyle(.secondary.opacity(0.5))
            .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
              tooltip(at, points.filter { $0.t == at })
            }
          ForEach(points.filter { $0.t == at }) { p in
            PointMark(x: .value("时间", p.t), y: .value("用量", p.v))
              .foregroundStyle(by: .value("key", p.series))
              .symbolSize(40)
          }
        }
      }
      .chartForegroundStyleScale(range: color.map { [$0] } ?? palette)
      .chartXScale(domain: from...to)
      .chartXSelection(value: $hover)
      .chartLegend(points.contains { $0.series != points.first?.series } ? .visible : .hidden)
      .frame(height: 200)
    }
  }

  private var palette: [Color] { [.blue, .green, .purple, .pink, .teal, .orange, .indigo, .brown] }

  private func tooltip(_ t: Date, _ ps: [Point]) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(t.formatted(date: .abbreviated, time: .shortened)).font(.caption2).foregroundStyle(.secondary)
      ForEach(ps) { p in
        HStack(spacing: 6) {
          Text(p.series).font(.caption)
          Spacer(minLength: 8)
          Text(Fmt.num(p.v)).font(.caption.weight(.semibold)).monospacedDigit()
        }
      }
    }
    .padding(8)
    .frame(minWidth: 140)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}
