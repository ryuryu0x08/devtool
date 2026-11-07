# 接口中继 · Relay

桌面 App（macOS、Windows、Linux）：给使用者发 token，把他们的 Anthropic / OpenAI 请求转到你配置的上游接口和 key。使用者拿不到上游的 key；换 key、换上游、停用某个人，都只在这里改。

## 怎么用

1. **新建入口**：起个名字，选 Anthropic 或 OpenAI。
2. **加上游**：名字、地址、key。多个上游按顺序尝试：连不上、429 或 5xx 时换下一个；4xx 不换（是请求本身的问题）。
   - 地址带上接口的路径前缀（如 `http://10.0.0.5/api`）；OpenAI 的不含 `/v1`（如 `https://api.openai.com`）。
   - key 的传法：`x-api-key`（Anthropic 官方）或 `Bearer`（OpenAI 和多数兼容网关）。
   - 「经系统代理」：只能通过代理访问的接口（如国内访问官方接口）勾上；内网地址不要勾。
3. **生成 token** 发给使用者。token 只显示一次，App 只保存它的指纹（SHA-256）；可以随时停用或删除。
4. 使用者这样设置（地址在「客户端怎么连」里，点击复制）：
   - Claude Code：`ANTHROPIC_BASE_URL=http://127.0.0.1:8790`，`ANTHROPIC_AUTH_TOKEN=<token>`
   - OpenAI SDK：`base_url="http://127.0.0.1:8790/v1"`，`api_key=<token>`

关闭窗口后中继继续运行，托盘图标可以重新打开窗口或退出。再次打开 App 会显示已经在运行的那个，不会启动第二个。

## 安全

- 只监听 `127.0.0.1`，只给本机的程序用。
- Host 不是本机地址的请求回 403（网页借 DNS 重绑定也用不了）；网页可以用 token 调用（有 CORS 头）。
- 上游的 key 只存在配置文件里（只有你的账户能读，权限 600），窗口里只显示首尾几位。
- 日志只记时间、入口、token 名字、上游、方法、路径（不含查询参数）、状态码和耗时；不记 key、token 和请求内容。
- 配置文件读不出来时（手动改坏、版本不对），先另存一份再用默认设置，不会覆盖掉 key。

配置文件位置：macOS `~/Library/Application Support/com.devtool.relay/config.json`，Windows `%APPDATA%\com.devtool.relay\config.json`，Linux `~/.config/com.devtool.relay/config.json`。

## 安装

每次推送后 CI 会出三个平台的安装包（GitHub Actions → relay → Artifacts）：

| 平台 | 文件 | 说明 |
|---|---|---|
| macOS（Apple 芯片） | `.dmg` | 没有 Apple 开发者签名：第一次打开要右键 →「打开」；从浏览器下载的若提示"已损坏"，运行 `xattr -cr /Applications/Relay.app` |
| Windows | `.msi` 或 `-setup.exe` | 没有代码签名：SmartScreen 提示时选「仍要运行」 |
| Linux | `.deb`、`.rpm`、`.AppImage` | |

自己编译：需要 Node 22 和 Rust（[rustup](https://rustup.rs)）；Linux 另需 `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`。

```bash
npm install                          # 仓库根目录
npm run build -w @devtool/relay      # 安装包在 apps/relay/target/release/bundle/
npm run dev -w @devtool/relay        # 开发：窗口热更新
```

## 代码

```
core/            中继本身（不依赖窗口，全部有测试）
  src/config.rs  配置：入口、上游、token（只存指纹）；读写（权限 600，读不出时另存）
  src/proxy.rs   服务：认证 → 按顺序试上游 → 换上 key → 流式转发；Host 检查、CORS
  src/edit.rs    窗口发来的修改，先校验再改
  src/view.rs    窗口看到的内容（key 只留首尾）
  src/log.rs     最近的请求、每个 token 的次数
  tests/         真实端口上的端到端：换 key、路径、换上游、流式、拒绝的请求、日志
src-tauri/       桌面 App：窗口的命令、保存配置、启动服务、托盘、只运行一个
src/             窗口（React，样式来自 packages/ui）
e2e/             窗口的测试（Playwright，对着 e2e/fake.ts 里模拟的命令）
ci/app_e2e.sh    编译好的 App 的端到端：读配置、转发、第二次打开
icon.svg         图标源文件（npm run icons -w @devtool/relay 生成各尺寸）
```

```bash
cargo test --workspace                 # 在 apps/relay：核心 + 命令（Linux 需要上面的系统库；Windows 上命令的测试程序起不来，只跑 cargo test -p relay-core）
npm run test:e2e -w @devtool/relay     # 窗口
apps/relay/ci/app_e2e.sh apps/relay/target/release/relay-app   # 编译好的 App（Linux，需要 xvfb、dbus）
```
