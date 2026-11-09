// Settings: the usage API, how often to refresh, the people (keys are added by pasting; names
// come by themselves), and where Claude Code's settings are.
import AppKit
import QuotaCore
import ServiceManagement
import SwiftUI

struct SettingsView: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  /// On a page of its own (not over the dashboard): what 完成 does.
  private let done: (() -> Void)?

  init(done: (() -> Void)? = nil) { self.done = done }
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
          header("公司网关")
        }
        Section {
          OtherGatewayRows()
        } header: {
          header("其他网关")
        } footer: {
          footer("两个网关的模型合在一起供 Claude Code 和 Desktop 选择, 用哪个模型就发给哪个网关; 用量只看公司网关")
        }
        Section {
          ModelMapRows()
        } header: {
          header("模型映射")
        } footer: {
          footer("Desktop 只显示它认识的 Claude 模型: 在这里让其中一个代表别的模型. 只改请求里的模型名, 其余不变; Desktop 里显示的还是原名. 模型名以请求记录的「模型」列为准")
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
          HStack {
            label("改动后重启 Desktop")
            Spacer()
            Segmented(selection: Binding(get: { store.config.desktopRestart }, set: { store.setDesktopRestart($0) }),
                      options: DesktopRestart.allCases.map { ($0, $0.label) })
          }
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
          HStack {
            label("菜单栏")
            Spacer()
            Segmented(selection: Binding(get: { store.config.barStyle }, set: { store.setBarStyle($0) }),
                      options: BarStyle.allCases.map { ($0, $0.label) })
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
          footer("留空自动识别; Claude Code 读 settings.json, Desktop 读 configLibrary")
        }
      }
      .formStyle(.grouped)
      .toggleStyle(BlueSwitch())
      .animation(.snappy, value: store.people.map(\.id))
      Divider()
      HStack {
        NoticeBanner()
        Spacer()
        Button { if let done { done() } else { dismiss() } } label: { Text("完成").font(.ui(13, .medium)).padding(.horizontal, 6) }
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
        row("本地转发", info: "Desktop 不支持非本机 HTTP 接口, 开启后经本地代理转发",
            isOn: Binding(get: { on }, set: { store.setForward($0) }),
            disabled: store.forwardState == .starting || store.config.swapKeys)
      }
      row("免重启切换", info: "由本地转发换上选中的 key, 切换时 Desktop 不用重启", show: CommandLine.arguments.contains("--show-tip"),
          isOn: Binding(get: { store.config.swapKeys && on }, set: { store.setSwapKeys($0) }),
          disabled: store.forwardState == .starting || store.people.allSatisfy(\.key.isEmpty))
      switch store.forwardState {
      case .on where store.desktopOffForwarder != nil:
        HStack(spacing: 8) {
          Label { Text("Desktop 未经本地转发 (当前: \(store.desktopOffForwarder ?? ""))") } icon: { Icon(.warning, size: 11) }
            .foregroundStyle(.orange)
          Button("改为本地转发") { store.pointDesktopAtForwarder() }
            .buttonStyle(.link)
        }
        .font(.ui(11))
      case .on(let u) where store.desktopOnOldAddress:
        // Not green: Desktop doesn't go through it yet (the row above has the restart).
        Text("已启用 · " + u.replacingOccurrences(of: "http://", with: "") + " · Desktop 重启后经此访问")
          .font(.ui(11))
          .foregroundStyle(.secondary)
      case .on(let u):
        HStack(spacing: 8) {
          Label { Text("已启用 · " + u.replacingOccurrences(of: "http://", with: "")) } icon: { Icon(.checkFilled, size: 11) }
            .foregroundStyle(.green)
          Button("请求记录") { Windows.show(.requests, store) }
            .buttonStyle(.link)
          Button("日志") { NSWorkspace.shared.open(ForwardLog.url) }
            .buttonStyle(.link)
            .help(ForwardLog.url.path)
        }
        .font(.ui(11))
      case .failed(let why):
        Label { Text("启动失败: " + why + (store.forwardWanted ? ", 会自动重试" : "")) } icon: { Icon(.warning, size: 11) }
          .foregroundStyle(.orange)
          .font(.ui(11))
          .textSelection(.enabled)
      case .starting, .off:
        EmptyView()
      }
    }
    .animation(.snappy, value: store.forwardState)
  }

  /// The name, an ⓘ that explains it on hover, a spinner while the forwarder starts, and the
  /// switch. The ⓘ is beside the switch, not in its label: a disabled switch takes the hover
  /// from its label too.
  private func row(_ name: String, info: String, show: Bool = false, isOn: Binding<Bool>, disabled: Bool) -> some View {
    HStack(spacing: 5) {
      Text(name).font(.ui(13)).foregroundStyle(disabled ? .secondary : .primary)
      InfoTip(text: info, showAtStart: show)
      if store.forwardState == .starting && (name == "本地转发" || !needed) { ProgressView().controlSize(.mini) }
      Spacer()
      Toggle(isOn: isOn) { EmptyView() }
        .fixedSize()
        .disabled(disabled)
    }
  }

  private var on: Bool {
    if case .on = store.forwardState { return true }
    return false
  }
}

