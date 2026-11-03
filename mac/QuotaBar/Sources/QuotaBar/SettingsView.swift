// Settings: the usage API, how often to refresh, the keys, and where Claude Code's settings are.
import QuotaCore
import SwiftUI

struct SettingsView: View {
  @Environment(Store.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var draft = Config()
  @State private var shown: Set<String> = []

  var body: some View {
    VStack(spacing: 0) {
      Form {
        Section("用量接口") {
          TextField("地址", text: $draft.url, prompt: Text("http://…/api/v1/billing/usage"))
            .textContentType(.URL)
          Stepper(value: $draft.interval, in: 10...3600, step: 10) {
            LabeledContent("刷新间隔", value: "\(draft.interval) 秒")
          }
          if !draft.url.isEmpty && !validURL {
            Label("地址要以 http:// 或 https:// 开头", systemImage: "exclamationmark.triangle").foregroundStyle(.orange).font(.caption)
          }
        }
        Section {
          ForEach($draft.keys) { $k in
            HStack(spacing: 8) {
              TextField("名称", text: $k.name, prompt: Text("名称（可留空）"))
                .frame(width: 140)
              Group {
                if shown.contains(k.id) {
                  TextField("key", text: $k.key, prompt: Text("sk-…"))
                } else {
                  SecureField("key", text: $k.key, prompt: Text("sk-…"))
                }
              }
              .font(.system(.body, design: .monospaced))
              Button {
                if shown.contains(k.id) { shown.remove(k.id) } else { shown.insert(k.id) }
              } label: { Image(systemName: shown.contains(k.id) ? "eye.slash" : "eye") }
                .buttonStyle(.borderless)
                .help(shown.contains(k.id) ? "隐藏" : "显示")
              Button(role: .destructive) {
                withAnimation { draft.keys.removeAll { $0.id == k.id } }
              } label: { Image(systemName: "minus.circle.fill") }
                .buttonStyle(.borderless)
                .foregroundStyle(.red)
                .help("删除")
            }
            .labelsHidden()
          }
          .onMove { draft.keys.move(fromOffsets: $0, toOffset: $1) }
          Button {
            withAnimation { draft.keys.append(KeyEntry()) }
          } label: { Label("添加 key", systemImage: "plus.circle.fill") }
            .buttonStyle(.borderless)
        } header: {
          Text("Key")
        } footer: {
          Text("保存在本机 ~/Library/Application Support/QuotaBar/config.json，只有你的账户能读。").font(.caption).foregroundStyle(.secondary)
        }
        Section {
          TextField("settings.json", text: $draft.settingsPath)
            .font(.system(.body, design: .monospaced))
        } header: {
          Text("Claude Code 配置文件")
        } footer: {
          Text("「用于 Claude Code」把这个文件里的 env.ANTHROPIC_AUTH_TOKEN 换成所选的 key，并删除 env.ANTHROPIC_API_KEY；其他内容保持原样。修改前的内容保存在同目录的 .bak 文件。")
            .font(.caption).foregroundStyle(.secondary)
        }
      }
      .formStyle(.grouped)
      Divider()
      HStack {
        Spacer()
        Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
        Button("保存") {
          store.save(draft)
          dismiss()
        }
        .keyboardShortcut(.defaultAction)
        .buttonStyle(.borderedProminent)
      }
      .padding(14)
    }
    .frame(width: 600, height: 560)
    .onAppear {
      draft = store.config
      if draft.keys.isEmpty { draft.keys.append(KeyEntry()) }
    }
  }

  private var validURL: Bool {
    guard let u = URL(string: draft.url.trimmingCharacters(in: .whitespaces)) else { return false }
    return ["http", "https"].contains(u.scheme?.lowercased() ?? "") && u.host != nil
  }
}
