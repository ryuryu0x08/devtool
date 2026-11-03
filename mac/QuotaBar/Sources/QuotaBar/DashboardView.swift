// The dashboard window: the shared pool, a card per person, and the trends.
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
        if !store.hasURL {
          ContentUnavailableView {
            Label { Text("先填写用量接口地址").font(.serif(20, .semibold)) } icon: { Icon(.key, size: 30) }
          } description: {
            Text("之后粘贴 key 即可：是谁的 key 会自动识别。").font(.ui(13))
          } actions: {
            Button { showSettings = true } label: { Text("填写接口地址").font(.ui(13, .medium)) }.buttonStyle(.borderedProminent)
          }
          .frame(maxWidth: .infinity, minHeight: 360)
        } else {
          if let q = store.poolReading { PoolCard(q: q).transition(.opacity) }
          PersonGrid()
          AddKeyField().frame(maxWidth: 420)
          if !store.history.isEmpty { TrendsCard() }
        }
      }
      .padding(20)
      .animation(.snappy, value: store.notice)
      .animation(.snappy, value: store.people.map(\.id))
    }
    .frame(minWidth: 640, minHeight: 480)
    .toolbar {
      ToolbarItem(placement: .status) {
        if let t = store.lastRefresh {
          Text("每 \(store.config.interval) 秒刷新 · 更新于 \(t.formatted(date: .omitted, time: .standard))")
            .font(.ui(11)).foregroundStyle(.secondary)
        }
      }
      ToolbarItem { RefreshButton() }
      ToolbarItem {
        Button { showSettings = true } label: { Icon(.gear, size: 14) }
          .help("设置")
          .keyboardShortcut(",")
      }
    }
    .sheet(isPresented: $showSettings) { SettingsView() }
    .onAppear { store.readSettings() }
  }
}

/// The person cards, as many to a row as fit (at least 280 wide), the cards of a row as tall as
/// the tallest.
struct PersonGrid: View {
  @Environment(Store.self) private var store
  @State private var width: CGFloat = 900

  var body: some View {
    let people = store.people
    let cols = max(1, Int((width + 14) / (280 + 14)))
    Grid(horizontalSpacing: 14, verticalSpacing: 14) {
      ForEach(Array(stride(from: 0, to: people.count, by: cols)), id: \.self) { i in
        GridRow {
          ForEach(people[i..<min(i + cols, people.count)]) { p in
            PersonCard(p: p).transition(.asymmetric(insertion: .scale(scale: 0.97).combined(with: .opacity), removal: .opacity))
          }
          ForEach(0..<(cols - min(cols, people.count - i)), id: \.self) { _ in
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
          Text("共用额度池").font(.ui(12)).foregroundStyle(.secondary)
          HStack(alignment: .firstTextBaseline, spacing: 4) {
            RollingNumber(value: q.pool)
            Text("/ \(Fmt.num(q.poolLimit))").font(.ui(13)).foregroundStyle(.secondary).monospacedDigit()
          }
        }
        Spacer()
        Text(String(format: "%.1f%%", p))
          .font(.serif(24, .medium)).monospacedDigit()
          .foregroundStyle(color)
          .contentTransition(.numericText(value: p))
          .animation(.snappy, value: p)
      }
      FillBar(fraction: p / 100, color: color)
      Text(p >= 100
           ? "共用额度池已满：今日额度用完后无法再用超额。"
           : "还剩 \(Fmt.num((q.poolLimit ?? 0) - (q.pool ?? 0)))。今日额度用完后，超额从这里扣，每人最多用到自己的超额上限；池子剩的不够时，超额以池子剩余为准。")
        .font(.ui(11.5)).foregroundStyle(.secondary)
    }
    .card()
  }
}

struct PersonCard: View {
  @Environment(Store.self) private var store
  let p: Person

  var body: some View {
    let shown = store.shown(p)
    VStack(alignment: .leading, spacing: 10) {
      HStack(spacing: 6) {
        Text(p.label)
          .font(p.name == nil ? .system(size: 14, design: .monospaced) : .serif(18, .semibold))
          .lineLimit(1)
          .contentTransition(.opacity)
        Spacer()
        if let g = shown.reading, !shown.stale {
          let s = KeyState(g.usage)
          Chip(text: s.chip, color: s.kind.color)
        }
      }
      if let g = shown.reading {
        let s = KeyState(g.usage)
        VStack(alignment: .leading, spacing: 2) {
          Text("今日还可用").font(.ui(11.5)).foregroundStyle(.secondary)
          RollingNumber(value: s.left, size: 34)
          Text(s.parts).font(.ui(11.5)).foregroundStyle(s.poolCaps && !shown.stale ? .orange : .secondary)
        }
        QuotaMeter(q: g.usage)
        HStack(spacing: 14) {
          legend(color: .accentColor, "今日", g.usage.daily, g.usage.dailyLimit)
          if (g.usage.overLimit ?? 0) > 0 { legend(color: .orange, "超额", g.usage.over, g.usage.overLimit) }
        }
      }
      trouble(shown)
      Spacer(minLength: 0)
      Divider()
      HStack {
        if let at = shown.reading?.at {
          Text(at.formatted(date: .omitted, time: .standard)).font(.ui(11)).foregroundStyle(.tertiary)
        }
        Spacer()
        UseButton(p: p)
      }
    }
    .opacity(shown.stale && shown.reading != nil ? 0.85 : 1)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .card(highlight: store.active?.id == p.id)
    .contextMenu {
      Button("删除「\(p.label)」", role: .destructive) { withAnimation(.snappy) { store.remove(p) } }
    }
  }

