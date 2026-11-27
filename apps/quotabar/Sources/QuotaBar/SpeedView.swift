// How fast each gateway and model streamed in the last 24 hours: one row each (the streamed
// replies, the time to the first token half of them, 90 % and 99 % got within, and the speed
// after it), and by the hour the 99 % time or the speed. From the streamed Messages replies that
// went through the local forwarder (the same readings as the cache hits).
import Charts
import QuotaCore
import SwiftUI

struct SpeedView: View {
  @Environment(Store.self) private var store
  @State private var buckets: [CacheBucket] = []
  @State private var now = Date()
  /// What the chart shows: 0 the time to the first token (P99), 1 the speed after it.
  @State private var chartOf = 0

  var body: some View {
    let rows = CacheStats.rows(buckets).filter { $0.streamed > 0 }.sorted { ($0.streamed, $1.id) > ($1.streamed, $0.id) }
    VStack(spacing: 0) {
      if rows.isEmpty {
        VStack(spacing: 6) {
          Text("最近 24 小时没有流式回复").font(.ui(13, .medium))
          Text("只统计经本地转发的流式对话请求 (POST /v1/messages, stream) 的回复")
            .font(.ui(11.5))
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        Table(rows) {
          TableColumn("网关") { r in Text(r.gateway).font(.ui(12)).lineLimit(1).help(r.gateway) }
            .width(min: 60, ideal: 90)
          TableColumn("模型") { r in Text(r.model).font(.mono(11.5)).lineLimit(1).help(r.model) }
            .width(min: 120, ideal: 200)
          TableColumn("流式回复") { r in Text("\(r.streamed)").font(.mono(11.5)).help("共 \(r.requests) 个回复, 其中 \(r.streamed) 个流式") }
            .width(min: 50, ideal: 60)
          TableColumn("首 token P50") { r in Self.durationText(r.firstToken(0.5)) }
            .width(min: 70, ideal: 85)
          TableColumn("P90") { r in Self.durationText(r.firstToken(0.9)) }
            .width(min: 60, ideal: 75)
          TableColumn("P99") { r in Self.durationText(r.firstToken(0.99), strong: true).help(r.streamed < 100 ? "不到 100 个回复, P99 即最慢的一个" : "99% 的回复在这个时间内出了首 token") }
            .width(min: 60, ideal: 75)
          TableColumn("解码速度") { r in
            Text(r.tokensPerSecond.map(Self.rate) ?? "—")
              .font(.mono(12))
              .fontWeight(.semibold)
              .foregroundStyle(r.tokensPerSecond == nil ? .secondary : .primary)
              .help("首 token 之后 \(r.decodeTokens.formatted()) tokens, 用了 \(Self.duration(r.decodeMs))")
          }
          .width(min: 70, ideal: 90)
        }
        .tableStyle(.inset(alternatesRowBackgrounds: true))
        .frame(minHeight: 120)
        Divider()
        VStack(alignment: .leading, spacing: 8) {
          Segmented(selection: $chartOf, options: [(0, "首 token P99"), (1, "解码速度")])
          chart(rows.prefix(6))
        }
        .frame(height: 210)
        .padding(14)
      }
      Divider()
      Text("首 token = 请求发给网关 → 收到第一个 content_block_delta (含 thinking) · 解码速度 = 首 token 之后的输出 tokens / 首个到最后一个 token 的时间, 按 token 加权 · 最近 24 小时")
        .font(.ui(11))
        .foregroundStyle(.secondary)
        .lineLimit(2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
    }
    .task {
      while !Task.isCancelled {
        let b = store.cacheBuckets()
        if b != buckets { buckets = b }
        now = Date()
        try? await Task.sleep(for: .seconds(5))
      }
    }
  }

  /// By the hour, one line for each of the most streamed gateways and models: the time to the
  /// first token 99 % of the hour's replies got within (s), or their speed after it (tokens/s).
  private func chart(_ rows: ArraySlice<CacheRow>) -> some View {
    let series = rows.map { $0.gateway + " · " + $0.model }
    let unit = chartOf == 0 ? "s" : "tok/s"
    return Chart {
      ForEach(Array(rows)) { r in
        let name = r.gateway + " · " + r.model
        ForEach(CacheStats.hourly(buckets, gateway: r.gateway, model: r.model, now: now)) { p in
          if let v = chartOf == 0 ? p.firstToken99.map({ Double($0) / 1000 }) : p.tokensPerSecond {
            LineMark(x: .value("时间", p.start), y: .value(unit, v))
              .foregroundStyle(by: .value("网关 · 模型", name))
            PointMark(x: .value("时间", p.start), y: .value(unit, v))
              .foregroundStyle(by: .value("网关 · 模型", name))
              .symbolSize(14)
          }
        }
      }
    }
    .chartForegroundStyleScale(domain: series)
    .chartYAxis { AxisMarks { v in AxisGridLine(); AxisValueLabel { Text("\(v.as(Double.self).map { $0.formatted(.number.precision(.fractionLength(0...1))) } ?? "") \(unit)").font(.ui(10)) } } }
    .chartXAxis { AxisMarks(values: .stride(by: .hour, count: 3)) { _ in AxisGridLine(); AxisValueLabel(format: .dateTime.hour()) } }
    .chartLegend(position: .bottom, alignment: .leading)
  }

  private static func durationText(_ ms: Int?, strong: Bool = false) -> some View {
    Text(ms.map(duration) ?? "—")
      .font(.mono(strong ? 12 : 11.5))
      .fontWeight(strong ? .semibold : .regular)
      .foregroundStyle(ms == nil ? .secondary : .primary)
  }

  /// 850 → "850 ms"; 1234 → "1.23 s"; 12345 → "12.3 s".
  static func duration(_ ms: Int) -> String {
    if ms < 1000 { return "\(ms) ms" }
    let s = Double(ms) / 1000
    return String(format: s < 10 ? "%.2f s" : "%.1f s", s)
  }

  /// 85.27 → "85.3 tok/s".
  static func rate(_ tps: Double) -> String {
    String(format: tps < 100 ? "%.1f tok/s" : "%.0f tok/s", tps)
  }
}
