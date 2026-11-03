# QuotaBar（额度看板 macOS 版）

一个菜单栏 App：查看多个 key 的用量，并一键切换 Claude Code 使用的 key。只用 macOS 自带的框架（SwiftUI、Swift Charts、Foundation、AppKit），不依赖第三方库。需要 macOS 14 或更新版本。

## 安装

需要 Xcode 或 Xcode 命令行工具（终端运行 `xcode-select --install` 安装）。

```bash
git clone https://github.com/ryuryu0x08/devtool.git
cd devtool/mac/QuotaBar
./build.sh --install --fonts ~/Downloads/字体.zip   # 编译，复制到 /Applications 并打开
```

- `--fonts` 接收字体文件夹或 .zip（.woff2 / .ttf / .otf），复制到本目录的 `Fonts/` 供以后编译使用。之后再编译只需 `./build.sh --install`。
- 字体不在仓库里（`Fonts/` 已被 git 忽略）。没有字体时使用系统字体和 SF Symbols。字体不含中文，中文始终用系统字体（苹方）。
- 只编译不安装：`./build.sh`，生成的 App 在 `build/QuotaBar.app`。

第一次打开时会弹出设置：用量接口地址默认是 `http://api-ai-coding.bilibili.co/api/v1/billing/usage`，粘贴 key 即可。如果 macOS 询问是否允许访问本地网络，请选择允许，否则连不上内网接口。

想让它开机自动启动：系统设置 → 通用 → 登录项 → 添加 QuotaBar。

## 使用

- **添加 key**：在设置的「人员」里粘贴 key，回车。不用填名字：第一次请求成功后，用接口返回的 `nick_name` 作为名字；识别前显示 key 的前 10 个字符。Claude Code 当前在用的 key 不在列表里时，会自动加进来。
- **key 轮换**：每人只有一个 key。粘贴某人的新 key，识别出同一个名字后，新 key 替换旧 key，历史数据接着记。如果 Claude Code 正在用旧 key，会一并改成新 key。
- **请求失败**：名字和上次的数据照常显示，数字变浅，并说明原因：key 不能用了（可能已轮换），接口暂时出错，或连不上接口。鼠标悬停可看详细错误。连不上或接口出错时 15 秒后重试。
- **菜单栏**：显示 Claude Code 当前所用 key 的人名和「今日还可用」。
- **看板**（面板底部「看板」）：每人一张卡片，共用额度池，用量趋势图（1 小时 / 6 小时 / 24 小时 / 7 天，鼠标悬停可看具体数值）。额度不定时恢复：用量变少时，线在那里断开，并用虚线标出「额度恢复」；App 没运行的时段也断开，不画假的连线。
- **查看、复制、删除 key**：在设置的「人员」里，key 完整显示，可以选中，旁边有复制按钮；也可以在卡片上右键删除。
- **深色 / 浅色**：跟随系统设置，切换时立即生效。
- **今日还可用** = 今日额度剩余 + 还能用的超额。还能用的超额不超过自己的超额上限，也不超过共用池剩余（接口返回 `overflow_available` 时也以它为上限）；今日额度本身不受共用池影响。
- **切换 key**（卡片上的「用于 Claude」，面板里的「切换」）：同时用于 Claude Code 和 Claude Desktop。
  - **模型接口**：设置里填一个，默认 `http://api-ai-coding.bilibili.co/api`。Claude Code 的 `ANTHROPIC_BASE_URL` 或 Desktop 网关地址不是它时，先问：「一并换接口」「只换 key」「取消」；一致就直接切换。
  - **Claude Code**：`~/.claude/settings.json` 存在才改，不存在不创建。改 `env.ANTHROPIC_AUTH_TOKEN`（需要时连同 `env.ANTHROPIC_BASE_URL`），删除 `env.ANTHROPIC_API_KEY`，其余逐字节保留。正在运行的会话保存即生效（据 Claude Code 文档）。
  - **Claude Desktop**：用「第三方推理」连网关时（`~/Library/Application Support/Claude-3p/configLibrary/` 里生效的配置，`inferenceProvider` 为 `gateway`），改其中的 `inferenceGatewayApiKey`（需要时连同 `inferenceGatewayBaseUrl`）。Desktop 自己存的 key 是加密的（`__sealed__:`），写明文它也能读，已实测。公司 MDM 管理时不改。
  - **重启 Desktop**：Desktop 只在启动时读配置。key 真的变了且 Desktop 开着时，问「重启」「稍后」，可勾「记住我的选择」；之后在设置「换 key 后重启 Desktop」里改（每次询问 / 自动重启 / 不重启）。
  - 改动前的文件都留一份同目录的 `.bak`；写入前校验除改动项外内容不变，否则不写。
- **字号**：设置「显示 → 字号」，所有文字一起加大或减小。

## 数据保存在哪里

`~/Library/Application Support/QuotaBar/`：

- `config.json`：接口地址、刷新间隔、每个人的名字、key 和上次的数据（明文，文件只有你的账户能读）。
- `history.json`：趋势图数据，每个 key 每 5 分钟一个点，保留 7 天。

## 开发

```bash
swift test      # 核心逻辑的测试：接口解析、可用额度计算、人员与 key 轮换、历史与趋势分段、settings.json 修改
swift run       # 直接运行（不经过 .app，访问 http 地址可能被系统拦截，建议用 build.sh）
```

代码结构：

- `Sources/QuotaCore`：不涉及界面的逻辑，全部有测试。
- `Sources/QuotaBar`：界面。
- `Resources/AppIcon.png`：App 图标（哔哩哔哩蓝 #00AEEC、粉 #FB7299），由 `Resources/icon/make_icon.py` 画出。
- `../ci/`：持续集成里截图用的模拟接口和脚本。