/// Another gateway beside the company's: its address and key, and what it lists. Saved as typed.
/// Set, Claude Code and Desktop go through the forwarder, which sends the requests for its models
/// to it.
private struct OtherGatewayRows: View {
  @Environment(Store.self) private var store
  @State private var url = ""
  @State private var key = ""

  var body: some View {
    Group {
      TextField(text: $url, prompt: Text("留空不用")) { Text("模型接口").font(.ui(13)) }
        .font(.mono(12.5))
      SecureField(text: $key, prompt: Text("Bearer key")) { Text("Key").font(.ui(13)) }
        .font(.mono(12.5))
      status
    }
    .onAppear {
      url = store.config.otherURL
      key = store.config.otherKey
    }
    .task(id: url + "\n" + key) {
      try? await Task.sleep(for: .milliseconds(600))
      if !Task.isCancelled { save() }
    }
    .onDisappear { save() }
    .animation(.snappy, value: store.gatewayModels)
  }

  /// One line: what is missing, what went wrong, or how many models it adds.
  @ViewBuilder private var status: some View {
    let m = store.gatewayModels
    let u = url.trimmingCharacters(in: .whitespaces), k = key.trimmingCharacters(in: .whitespaces)
    if u.isEmpty && k.isEmpty {
      EmptyView()
    } else if !Store.usable(u) {
      line("地址需以 http:// 或 https:// 开头", bad: true)
    } else if k.isEmpty {
      line("还需要 key", bad: true)
    } else if !m.conflicts.isEmpty {
      line("两边都有: " + m.conflicts.joined(separator: ", ") + ", 用这些模型会报错", bad: true)
    } else if let e = m.error {
      line(e, bad: true)
    } else if let models = m.other {
      HStack(spacing: 8) {
        line("已加入 \(models.count) 个模型", bad: false)
          .help(models.joined(separator: "\n"))
        Button("请求记录") { Windows.show(.requests, store) }
          .buttonStyle(.link)
          .font(.ui(11))
      }
    } else {
      HStack(spacing: 6) {
        ProgressView().controlSize(.mini)
        Text("读取模型列表...").font(.ui(11)).foregroundStyle(.secondary)
      }
    }
  }

  private func line(_ s: String, bad: Bool) -> some View {
    Label { Text(s) } icon: { Icon(bad ? .warning : .checkFilled, size: 11) }
      .foregroundStyle(bad ? .orange : .green)
      .font(.ui(11))
      .textSelection(.enabled)
  }

  private func save() {
    guard url != store.config.otherURL || key != store.config.otherKey else { return }
    store.saveOtherGateway(url: url, key: key)
  }
}

/// The model mappings: each a model asked for → a gateway and the model it is sent on as. Saved as
/// edited.
private struct ModelMapRows: View {
  @Environment(Store.self) private var store
  @State private var rows: [ModelMapping] = []

  var body: some View {
    Group {
      ForEach($rows) { $r in
        HStack(spacing: 6) {
          ModelField(text: $r.from, prompt: "Desktop 里的模型", choices: store.gatewayModels.company ?? [])
          Text("→").font(.ui(13)).foregroundStyle(.secondary)
          Segmented(selection: $r.toOther, options: [(false, "公司"), (true, "其他")])
            .fixedSize()
          ModelField(text: $r.to, prompt: "发出的模型", choices: (r.toOther ? store.gatewayModels.other : store.gatewayModels.company) ?? [])
          Button { rows.removeAll { $0.id == r.id } } label: { Icon(.trash, size: 12) }
            .buttonStyle(.borderless)
            .help("删除这条映射")
        }
      }
      HStack {
        Button { rows.append(ModelMapping()) } label: { HStack(spacing: 4) { Icon(.plus, size: 11); Text("添加映射") } }
          .buttonStyle(.borderless)
          .font(.ui(12))
        Spacer()
        if rows.contains(where: { $0.toOther }) && store.otherGateway == nil {
          Label { Text("映射到其他网关的, 要先填其他网关") } icon: { Icon(.warning, size: 11) }
            .foregroundStyle(.orange)
            .font(.ui(11))
        }
      }
    }
    .onAppear { rows = store.config.modelMap }
    .onChange(of: rows) { store.saveModelMap(rows) }
  }
}

