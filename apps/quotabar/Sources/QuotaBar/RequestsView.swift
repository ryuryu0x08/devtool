// The requests through the local forwarder in the last 10 minutes, newest first, read again every
// second: when, what was asked (and for which model), which gateway it went to, with whose key,
// and how it ended.
import AppKit
import QuotaCore
import SwiftUI

struct RequestsView: View {
  @State private var tab = 0

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Segmented(selection: $tab, options: [(0, "请求"), (1, "缓存命中")])
        Spacer()
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
      Divider()
      if tab == 0 { RequestList() } else { CacheView() }
    }
    .frame(minWidth: 760, minHeight: 320)
  }
}

/// The requests of the last 10 minutes.
private struct RequestList: View {
  @Environment(Store.self) private var store
  @State private var records: [RequestRecord] = []

  var body: some View {
    VStack(spacing: 0) {
      if records.isEmpty {
        VStack(spacing: 6) {
          Text("最近 10 分钟没有请求").font(.ui(13, .medium))
          Text(store.forwarderURL == nil ? "本地转发没在运行: 只记录经本地转发的请求" : "只记录经本地转发的请求 (Claude Code 和 Desktop 经它时)")
            .font(.ui(11.5))
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        Table(records) {
          TableColumn("时间") { r in Text(r.at.formatted(.dateTime.hour().minute().second())).font(.mono(11.5)).foregroundStyle(.secondary) }
            .width(64)
          TableColumn("请求") { r in Text("\(r.method) \(r.path)").font(.mono(11.5)).lineLimit(1).truncationMode(.middle).help("\(r.method) \(r.path)") }
            .width(min: 140, ideal: 200)
          TableColumn("模型") { r in
            let text = (r.model ?? "—") + (r.mappedTo.map { " → " + $0 } ?? "")
            Text(text).font(.mono(11.5)).lineLimit(1).foregroundStyle(r.model == nil ? .secondary : .primary).help(text)
          }
          .width(min: 120, ideal: 220)
          TableColumn("网关") { r in GatewayTag(gateway: r.gateway) }
            .width(min: 60, ideal: 90)
          TableColumn("Key") { r in Text(r.key ?? "未带 key").font(.ui(12)).lineLimit(1).foregroundStyle(r.key == nil ? .secondary : .primary) }
            .width(min: 70, ideal: 110)
          TableColumn("缓存") { r in CacheCell(usage: r.usage) }
            .width(min: 60, ideal: 80)
          TableColumn("结果") { r in Outcome(record: r) }
            .width(min: 80, ideal: 150)
        }
        .tableStyle(.inset(alternatesRowBackgrounds: true))
      }
      Divider()
      HStack(spacing: 10) {
        Text("\(records.count) 个请求 · 最近 10 分钟").font(.ui(11)).foregroundStyle(.secondary)
        Spacer()
        Button("转发日志") { NSWorkspace.shared.open(ForwardLog.url) }
          .buttonStyle(.link)
          .font(.ui(11))
          .help(ForwardLog.url.path)
      }
      .padding(.horizontal, 14)
      .padding(.vertical, 8)
    }
    .task {
      while !Task.isCancelled {
        let now = store.recentRequests()
        if now != records { records = now }
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }
}

/// Which gateway: 公司 / another's name / 全部 (the merged model list).
private struct GatewayTag: View {
  let gateway: RequestRecord.Gateway

  var body: some View {
    let (text, color): (String, Color) = switch gateway {
    case .company: ("公司", .blue)
    case .other(let name): (name, .purple)
    case .all: ("全部", .gray)
    }
    Text(text)
      .font(.ui(11, .medium))
      .lineLimit(1)
      .padding(.horizontal, 7)
      .padding(.vertical, 2)
      .background(color.opacity(0.14), in: Capsule())
      .foregroundStyle(color)
      .help(text)
  }
}

/// The status and the time to its reply ("200 · 812 ms"), why it failed here, or still under way.
private struct Outcome: View {
  let record: RequestRecord

  var body: some View {
    if let s = record.status {
      HStack(spacing: 5) {
        Text(s == 0 ? "无回复" : "\(s)")
          .font(.mono(11.5))
          .foregroundStyle((200..<400).contains(s) ? Color.green : Color.red)
        if let ms = record.ms { Text("\(ms) ms").font(.mono(11)).foregroundStyle(.secondary) }
        if let n = record.note { Text(n).font(.ui(11)).foregroundStyle(.secondary).lineLimit(1).help(n) }
      }
    } else {
      HStack(spacing: 5) {
        ProgressView().controlSize(.mini)
        Text("进行中").font(.ui(11)).foregroundStyle(.secondary)
      }
    }
  }
}

/// A reply's cache hit: the part of its input read from the cache ("命中 92%"), the tokens in its help.
private struct CacheCell: View {
  let usage: CacheUsage?

  var body: some View {
    if let u = usage, let rate = u.hitRate {
      Text("命中 \(Int((rate * 100).rounded()))%")
        .font(.mono(11.5))
        .foregroundStyle(CacheView.color(rate))
        .help("缓存读 \(u.cacheRead) · 缓存写 \(u.cacheWrite) · 未缓存输入 \(u.input) · 输出 \(u.output) tokens")
    } else {
      Text("—").font(.mono(11.5)).foregroundStyle(.secondary)
    }
  }
}
