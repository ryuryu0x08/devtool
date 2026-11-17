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
        GatewaySections()
        Section {
          ModelMapRows()
        } header: {
          header("模型映射")
        } footer: {
          footer("Desktop 只显示它认识的 Claude 模型: 在这里让其中一个代表别的模型. 只改请求里的模型名, 其余不变; Desktop 里显示的还是原名. 模型名以请求记录的「模型」列为准. 同一个模型映射了多条时, 最上面的生效")
        }
        Section {
          FallbackRows()
        } header: {
          header("额度用尽时")
        } footer: {
          footer("看板读到当前 key 额度已用完 (或公司网关回 403, 如部门额度用尽) 时, 请求换成所选模型发给所选网关; 读数显示额度恢复后自动切回. 换网关后原来的提示词缓存用不上")
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

/// The gateways besides the company's, one section each, in order (moved up and down, removed),
/// and adding one (blank, or DeepSeek's). Saved as typed. With one set, Claude Code and Desktop go
/// through the forwarder, which sends each request to the first gateway that lists its model.
private struct GatewaySections: View {
  @Environment(Store.self) private var store
  @State private var rows: [GatewayConfig] = []
  @State private var loaded = false

  var body: some View {
    Group {
      ForEach($rows) { $g in
        let i = rows.firstIndex { $0.id == g.id } ?? 0
        Section {
          GatewayRows(g: $g)
        } header: {
          HStack(spacing: 10) {
            Text("其他网关 \(i + 1) · \(g.label)").font(.ui(12, .semibold))
            Spacer()
            Button { move(g.id, by: -1) } label: { Image(systemName: "arrow.up").font(.system(size: 10)) }
              .disabled(i == 0)
              .help("往前移: 同名模型优先发给前面的网关")
            Button { move(g.id, by: 1) } label: { Image(systemName: "arrow.down").font(.system(size: 10)) }
              .disabled(i == rows.count - 1)
              .help("往后移")
            Button { let id = g.id; rows.removeAll { $0.id == id } } label: { Icon(.trash, size: 11) }
              .help("删除这个网关")
          }
          .buttonStyle(.borderless)
        }
      }
      Section {
        HStack(spacing: 14) {
          Button { rows.append(GatewayConfig()) } label: { HStack(spacing: 4) { Icon(.plus, size: 11); Text("添加网关") } }
          Button { rows.append(GatewayConfig(name: "DeepSeek", url: "https://api.deepseek.com/anthropic")) } label: { HStack(spacing: 4) { Icon(.plus, size: 11); Text("DeepSeek 官方") } }
            .help("填好 DeepSeek 官方的 Anthropic 兼容地址, 再填 key")
          Spacer()
        }
        .buttonStyle(.borderless)
        .font(.ui(12))
      } header: {
        if rows.isEmpty { Text("其他网关").font(.ui(12, .semibold)) }
      } footer: {
        Text("各网关的模型合在一起供 Claude Code 和 Desktop 选择, 用哪个模型就发给哪个网关: 公司网关优先, 其余从上到下, 同名模型发给最前面的那个. 用量只看公司网关")
          .font(.ui(11)).foregroundStyle(.secondary)
      }
    }
    .onAppear {
      guard !loaded else { return }
      rows = store.config.gateways
      loaded = true
    }
    .task(id: rows) {
      try? await Task.sleep(for: .milliseconds(600))
      if !Task.isCancelled && loaded { store.saveGateways(rows) }
    }
    .onDisappear { if loaded { store.saveGateways(rows) } }
    .animation(.snappy, value: store.gatewayModels)
  }

  private func move(_ id: String, by d: Int) {
    guard let i = rows.firstIndex(where: { $0.id == id }), rows.indices.contains(i + d) else { return }
    rows.swapAt(i, i + d)
  }
}

/// One gateway: its name, address, key, models typed in, and one line on what it adds.
private struct GatewayRows: View {
  @Environment(Store.self) private var store
  @Binding var g: GatewayConfig

  var body: some View {
    TextField(text: $g.name, prompt: Text("如 DeepSeek")) { Text("名称").font(.ui(13)) }
      .font(.ui(12.5))
    TextField(text: $g.url, prompt: Text("https://...")) { Text("模型接口").font(.ui(13)) }
      .font(.mono(12.5))
    SecureField(text: $g.key, prompt: Text("Bearer key")) { Text("Key").font(.ui(13)) }
      .font(.mono(12.5))
    TextField(text: $g.models, prompt: Text("可不填; 读不到列表时手动填, 逗号分隔")) { Text("模型").font(.ui(13)) }
      .font(.mono(12.5))
      .help("这个网关的模型名, 加在它的模型列表之后 (读不到列表的网关, 比如 DeepSeek 官方, 就靠这里)")
    status
  }

  /// One line: what is missing, what went wrong, or how many models it adds.
  @ViewBuilder private var status: some View {
    let m = store.gatewayModels
    let u = g.url.trimmingCharacters(in: .whitespaces), k = g.key.trimmingCharacters(in: .whitespaces)
    if u.isEmpty && k.isEmpty {
      EmptyView()
    } else if !Store.usable(u) {
      line("地址需以 http:// 或 https:// 开头", bad: true)
    } else if k.isEmpty {
      line("还需要 key", bad: true)
    } else if let models = m.lists[g.id] {
      let taken = store.taken(from: g.id)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 8) {
          line("已加入 \(models.count - taken.count) 个模型", bad: false)
            .help(models.filter { !taken.contains($0) }.joined(separator: "\n"))
          Button("请求记录") { Windows.show(.requests, store) }
            .buttonStyle(.link)
            .font(.ui(11))
        }
        if !taken.isEmpty {
          line("\(taken.count) 个模型前面的网关也有, 发给前面的: " + taken.prefix(3).joined(separator: ", ") + (taken.count > 3 ? " 等" : ""), bad: true)
            .help(taken.joined(separator: "\n"))
        }
        if let e = m.errors[g.id] { line(e, bad: true) }
      }
    } else if let e = m.errors[g.id] {
      line(e, bad: true)
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
}

/// Which gateway: the company's ("") or another, by its id; a menu of their names.
private struct GatewayPicker: View {
  @Environment(Store.self) private var store
  @Binding var id: String
  var company = true

  var body: some View {
    let gws = store.config.gateways
    Picker("网关", selection: $id) {
      if company { Text("公司").tag("") }
      ForEach(gws) { g in Text(g.label).tag(g.id) }
      if !id.isEmpty && !gws.contains(where: { $0.id == id }) { Text("已删除的网关").tag(id) }
    }
    .labelsHidden()
    .pickerStyle(.menu)
    .fixedSize()
  }
}

/// The model mappings: each a model asked for → a gateway and the model it is sent on as. Saved as
/// edited.
private struct ModelMapRows: View {
  @Environment(Store.self) private var store
  @State private var rows: [ModelMapping] = []

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if !rows.isEmpty {
        // One grid for all rows: the columns line up from row to row.
        Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 8) {
          GridRow {
            heading("Desktop 里的模型")
            Color.clear.frame(width: 1, height: 1)
            heading("网关")
            heading("发出的模型")
            Color.clear.frame(width: 1, height: 1)
          }
          ForEach($rows) { $r in
            GridRow(alignment: .center) {
              ModelField(text: $r.from, prompt: "填 Desktop 用的模型名", groups: Array(store.modelGroups(company: true).prefix(1)))
              Text("→").font(.ui(13)).foregroundStyle(.secondary)
              GatewayPicker(id: Binding(get: { $r.wrappedValue.gateway ?? "" }, set: { $r.wrappedValue.gateway = $0.isEmpty ? nil : $0 }))
              ModelField(text: $r.to, prompt: "选择或输入", groups: store.modelGroups(company: true)) { id in $r.wrappedValue.gateway = id.isEmpty ? nil : id }
              Button { rows.removeAll { $0.id == r.id } } label: { Icon(.trash, size: 12) }
                .buttonStyle(.borderless)
                .help("删除这条映射")
            }
          }
        }
      }
      HStack {
        Button { var m = ModelMapping(); m.gateway = store.config.gateways.first?.id; rows.append(m) } label: { HStack(spacing: 4) { Icon(.plus, size: 11); Text("添加映射") } }
          .buttonStyle(.borderless)
          .font(.ui(12))
        Spacer()
      }
      ForEach(problems, id: \.self) { p in
        Label { Text(p) } icon: { Icon(.warning, size: 11) }
          .foregroundStyle(.orange)
          .font(.ui(11))
      }
    }
    .onAppear { rows = store.config.modelMap }
    .onChange(of: rows) { store.saveModelMap(rows) }
  }

  private func heading(_ s: String) -> some View {
    Text(s).font(.ui(11)).foregroundStyle(.secondary)
  }

  /// What keeps a mapping from being used: not filled in, its gateway gone, or one above for the same model.
  private var problems: [String] {
    var out: [String] = []
    var seen = Set<String>()
    let ids = Set(store.config.gateways.map(\.id))
    for (i, r) in rows.enumerated() {
      let from = r.from.trimmingCharacters(in: .whitespaces)
      if !r.complete {
        out.append("第 \(i + 1) 条" + (from.isEmpty ? "左边" : "右边") + "没填 (或两边一样), 不生效")
      } else if let g = r.gateway, !ids.contains(g) {
        out.append("第 \(i + 1) 条的网关已删除, 不生效")
      } else if !seen.insert(from).inserted {
        out.append("第 \(i + 1) 条: \(from) 上面已经映射过, 这条不生效")
      }
    }
    return out
  }
}

