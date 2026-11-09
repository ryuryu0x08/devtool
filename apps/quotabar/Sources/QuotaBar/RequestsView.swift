// The requests through the local forwarder in the last 10 minutes, newest first, read again every
// second: when, what was asked (and for which model), which gateway it went to, with whose key,
// and how it ended.
import AppKit
import QuotaCore
import SwiftUI

struct RequestsView: View {
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
            .width(70)
          TableColumn("Key") { r in Text(r.key ?? "未带 key").font(.ui(12)).lineLimit(1).foregroundStyle(r.key == nil ? .secondary : .primary) }
            .width(min: 70, ideal: 110)
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
    .frame(minWidth: 760, minHeight: 320)
    .task {
      while !Task.isCancelled {
        let now = store.recentRequests()
        if now != records { records = now }
        try? await Task.sleep(for: .seconds(1))
      }
    }
  }
}

/// Which gateway: 公司 / 其他 / 两边 (the merged model list) / 未转发 (turned away here).
private struct GatewayTag: View {
  let gateway: RequestRecord.Gateway

  var body: some View {
    let (text, color): (String, Color) = switch gateway {
    case .company: ("公司", .blue)
    case .other: ("其他", .purple)
    case .both: ("两边", .gray)
    case .refused: ("未转发", .orange)
    }
    Text(text)
      .font(.ui(11, .medium))
      .padding(.horizontal, 7)
      .padding(.vertical, 2)
      .background(color.opacity(0.14), in: Capsule())
      .foregroundStyle(color)
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
