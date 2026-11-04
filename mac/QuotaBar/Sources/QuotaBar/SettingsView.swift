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
          TextField(text: $url, prompt: Text(Config.defaultURL)) { label("用量接口") }
            .font(.mono(12.5))
          // In a row of its own (label, value, arrows), so that all three sit in the middle.
          HStack {
            label("刷新间隔")
            Spacer()
            Text("\(interval) 秒").font(.ui(13)).monospacedDigit().foregroundStyle(.secondary)
            Stepper("刷新间隔", value: $interval, in: 10...3600, step: 10).labelsHidden()
          }
          if !url.isEmpty && !valid(url) || !baseURL.isEmpty && !valid(baseURL) {
            Text("地址需以 http:// 或 https:// 开头").foregroundStyle(.orange).font(.ui(11.5))
          }
        } header: {
          header("接口")
        }
        Section {
          ForEach(store.people) { p in
            PersonKeyRow(p: p).transition(.opacity)
          }
          AddKeyField()
        } header: {
          header("人员")
        }
        Section {
          CookieSyncRows()
        } header: {
          header("自动获取 key")
        }
        Section {
          DesktopRows()
          ForwardRow(needed: LocalForwarder.needed(for: baseURL.isEmpty ? Config.defaultBaseURL : baseURL))
          Picker(selection: Binding(get: { store.config.desktopRestart }, set: { store.setDesktopRestart($0) })) {
            ForEach(DesktopRestart.allCases, id: \.self) { Text($0.label).font(.ui(13)) }
          } label: { label("改动后重启 Desktop") }
        } header: {
          header("Desktop")
        }
        Section {
          LoginItemRow()
          UpdateRows()
        } header: {
          header("通用")
        }
        Section {
          HStack {
            label("字号")
            Spacer()
            Text(text.label).font(.ui(13)).monospacedDigit().foregroundStyle(.secondary)
            Stepper("字号", value: $text.bump, in: TextSize.range, step: 0.5).labelsHidden()
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
      .toggleStyle(BlueSwitch())
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
      store.readDesktop()
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
  /// The model API is http (not this machine): Desktop can't reach it without the forwarder.
  let needed: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      if needed {
        Toggle(isOn: Binding(get: { on }, set: { store.setForward($0) })) {
          title("本地转发", info: "Desktop 连不上 http 的模型接口，由 QuotaBar 在本机转发即可。")
        }
        .disabled(store.forwardState == .starting || store.config.swapKeys)
      }
      Toggle(isOn: Binding(get: { store.config.swapKeys && on }, set: { store.setSwapKeys($0) })) {
        title("免重启切换", info: "由本地转发换上选中的 key，切换时 Desktop 不用重启。", show: CommandLine.arguments.contains("--show-tip"))
      }
      .disabled(store.forwardState == .starting || store.people.allSatisfy(\.key.isEmpty))
      switch store.forwardState {
      case .on where store.desktopOffForwarder != nil:
        HStack(spacing: 8) {
          Label { Text("Desktop 没有经本地转发（用的是 \(store.desktopOffForwarder ?? "")）") } icon: { Icon(.warning, size: 11) }
            .foregroundStyle(.orange)
          Button("改为本地转发") { store.pointDesktopAtForwarder() }
            .buttonStyle(.link)
        }
        .font(.ui(11))
      case .on(let u) where store.desktopOnOldAddress:
        HStack(spacing: 8) {
          Label { Text("Desktop 还在用旧地址，重启后才经 " + u.replacingOccurrences(of: "http://", with: "")) } icon: { Icon(.warning, size: 11) }
            .foregroundStyle(.orange)
          Button("重启 Desktop") { store.restartDesktop() }
            .buttonStyle(.link)
        }
        .font(.ui(11))
      case .on(let u):
        HStack(spacing: 8) {
          Label { Text("已启用 · " + u.replacingOccurrences(of: "http://", with: "")) } icon: { Icon(.checkFilled, size: 11) }
            .foregroundStyle(.green)
          Button("日志") { NSWorkspace.shared.open(ForwardLog.url) }
            .buttonStyle(.link)
            .help(ForwardLog.url.path)
        }
        .font(.ui(11))
      case .failed(let why):
        Label { Text("启动失败：" + why + (store.forwardWanted ? "，会自动重试" : "")) } icon: { Icon(.warning, size: 11) }
          .foregroundStyle(.orange)
          .font(.ui(11))
          .textSelection(.enabled)
      case .starting, .off:
        EmptyView()
      }
    }
    .animation(.snappy, value: store.forwardState)
  }

  /// The name, an ⓘ that explains it on hover, and a spinner while the forwarder starts.
  private func title(_ name: String, info: String, show: Bool = false) -> some View {
    HStack(spacing: 5) {
      Text(name).font(.ui(13))
      InfoTip(text: info, showAtStart: show)
      if store.forwardState == .starting && (name == "本地转发" || !needed) { ProgressView().controlSize(.mini) }
    }
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

/// Reading the rotating key from the browser's cookies: on/off, which browser, and a sync now.
private struct CookieSyncRows: View {
  @Environment(Store.self) private var store

  var body: some View {
    Toggle(isOn: Binding(get: { store.config.cookieSync }, set: { store.setCookieSync($0) })) {
      Text("从浏览器 cookie 自动更新").font(.ui(13))
    }
    if store.config.cookieSync {
      HStack {
        Text("浏览器").font(.ui(13))
        Spacer()
        Picker("浏览器", selection: Binding(get: { store.config.cookieBrowser }, set: { store.setCookieBrowser($0) })) {
          ForEach(ChromeCookies.all, id: \.name) { Text($0.name).font(.ui(13)).tag($0.name) }
        }
        .labelsHidden()
        .fixedSize()
      }
      HStack {
        if store.cookieSyncing {
          ProgressView().controlSize(.small)
          Text("正在读取…").font(.ui(11)).foregroundStyle(.secondary)
        } else {
          Text("每 10 分钟自动同步一次").font(.ui(11)).foregroundStyle(.secondary)
        }
        Spacer()
        Button { Task { await store.syncFromCookies(interactive: true) } } label: { Text("立即同步").font(.ui(12)) }
          .disabled(store.cookieSyncing)
      }
    }
  }
}

/// Claude Desktop: on the gateway, or at the Anthropic sign-in.
private struct DesktopRows: View {
  @Environment(Store.self) private var store

  var body: some View {
    if store.desktopMode == .managed {
      LabeledContent { Text("由公司管理").font(.ui(12)).foregroundStyle(.secondary) } label: { Text("启动方式").font(.ui(13)) }
    } else {
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          Text("启动方式").font(.ui(13))
          Spacer()
          Picker("启动方式", selection: Binding(get: { gateway }, set: { if $0 != gateway { store.setDesktopMode(gateway: $0) } })) {
            Text("第三方网关").tag(true)
            Text("官方登录").tag(false)
          }
          .pickerStyle(.segmented)
          .labelsHidden()
          .fixedSize()
        }
        if case .gateway(let url) = store.desktopMode, let url {
          Text(url).font(.mono(11)).foregroundStyle(.secondary).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
        }
      }
    }
  }

  private var gateway: Bool {
    if case .gateway = store.desktopMode { return true }
    return false
  }
}

