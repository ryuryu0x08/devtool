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
- **菜单栏**：显示 Claude Code 当前所用 key 的人名和「今日还可用」。偶尔一次读取失败（网络抖动、刚从睡眠醒来、VPN 还没连上）时，继续显示上次的数字，持续 2 分钟仍失败才显示「!」；key 被拒（可能已轮换）时立即显示「!」，开了「自动获取 key」会马上去门户拿新的。醒来后先等 3 秒再读，网络恢复时立刻重读。每次失败和恢复记在 `~/Library/Logs/QuotaBar/refresh.log`（只有人名和原因，没有 key）。
- **看板**（面板底部「看板」）：每人一张卡片，共用额度池，用量趋势图（1 小时 / 6 小时 / 24 小时 / 7 天，鼠标悬停可看具体数值）。额度不定时恢复：用量变少时，线在那里断开，并用虚线标出「额度恢复」；App 没运行的时段也断开，不画假的连线。
- **查看、复制、删除 key**：在设置的「人员」里，key 完整显示，可以选中，旁边有复制按钮；也可以在卡片上右键删除。
- **深色 / 浅色**：跟随系统设置，切换时立即生效。
- **今日还可用** = 今日额度剩余 + 还能用的超额。还能用的超额不超过自己的超额上限，也不超过共用池剩余（接口返回 `overflow_available` 时也以它为上限）；今日额度本身不受共用池影响。
- **切换 key**（卡片上的「用于 Claude」，面板里的「切换」）：同时用于 Claude Code 和 Claude Desktop。
  - **模型接口**：设置里填一个，默认 `http://api-ai-coding.bilibili.co/api`。Claude Code 的 `ANTHROPIC_BASE_URL` 或 Desktop 网关地址不是它时，先问：「一并换接口」「只换 key」「取消」；一致就直接切换。
  - **Claude Code**：`~/.claude/settings.json` 存在才改，不存在不创建。改 `env.ANTHROPIC_AUTH_TOKEN`（需要时连同 `env.ANTHROPIC_BASE_URL`），删除 `env.ANTHROPIC_API_KEY`，其余逐字节保留。正在运行的会话保存即生效（据 Claude Code 文档）。
  - **Claude Desktop**：用「第三方推理」连网关时（`~/Library/Application Support/Claude-3p/configLibrary/` 里生效的配置，`inferenceProvider` 为 `gateway`），改其中的 `inferenceGatewayApiKey`（需要时连同 `inferenceGatewayBaseUrl`）。Desktop 自己存的 key 是加密的（`__sealed__:`），写明文它也能读，已实测。公司 MDM 管理时不改。
  - **本地转发**：Desktop 只接受 HTTPS，或本机（127.0.0.1）的 HTTP。模型接口是其他机器的 `http://` 地址时，设置「Desktop」里会出现「本地转发」：打开后 QuotaBar 在 `127.0.0.1:47831`（被占用就用下一个）起一个转发，把请求原样转给模型接口（含流式回复），切换时 Desktop 填这个地址。端口记下来下次照用；Desktop 的地址是 QuotaBar 自己设过的（以前的转发端口、模型接口本身）时直接替换，不再询问。QuotaBar 需保持运行，可打开设置「通用 → 登录时打开」。设置里的绿色「已启用」只在转发确实连得上、而且正在运行的 Desktop 用的就是这个地址时显示；Desktop 是在地址改动前打开的（还连旧地址），显示橙色提示和「重启 Desktop」。端口被另一个 QuotaBar（更新时没退出的旧版本）占着时，结束那个，端口保持不变。Desktop 配置的地址不是转发的（在别处设的），显示橙色提示和「改为本地转发」。QuotaBar 每次改 Desktop 的地址或 key 都会说明原因（比如"端口 47831 被其他程序占用，本地转发改用 127.0.0.1:47832"、"本地转发已关闭，Desktop 改回直连模型接口"），要重启 Desktop 时询问框里也写着原因；转发没能启动时，Desktop 也改回直连模型接口。每次刷新、唤醒和网络恢复时都会再检查一次，转发被系统关掉（比如睡眠前后）就在原端口重新启动，启动、停止和重启都记在转发日志里。
  - **免重启切换**（设置 → Desktop）：Desktop 经本地转发（模型接口是 https 也一样）访问，转发在每个请求里换上当前选中的人的 key（`Authorization: Bearer …`，Desktop 自己带的 key 不用；只替换请求自带的 key，不带 key 的请求不会被加上；Host 不是本机地址的请求回 403，网页借 DNS 重绑定也用不了）。之后在 QuotaBar 里切换，Desktop 下一个请求就用新 key，不用重启；key 轮换后也自动跟上。打开时 Desktop 改一次地址，需要重启这一次；关掉时把当前 key 写回 Desktop 的配置；转发还开着（http 的模型接口）时，转发改为发送 Desktop 配置里的 key，所以不用重启。不开免重启切换、只开本地转发时也一样：切换写进 Desktop 配置的 key，转发立即发送，不用重启；只有 Desktop 的地址要变时才需要重启。QuotaBar 需保持运行。
  - **Desktop 启动方式**（设置 → Desktop：「第三方网关 / 官方登录」）：
    - 第三方网关：把「模型接口」（开了本地转发就用转发地址）和 Claude Code 的 key 写进第三方配置。已生效的配置是网关的就改它；否则重新启用上次切到官方登录前的那份，没有就新增一份名为「QuotaBar」的配置，设为生效（`_meta.json` 的 `appliedId`）。Desktop 记着的 `"deploymentMode"`（`claude_desktop_config.json`）改成 `"3p"`。之后打开不用登录。
    - 官方登录：去掉 `appliedId`（所有配置都留着），`deploymentMode` 改成 `"1p"`，Desktop 回到 Anthropic 登录。
  - **重启 Desktop**：Desktop 只在启动时读配置。配置真的变了、Desktop 开着、而且改动到不了正在运行的 Desktop 时（经本地转发只换 key 就能立即到），问「重启」「稍后」并写明原因，可勾「记住我的选择」；之后在设置「改动后重启 Desktop」里改（每次询问 / 自动重启 / 不重启）。切换人员、key 轮换、开关转发、切换启动方式都按这同一条规则。选了「稍后」（或设成「不重启」）时，设置「Desktop」最上面一直显示「有改动待 Desktop 重启后生效」、具体是哪些改动和「重启 Desktop」按钮，直到 Desktop 重启（在这里点，或自己重开）或退出。
  - 改动前的文件都留一份同目录的 `.bak`；写入前校验除改动项外内容不变，否则不写。
