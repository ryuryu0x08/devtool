# @devtool/ui

工具箱和接口中继的窗口共用的外观：

- `@devtool/ui/fonts`：Geist Sans / Geist Mono（打包在应用里，不需要联网）
- `@devtool/ui/theme.css`：浅色、深色两套颜色变量（`--ink`、`--acc`、`--card` 等）和基础元素样式；`<html data-theme="dark">` 切换
- `@devtool/ui/controls.css`：按钮 `.btn`、分段控件 `.seg`、卡片 `.card` / `.card-head`、`.pill`

按这个顺序引入，之后再引入应用自己的样式。