  @ViewBuilder
  private func trouble(_ s: Shown) -> some View {
    switch s {
    case .waiting:
      Text(store.adding ? "正在识别…" : "等待第一次刷新…").font(.ui(12)).foregroundStyle(.secondary)
    case .failing(let f, let last):
      Trouble(text: p.name == nil && last == nil ? "还没识别出是谁的 key：" + f.friendly : f.friendly, detail: f.detail, age: last?.at)
    case .noKey(let last):
      Trouble(text: "这个 key 已归到别人名下。粘贴「\(p.label)」的新 key 即可接上。", age: last?.at)
    case .ok:
      EmptyView()
    }
  }

  private func legend(color: Color, _ label: String, _ used: Double?, _ limit: Double?) -> some View {
    HStack(spacing: 5) {
      Circle().fill(color).frame(width: 7, height: 7)
      Text(label).foregroundStyle(.secondary)
      Text(Fmt.num(used)).font(.ui(11.5, .semibold))
      Text("/ \(Fmt.num(limit))").foregroundStyle(.secondary)
    }
    .font(.ui(11.5)).monospacedDigit()
  }
}

/// Each person's use today and the shared pool over time.
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
        Text("趋势").font(.serif(17, .semibold))
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
          .font(.ui(12.5)).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, minHeight: 120)
      } else {
        chart("今日用量（含超额部分）", usage, from: from, to: now)
        if !pool.isEmpty { chart("共用额度池", pool, from: from, to: now, color: .orange) }
      }
    }
    .card()
    .animation(.smooth, value: range)
  }

  /// One name per person; two people shown the same way are told apart by their number.
  private func seriesNames() -> [String: String] {
    var out: [String: String] = [:], seen: [String: Int] = [:]
    for (i, p) in store.people.enumerated() {
      seen[p.label, default: 0] += 1
      out[p.id] = seen[p.label]! > 1 ? "\(p.label) #\(i + 1)" : p.label
    }
    return out
  }

  @ViewBuilder
  private func chart(_ title: String, _ points: [Point], from: Date, to: Date, color: Color? = nil) -> some View {
    let at = hover.flatMap { h in points.min { abs($0.t.timeIntervalSince(h)) < abs($1.t.timeIntervalSince(h)) }?.t }
    VStack(alignment: .leading, spacing: 6) {
      Text(title).font(.ui(12, .medium)).foregroundStyle(.secondary)
      Chart {
        ForEach(points) { p in
          LineMark(x: .value("时间", p.t), y: .value("用量", p.v))
            .foregroundStyle(by: .value("人", p.series))
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
              .foregroundStyle(by: .value("人", p.series))
              .symbolSize(40)
          }
        }
      }
      .chartForegroundStyleScale(range: color.map { [$0] } ?? palette)
      .chartXScale(domain: from...to)
      // Use is never below 0: the axis starts there.
      .chartYScale(domain: 0...max(1, (points.map(\.v).max() ?? 0) * 1.1))
      .chartXAxis { AxisMarks { _ in AxisGridLine(); AxisValueLabel().font(.ui(10)) } }
      .chartYAxis { AxisMarks { _ in AxisGridLine(); AxisValueLabel().font(.ui(10)) } }
      .chartLegend(points.contains { $0.series != points.first?.series } ? .visible : .hidden)
      .chartLegend(position: .bottom, alignment: .leading)
      .chartXSelection(value: $hover)
      .frame(height: 200)
    }
  }

  private var palette: [Color] { [.blue, .green, .purple, .pink, .teal, .orange, .indigo, .brown] }

  private func tooltip(_ t: Date, _ ps: [Point]) -> some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(t.formatted(date: .abbreviated, time: .shortened)).font(.ui(10.5)).foregroundStyle(.secondary)
      ForEach(ps) { p in
        HStack(spacing: 6) {
          Text(p.series).font(.ui(11.5))
          Spacer(minLength: 8)
          Text(Fmt.num(p.v)).font(.ui(11.5, .semibold)).monospacedDigit()
        }
      }
    }
    .padding(8)
    .frame(minWidth: 140)
    .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
  }
}