- **字号**：设置「显示 → 字号」，所有文字一起加大或减小。
- **自动获取 key**（设置 → 人员下方）：key 会不定时轮换。打开「从浏览器 cookie 自动更新」后，QuotaBar 读浏览器里 `ai-coding.bilibili.co` 的 cookie（和 `yt-dlp --cookies-from-browser` 同一方式：cookie 库是 SQLite，值用钥匙串里的「Chrome Safe Storage」密钥 AES 解密，首次读取时 macOS 会问一次，点「始终允许」），带 cookie 调用门户的 `proxy-usage`，拿到当前的 `nickname` 和 `token`，按昵称更新这个人的 key。启动后和每 10 分钟各同步一次，也可点「立即同步」。轮换出来的新 key 若 Claude Code 或 Desktop 正用着旧的，会一并更新（和粘贴新 key 一样）。支持 Chrome / Edge / Brave / Chromium，全程只发往门户本身。

- **更新**（设置 → 通用）：`build.sh` 把源码目录和 commit 记进 app。QuotaBar 启动后和每 6 小时在这个 git 目录里 `git fetch` 一次 `quotabar-stable` 分支（CI 在 Mac 上编译、测试都通过后才移动它），有改到 app 的新提交就快进并运行 `./build.sh`（约 1 分钟），把新编译的 app 放到正在运行的 app 的位置，打开新的（它等旧的退出后才启动，转发端口不变），旧的退出（3 秒内没退出就直接结束；新的等了 15 秒旧的还在，也会结束它，菜单栏不会出现两个）；交接的每一步记在 update.log；编译失败则原来的版本照用，日志在 `~/Library/Logs/QuotaBar/update.log`。用的是这个 git 目录自己的登录凭据，仓库私有也可以：git 带上登录 shell（`$SHELL -l -i`）里设的 ssh agent、代理和 PATH 运行，和终端里一样（从 Finder 打开的 app 本身没有这些，git 走 ssh 时会报 `Permission denied (publickey)`）。GitHub 的 ssh 地址（`git@github.com:…`）即使仓库公开也要密钥，拉取失败时自动改用对应的 https 地址再拉一次，公开仓库不需要任何凭据。可关掉「自动更新」，改为手动点「更新」。源码目录有本地改动挡住时不更新。
- **目录**：设置最下面可改 Claude Code 目录（默认 `~/.claude`，或 `CLAUDE_CONFIG_DIR`）和 Desktop 目录（默认 `~/Library/Application Support/Claude-3p`），留空即自动识别。

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