/// The models of one gateway ("" the company's), for a model menu.
struct ModelGroup: Identifiable {
  var id: String
  var name: String
  var models: [String]
}

extension Store {
  /// Each gateway's models as last read, for the model menus: the company's first (with
  /// `company`), then the others in their order; each one's sorted by name ("v4.2" before "v4.10").
  func modelGroups(company: Bool) -> [ModelGroup] {
    let sort = { (m: [String]) in m.sorted { $0.localizedStandardCompare($1) == .orderedAscending } }
    var out: [ModelGroup] = []
    if company { out.append(ModelGroup(id: "", name: "公司", models: sort(gatewayModels.company ?? []))) }
    for g in config.gateways { out.append(ModelGroup(id: g.id, name: g.label, models: sort(gatewayModels.lists[g.id] ?? []))) }
    return out
  }
}

/// A model name: typed, or picked from the gateways' lists (the menu beside it, a section for
/// each gateway, in the same order every time). Picking one from a gateway also picks that
/// gateway (`onPick`). Left-aligned, and as wide as its column.
private struct ModelField: View {
  @Binding var text: String
  let prompt: String
  let groups: [ModelGroup]
  var onPick: ((String) -> Void)?

  var body: some View {
    HStack(spacing: 4) {
      TextField(prompt, text: $text, prompt: Text(prompt))
        .labelsHidden()
        .textFieldStyle(.roundedBorder)
        .multilineTextAlignment(.leading)
        .font(.mono(12))
      Menu {
        if groups.allSatisfy({ $0.models.isEmpty }) { Text("还没有读到模型列表") }
        ForEach(groups) { g in
          if groups.count == 1 {
            ForEach(g.models, id: \.self) { m in Button(m) { text = m } }
          } else {
            Section(g.name + (g.models.isEmpty ? " · 没读到列表" : "")) {
              ForEach(g.models, id: \.self) { m in
                Button(m) {
                  text = m
                  onPick?(g.id)
                }
              }
            }
          }
        }
      } label: { Image(systemName: "chevron.up.chevron.down").font(.system(size: 10)) }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("从模型列表里选 (按网关分组, 组内按名称排序)")
    }
    .frame(minWidth: 150, maxWidth: .infinity)
  }
}

