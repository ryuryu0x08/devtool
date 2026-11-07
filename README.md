# devtool

一个仓库里的几个开发者工具，每个产品一个目录，各自带说明、测试和持续集成。

| 产品 | 目录 | 是什么 | 技术 |
|---|---|---|---|
| 工具箱 | [`apps/toolbox`](apps/toolbox) | 网页工具箱：格式化、编解码、时间戳、对比、二维码等，PC 和手机都能用 | React + Vite |
| QuotaBar | [`apps/quotabar`](apps/quotabar) | macOS 菜单栏 App：多个 key 的用量，一键切换 Claude Code / Desktop 用的 key | SwiftUI |
| 接口中继 | `apps/relay`（开发中） | 桌面 App：给使用者发 token，把 Anthropic / OpenAI 请求转到配置好的上游接口和 key | Tauri（Rust + React） |

## 目录

```
apps/
  toolbox/          工具箱（说明、产品原则、开发命令见它的 README）
  quotabar/         QuotaBar（安装、功能、代码结构见它的 README）
    ci/             它的端到端测试和截图脚本
mac/QuotaBar/       只剩一个 build.sh：移动前装的 QuotaBar 自动更新时用它，编译转到 apps/quotabar
.github/workflows/  每个产品一个，只在自己的目录变动时运行
  toolbox.yml       类型检查、单元测试、构建、端到端测试（Linux + Chromium）
  quotabar.yml      编译、测试、端到端、截图，通过后把 quotabar-stable 移到这个提交（Mac）
package.json        npm workspaces；根目录的 dev / build / test 等命令转给工具箱
```

## 约定

- 每个产品的代码、测试、CI 脚本和说明都在自己的目录里；只有多个产品共用的东西放在产品目录外面。
- CI 文件按产品命名，`paths` 只写自己的目录。
- 名字不混用：工具箱的「本地转发程序」（`apps/toolbox/scripts/local-proxy.py`，给浏览器插件解决跨域）、QuotaBar 的「本地转发」（让 Desktop 连 http 接口、换 key）、「接口中继」（独立的桌面 App）是三样东西。

## 开发

```bash
npm install          # 一次，在根目录（JS 项目的依赖都装在这里）
npm run dev          # 工具箱本地开发
npm run build        # 工具箱构建到根目录 dist/（和移动前相同，部署照旧）
npm run test:all     # 工具箱全部测试

cd apps/quotabar && ./build.sh --install   # QuotaBar（需要 Xcode 命令行工具）
```