/// A model name: typed, or picked from a gateway's list (the menu beside it).
private struct ModelField: View {
  @Binding var text: String
  let prompt: String
  let choices: [String]

  var body: some View {
    HStack(spacing: 2) {
      TextField("", text: $text, prompt: Text(prompt))
        .textFieldStyle(.roundedBorder)
        .font(.mono(12))
      Menu {
        if choices.isEmpty { Text("还没有读到这个网关的模型列表") }
        ForEach(choices, id: \.self) { m in Button(m) { text = m } }
      } label: { Image(systemName: "chevron.up.chevron.down").font(.system(size: 10)) }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("从模型列表里选")
    }
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
      self.error = "未能更改: " + error.localizedDescription
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
        Segmented(selection: Binding(get: { store.config.cookieBrowser }, set: { store.setCookieBrowser($0) }),
                  options: ChromeCookies.all.map { ($0.name, $0.name) })
      }
      HStack {
        if store.cookieSyncing {
          ProgressView().controlSize(.small)
          Text("正在读取...").font(.ui(11)).foregroundStyle(.secondary)
        } else {
          Text("每 10 分钟自动同步").font(.ui(11)).foregroundStyle(.secondary)
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
    if !store.desktopLacks.isEmpty { PendingRow(lacks: store.desktopLacks) }
    if store.desktopMode == .managed {
      LabeledContent { Text("由公司管理").font(.ui(12)).foregroundStyle(.secondary) } label: { Text("启动方式").font(.ui(13)) }
    } else {
      VStack(alignment: .leading, spacing: 5) {
        HStack {
          Text("启动方式").font(.ui(13))
          Spacer()
          Segmented(selection: Binding(get: { gateway }, set: { if $0 != gateway { store.setDesktopMode(gateway: $0) } }),
                    options: [(true, "第三方网关"), (false, "官方登录")])
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

/// What the running Desktop lacks of its configuration now (it read it at launch): what, and the
/// restart. Gone as soon as they match again (the change undone, Desktop restarted or quit).
private struct PendingRow: View {
  @Environment(Store.self) private var store
  let lacks: [String]

  var body: some View {
    HStack(alignment: .center, spacing: 10) {
      Circle().fill(.orange).frame(width: 7, height: 7)
      VStack(alignment: .leading, spacing: 2) {
        Text("有改动待 Desktop 重启后生效").font(.ui(12.5, .medium))
        Text(lacks.joined(separator: "; ")).font(.ui(11)).foregroundStyle(.secondary).lineLimit(2)
      }
      Spacer(minLength: 8)
      if store.restartingDesktop {
        ProgressView().controlSize(.small)
      } else {
        Button { store.restartDesktop() } label: { Text("重启 Desktop").font(.ui(12)) }
      }
    }
    .padding(.vertical, 2)
    .transition(.opacity)
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
          Text("检查中...").foregroundStyle(.secondary)
        case .upToDate:
          Text("已是最新").foregroundStyle(.secondary)
        case .available(let n, let subject):
          Text("有 \(n) 处新改动" + (subject.map { ": " + $0 } ?? "")).foregroundStyle(.blue).lineLimit(2)
        case .installing:
          Text("正在编译安装, 约 1 分钟, 完成后自动重开").foregroundStyle(.secondary)
        case .failed(let why):
          HStack(spacing: 8) {
            Text(why).foregroundStyle(.orange)
            if FileManager.default.fileExists(atPath: Updater.log.path) {
              Button("日志") { NSWorkspace.shared.open(Updater.log) }.buttonStyle(.link)
            }
          }
        case .unavailable:
          Text("非 build.sh 从 git 目录编译, 不能自动更新").foregroundStyle(.secondary)
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

