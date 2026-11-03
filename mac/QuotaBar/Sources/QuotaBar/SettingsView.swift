// Settings: the usage API, how often to refresh, the people (keys are added by pasting; names
// come by themselves), and where Claude Code's settings are.
import QuotaCore
import SwiftUI

struct SettingsView: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Bindable private var text = TextSize.shared
  @State private var url = ""
  @State private var baseURL = ""
  @State private var interval = 60
  @State private var settingsPath = ""

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section {
          TextField(text: $baseURL, prompt: Text(Config.defaultBaseURL)) { label("模型接口") }
            .font(.mono(12.5))
          TextField(text: $url, prompt: Text(Config.defaultURL)) { label("用量接口") }
            .font(.mono(12.5))
          Stepper(value: $interval, in: 10...3600, step: 10) {
            LabeledContent { Text("\(interval) 秒").font(.ui(13)).monospacedDigit() } label: { label("刷新间隔") }
          }
          if !url.isEmpty && !valid(url) || !baseURL.isEmpty && !valid(baseURL) {
            Text("地址需以 http:// 或 https:// 开头").foregroundStyle(.orange).font(.ui(11.5))
          }
        } header: {
          header("接口")
        } footer: {
          footer("切换 key 时，Claude Code 或 Desktop 用的不是「模型接口」会先问你。")
        }
        Section {
          ForEach(store.people) { p in
            PersonKeyRow(p: p).transition(.opacity)
          }
          AddKeyField()
        } header: {
          header("人员")
        } footer: {
          footer("粘贴 key 自动识别是谁；同一人的新 key 替换旧的。")
        }
        Section {
          TextField(text: $settingsPath) { label("Claude Code 配置") }
            .font(.mono(12.5))
          Picker(selection: Binding(get: { store.config.desktopRestart }, set: { store.setDesktopRestart($0) })) {
            ForEach(DesktopRestart.allCases, id: \.self) { Text($0.label).font(.ui(13)) }
          } label: { label("换 key 后重启 Desktop") }
        } header: {
          header("切换")
        } footer: {
          footer("改 Claude Code 的 env.ANTHROPIC_AUTH_TOKEN 和 Desktop 网关的 key，原文件留 .bak。")
        }
        Section {
          Stepper(value: $text.bump, in: TextSize.range, step: 0.5) {
            LabeledContent { Text(text.label).font(.ui(13)).monospacedDigit() } label: { label("字号") }
          }
        } header: {
          header("显示")
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
    .frame(width: 600, height: 640)
    .onAppear {
      url = store.config.url
      baseURL = store.config.baseURL
      interval = store.config.interval
      settingsPath = store.config.settingsPath
    }
    // Saved as typed (once typing pauses): no separate save step.
    .task(id: "\(url)\n\(baseURL)\n\(interval)\n\(settingsPath)") {
      try? await Task.sleep(for: .milliseconds(600))
      if !Task.isCancelled { save() }
    }
    .onDisappear { save() }
  }

  private func label(_ s: String) -> some View { Text(s).font(.ui(13)) }
  private func header(_ s: String) -> some View { Text(s).font(.ui(12, .semibold)) }
  private func footer(_ s: String) -> some View { Text(s).font(.ui(11)).foregroundStyle(.secondary) }

  private func save() {
    let c = store.config
    guard url != c.url || baseURL != c.baseURL || interval != c.interval || settingsPath != c.settingsPath else { return }
    store.saveSettings(url: url, baseURL: baseURL, interval: interval, settingsPath: settingsPath)
  }

  private func valid(_ s: String) -> Bool {
    guard let u = URL(string: s.trimmingCharacters(in: .whitespaces)) else { return false }
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
