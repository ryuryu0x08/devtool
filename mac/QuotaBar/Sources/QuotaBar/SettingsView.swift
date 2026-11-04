// Settings: the usage API, how often to refresh, the people (keys are added by pasting; names
// come by themselves), and where Claude Code's settings are.
import AppKit
import QuotaCore
import ServiceManagement
import SwiftUI

struct SettingsView: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Bindable private var text = TextSize.shared
  @State private var url = ""
  @State private var baseURL = ""
  @State private var interval = 60
  @State private var claudeDir = ""
  @State private var desktopDir = ""

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section {
          TextField(text: $baseURL, prompt: Text(Config.defaultBaseURL)) { label("模型接口") }
            .font(.mono(12.5))
          if LocalForwarder.needed(for: baseURL.isEmpty ? Config.defaultBaseURL : baseURL) {
            ForwardRow()
          }
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
          Picker(selection: Binding(get: { store.config.desktopRestart }, set: { store.setDesktopRestart($0) })) {
            ForEach(DesktopRestart.allCases, id: \.self) { Text($0.label).font(.ui(13)) }
          } label: { label("换 key 后重启 Desktop") }
        } header: {
          header("切换")
        } footer: {
          footer("改 Claude Code 的 env.ANTHROPIC_AUTH_TOKEN 和 Desktop 网关的 key，原文件留 .bak。")
        }
        Section {
          LoginItemRow()
        } header: {
          header("通用")
        }
        Section {
          Stepper(value: $text.bump, in: TextSize.range, step: 0.5) {
            LabeledContent { Text(text.label).font(.ui(13)).monospacedDigit() } label: { label("字号") }
          }
        } header: {
          header("显示")
        }
        Section {
          TextField(text: $claudeDir, prompt: Text(Config.detectedClaudeDir)) { label("Claude Code") }
            .font(.mono(12.5))
          TextField(text: $desktopDir, prompt: Text(Config.detectedDesktopDir)) { label("Desktop") }
            .font(.mono(12.5))
        } header: {
          header("目录")
        } footer: {
          footer("留空即自动识别。Claude Code 读其中的 settings.json，Desktop 读 configLibrary。")
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
      claudeDir = store.config.claudeDir
      desktopDir = store.config.desktopDir
    }
    // Saved as typed (once typing pauses): no separate save step.
    .task(id: "\(url)\n\(baseURL)\n\(interval)\n\(claudeDir)\n\(desktopDir)") {
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
    guard url != c.url || baseURL != c.baseURL || interval != c.interval || claudeDir != c.claudeDir || desktopDir != c.desktopDir else { return }
    store.saveSettings(url: url, baseURL: baseURL, interval: interval, claudeDir: claudeDir, desktopDir: desktopDir)
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

/// Under an http model API: the local forwarder Desktop needs, shown on only once it runs.
private struct ForwardRow: View {
  @Environment(Store.self) private var store

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Toggle(isOn: Binding(get: { on }, set: { store.setForward($0) })) {
        HStack(spacing: 6) {
          Text("本地转发").font(.ui(13))
          if store.forwardState == .starting { ProgressView().controlSize(.mini) }
        }
      }
      .disabled(store.forwardState == .starting)
      Group {
        switch store.forwardState {
        case .on(let u):
          HStack(spacing: 8) {
            Label { Text("已启用：Desktop 经 \(u) 访问，QuotaBar 需保持运行") } icon: { Icon(.checkFilled, size: 11) }
              .foregroundStyle(.green)
            Button("日志") { NSWorkspace.shared.open(ForwardLog.url) }
              .buttonStyle(.link)
              .help(ForwardLog.url.path)
          }
        case .failed(let why):
          Label { Text("启动失败：" + why) } icon: { Icon(.warning, size: 11) }
            .foregroundStyle(.orange)
        case .starting:
          Text("启动中…").foregroundStyle(.secondary)
        case .off:
          Text("Desktop 只认 HTTPS 或本机 HTTP，不开可能用不了").foregroundStyle(.secondary)
        }
      }
      .font(.ui(11))
      .textSelection(.enabled)
    }
    .animation(.snappy, value: store.forwardState)
  }

  private var on: Bool {
    if case .on = store.forwardState { return true }
    return false
  }
}

/// Open QuotaBar when you log in (the forwarder only works while it runs).
private struct LoginItemRow: View {
  @State private var on = SMAppService.mainApp.status == .enabled
  @State private var error: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Toggle(isOn: Binding(get: { on }, set: { set($0) })) { Text("登录时打开").font(.ui(13)) }
      if let error { Text(error).font(.ui(11)).foregroundStyle(.orange) }
    }
  }

  private func set(_ v: Bool) {
    do {
      if v { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
      error = nil
    } catch {
      self.error = "未能更改：" + error.localizedDescription
    }
    on = SMAppService.mainApp.status == .enabled
  }
}