/// Falling back to another gateway when the company's quota is used up: on or off, the gateway
/// and model, and whether it is falling back now. Saved as set.
private struct FallbackRows: View {
  @Environment(Store.self) private var store
  @State private var on = false
  @State private var gateway = ""
  @State private var model = ""

  var body: some View {
    Group {
      HStack {
        Text("自动改用其他网关").font(.ui(13))
        Spacer()
        Toggle(isOn: $on) { EmptyView() }
          .fixedSize()
      }
      HStack(spacing: 8) {
        Text("改用").font(.ui(13)).foregroundStyle(on ? .primary : .secondary)
        GatewayPicker(id: $gateway, company: false)
          .disabled(!on)
        ModelField(text: $model, prompt: "选择或输入模型", groups: store.modelGroups(company: false)) { gateway = $0 }
          .disabled(!on)
      }

      if on && store.config.gateways.isEmpty {
        status("要先添加其他网关", bad: true)
      } else if on && !store.otherGateways.contains(where: { $0.id == gateway }) {
        status("还需要选一个填好地址和 key 的网关", bad: true)
      } else if on && model.trimmingCharacters(in: .whitespaces).isEmpty {
        status("还需要选一个模型", bad: true)
      } else if let why = store.fallingBack, let m = store.fallbackLabel {
        status("降级中: \(why), 改用 \(m); 额度恢复后自动切回", bad: true)
      }
    }
    .onAppear {
      on = store.config.autoFallback
      gateway = store.config.fallbackGateway
      if !store.config.gateways.contains(where: { $0.id == gateway }), let first = store.config.gateways.first { gateway = first.id }
      model = store.config.fallbackModel
    }
    .onChange(of: on) { save() }
    .onChange(of: gateway) { save() }
    .onChange(of: model) { save() }
    .animation(.snappy, value: store.fallingBack)
  }

  private func save() { store.setFallback(on: on, gateway: gateway, model: model) }

  private func status(_ s: String, bad: Bool) -> some View {
    Label { Text(s) } icon: { Icon(bad ? .warning : .checkFilled, size: 11) }
      .foregroundStyle(bad ? .orange : .green)
      .font(.ui(11))
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

