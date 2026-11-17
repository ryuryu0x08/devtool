// Prompt-cache hits of the last 24 hours, per gateway and model: one row each (replies, the hit
// rate, the tokens read from the cache, written to it, and neither), and the hit rate by the hour.
// From the usage of the Messages replies that went through the local forwarder.
import Charts
import QuotaCore
import SwiftUI

struct CacheView: View {
  @Environment(Store.self) private var store
  @State private var buckets: [CacheBucket] = []
  @State private var now = Date()

  /// Green from 70 %, orange from 30 %, red under.
  static func color(_ rate: Double) -> Color { rate >= 0.7 ? .green : rate >= 0.3 ? .orange : .red }

  var body: some View {
    let rows = CacheStats.rows(buckets)
    VStack(spacing: 0) {
      if rows.isEmpty {
        VStack(spacing: 6) {
          Text("最近 24 小时没有缓存数据").font(.ui(13, .medium))
          Text("只统计经本地转发的对话请求 (POST /v1/messages) 回复里的 usage")
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
          TableColumn("请求") { r in Text("\(r.requests)").font(.mono(11.5)) }
            .width(min: 40, ideal: 50)
          TableColumn("命中率") { r in
            if let rate = r.usage.hitRate {
              Text(String(format: "%.1f%%", rate * 100)).font(.mono(12)).fontWeight(.semibold).foregroundStyle(Self.color(rate))
            } else {
              Text("—").foregroundStyle(.secondary)
            }
          }
          .width(min: 60, ideal: 70)
          TableColumn("缓存读") { r in Text(Self.tokens(r.usage.cacheRead)).font(.mono(11.5)) }
            .width(min: 60, ideal: 70)
          TableColumn("缓存写") { r in Text(Self.tokens(r.usage.cacheWrite)).font(.mono(11.5)) }
            .width(min: 60, ideal: 70)
          TableColumn("未缓存输入") { r in Text(Self.tokens(r.usage.input)).font(.mono(11.5)) }
            .width(min: 60, ideal: 80)
          TableColumn("输出") { r in Text(Self.tokens(r.usage.output)).font(.mono(11.5)) }
            .width(min: 50, ideal: 70)
        }
        .tableStyle(.inset(alternatesRowBackgrounds: true))
        .frame(minHeight: 120)
        Divider()
        chart(rows.prefix(6))
          .frame(height: 190)
          .padding(14)
      }
      Divider()
      Text("命中率 = 缓存读 / (缓存读 + 缓存写 + 未缓存输入) · 最近 24 小时 · 按小时")
        .font(.ui(11))
        .foregroundStyle(.secondary)
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

  /// The hit rate by the hour, one line for each of the most used gateways and models.
  private func chart(_ rows: ArraySlice<CacheRow>) -> some View {
    Chart {
      ForEach(Array(rows)) { r in
        ForEach(CacheStats.hourly(buckets, gateway: r.gateway, model: r.model, now: now)) { p in
          if let rate = p.rate {
            LineMark(x: .value("时间", p.start), y: .value("命中率", rate * 100))
              .foregroundStyle(by: .value("网关 · 模型", r.gateway + " · " + r.model))
            PointMark(x: .value("时间", p.start), y: .value("命中率", rate * 100))
              .foregroundStyle(by: .value("网关 · 模型", r.gateway + " · " + r.model))
              .symbolSize(14)
          }
        }
      }
    }
    .chartYScale(domain: 0...100)
    .chartYAxis { AxisMarks(values: [0, 25, 50, 75, 100]) { v in AxisGridLine(); AxisValueLabel { Text("\(v.as(Int.self) ?? 0)%").font(.ui(10)) } } }
    .chartXAxis { AxisMarks(values: .stride(by: .hour, count: 3)) { _ in AxisGridLine(); AxisValueLabel(format: .dateTime.hour()) } }
    .chartLegend(position: .bottom, alignment: .leading)
  }

  /// 1234 → "1,234"; 1234567 → "1.23M".
  static func tokens(_ n: Int) -> String {
    n >= 1_000_000 ? String(format: "%.2fM", Double(n) / 1_000_000) : n.formatted()
  }
}