/// The version, the update check, and installing updates by themselves.
private struct UpdateRows: View {
  @Bindable private var u = Updater.shared

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text("版本").font(.ui(13))
        Text(u.version).font(.mono(11.5)).foregroundStyle(.secondary).textSelection(.enabled)
        Spacer()
        switch u.state {
        case .checking, .installing:
          ProgressView().controlSize(.small)
        case .available:
          Button { Task { await u.install() } } label: { Text("更新").font(.ui(12)) }
            .buttonStyle(.borderedProminent)
        case .unavailable:
          EmptyView()
        default:
          Button { Task { await u.check() } } label: { Text("检查更新").font(.ui(12)) }
        }
      }
      Group {
        switch u.state {
        case .idle:
          EmptyView()
        case .checking:
          Text("检查中…").foregroundStyle(.secondary)
        case .upToDate:
          Text("已是最新").foregroundStyle(.secondary)
        case .available(let n, let subject):
          Text("有 \(n) 处新改动" + (subject.map { "：" + $0 } ?? "")).foregroundStyle(.blue).lineLimit(2)
        case .installing:
          Text("正在编译安装，约 1 分钟，完成后自动重开").foregroundStyle(.secondary)
        case .failed(let why):
          HStack(spacing: 8) {
            Text(why).foregroundStyle(.orange)
            if FileManager.default.fileExists(atPath: Updater.log.path) {
              Button("日志") { NSWorkspace.shared.open(Updater.log) }.buttonStyle(.link)
            }
          }
        case .unavailable:
          Text("不是用 build.sh 从 git 目录编译的，不能自动更新").foregroundStyle(.secondary)
        }
      }
      .font(.ui(11))
    }
    .animation(.snappy, value: u.state)
    if u.state != .unavailable {
      Toggle(isOn: $u.auto) { Text("自动更新").font(.ui(13)) }
    }
  }
}

