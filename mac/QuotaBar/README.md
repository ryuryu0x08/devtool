# QuotaBar（额度看板 macOS 版）

一个菜单栏 App：查看多个 key 的用量，并一键切换 Claude Code 使用的 key。只用 macOS 自带的框架（SwiftUI、Swift Charts、Foundation、AppKit），不依赖第三方库。需要 macOS 14 或更新版本。

## 安装

需要 Xcode 或 Xcode 命令行工具（终端运行 `xcode-select --install` 安装）。

```bash
git clone https://github.com/ryuryu0x08/devtool.git
cd devtool/mac/QuotaBar
./build.sh --install     # 编译，复制到 /Applications 并打开
```

只编译不安装：`./build.sh`，生成的 App 在 `build/QuotaBar.app`。

第一次打开时会弹出设置：填写用量接口地址（如 `http://…/api/v1/billing/usage`），添加 key，保存。如果 macOS 询问是否允许访问本地网络，请选择允许，否则连不上内网接口。

想让它开机自动启动：系统设置 → 通用 → 登录项 → 添加 QuotaBar。

## 功能

- **菜单栏**：图标旁显示 Claude Code 当前所用 key 的「今日还可用」。点开是每个 key 的概况，以及共用额度池。
- **看板**（面板底部「看板」）：每个 key 一张卡片，共用额度池，用量趋势图（1 小时 / 6 小时 / 24 小时 / 7 天，鼠标悬停可看具体数值）。
- **今日还可用** = 今日额度剩余 + 还能用的超额。还能用的超额不超过自己的超额上限，也不超过共用池剩余（接口返回 `overflow_available` 时也以它为上限）；今日额度本身不受共用池影响。
- **切换 Claude Code 的 key**：点卡片上的「用于 Claude Code」。
  - 把 `~/.claude/settings.json` 里的 `env.ANTHROPIC_AUTH_TOKEN` 换成这个 key，并删除 `env.ANTHROPIC_API_KEY`（两者同时存在会冲突）。`ANTHROPIC_BASE_URL` 等其他内容不动。
  - 只改这两处文字，文件其余部分逐字节保留；写入前会检查除这两项外内容完全一致，否则不写。
  - 修改前的文件保存为同目录的 `settings.json.bak`。settings.json 是符号链接时，写入它指向的文件。
  - 文件不是有效 JSON（例如带注释）时不修改，并说明原因。
  - 新开的 Claude Code 会话使用新 key；已经打开的会话可能需要重开。
  - 项目目录里的 `.claude/settings.json`、`.claude/settings.local.json` 或环境变量可能覆盖这里的设置；settings.json 里有 `apiKeyHelper` 时面板会提示。

## 数据保存在哪里

`~/Library/Application Support/QuotaBar/`：

- `config.json`：接口地址、刷新间隔、key（明文，文件只有你的账户能读）。
- `history.json`：趋势图数据，每个 key 每 5 分钟一个点，保留 7 天。

## 开发

```bash
swift test      # 核心逻辑的测试：接口解析、可用额度计算、历史数据、settings.json 修改
swift run       # 直接运行（不经过 .app，访问 http 地址可能被系统拦截，建议用 build.sh）
```

代码结构：

- `Sources/QuotaCore`：不涉及界面的逻辑，全部有测试。
- `Sources/QuotaBar`：界面。
- `../ci/`：持续集成里截图用的模拟接口和脚本。
