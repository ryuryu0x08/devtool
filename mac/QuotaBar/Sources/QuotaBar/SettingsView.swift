// Settings: the usage API, how often to refresh, the people (keys are added by pasting; names
// come by themselves), and where Claude Code's settings are.
import QuotaCore
import SwiftUI

struct SettingsView: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var url = ""
  @State private var interval = 60
  @State private var settingsPath = ""

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section {
          TextField(text: $url, prompt: Text(Config.defaultURL)) { Text("地址").font(.ui(13)) }
            .font(.mono(12.5))
          Stepper(value: $interval, in: 10...3600, step: 10) {
            LabeledContent { Text("\(interval) 秒").font(.ui(13)).monospacedDigit() } label: { Text("刷新间隔").font(.ui(13)) }
          }
          if !url.isEmpty && !validURL {
            Text("地址要以 http:// 或 https:// 开头").foregroundStyle(.orange).font(.ui(11.5))
          }
        } header: {
          Text("用量接口").font(.ui(12, .semibold))
        }
        Section {
          ForEach(store.people) { p in
            PersonKeyRow(p: p).transition(.opacity)
          }
          AddKeyField()
        } header: {
          Text("人员").font(.ui(12, .semibold))
        } footer: {
          Text("粘贴 key 后自动识别是谁的；同一个人的新 key 会替换旧的。保存在本机 ~/Library/Application Support/QuotaBar，只有你的账户能读。")
            .font(.ui(11)).foregroundStyle(.secondary)
        }
        Section {
          TextField(text: $settingsPath) { Text("settings.json").font(.ui(13)) }
            .font(.mono(12.5))
        } header: {
          Text("Claude Code 配置文件").font(.ui(12, .semibold))
        } footer: {
          Text("「用于 Claude Code」把这个文件里的 env.ANTHROPIC_AUTH_TOKEN 换成所选的 key，并删除 env.ANTHROPIC_API_KEY；其他内容保持原样。修改前的内容保存在同目录的 .bak 文件。")
            .font(.ui(11)).foregroundStyle(.secondary)
        }
      }
      .formStyle(.grouped)
      .animation(.snappy, value: store.people.map(\.id))
      Divider()
      HStack {
        NoticeBanner()
        Spacer()
        Button { dismiss() } label: { Text("完成").font(.ui(13, .medium)).padding(.horizontal, 6) }
          .keyboardShortcut(.defaultAction)
          .buttonStyle(.borderedProminent)
      }
      .padding(14)
      .animation(.snappy, value: store.notice)
    }
    .frame(width: 580, height: 580)
    .onAppear {
      url = store.config.url
      interval = store.config.interval
      settingsPath = store.config.settingsPath
    }
    // Saved as typed (once typing pauses): no separate save step.
    .task(id: "\(url)\n\(interval)\n\(settingsPath)") {
      try? await Task.sleep(for: .milliseconds(600))
      if !Task.isCancelled { save() }
    }
    .onDisappear { save() }
  }

  private func save() {
    guard url != store.config.url || interval != store.config.interval || settingsPath != store.config.settingsPath else { return }
    store.saveSettings(url: url, interval: interval, settingsPath: settingsPath)
  }

  private var validURL: Bool {
    guard let u = URL(string: url.trimmingCharacters(in: .whitespaces)) else { return false }
    return ["http", "https"].contains(u.scheme?.lowercased() ?? "") && u.host != nil
  }
}

/// A person in the settings: the name, and the whole key, to read, select or copy.
private struct PersonKeyRow: View {
  @Environment(Store.self) private var store
  let p: Person
  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text(p.label).font(p.name == nil ? .mono(13) : .serif(14, .semibold))
        Spacer()
        if !p.key.isEmpty {
          Button {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(p.key, forType: .string)
            withAnimation(.snappy) { copied = true }
          } label: { Icon(copied ? .check : .copy, size: 12) }
            .buttonStyle(.borderless)
            .help("复制 key")
            .task(id: copied) {
              guard copied else { return }
              try? await Task.sleep(for: .seconds(1.5))
              withAnimation(.snappy) { copied = false }
            }
        }
        Button(role: .destructive) { withAnimation(.snappy) { store.remove(p) } } label: { Icon(.trash, size: 12) }
          .buttonStyle(.borderless)
          .foregroundStyle(.red)
          .help("删除")
      }
      Text(p.key.isEmpty ? "等待新 key" : p.key)
        .font(.mono(11.5))
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
        .lineLimit(2)
        .truncationMode(.middle)
    }
    .padding(.vertical, 2)
  }
}
