# QuotaBar 已移到 `apps/quotabar`

这里只剩一个 `build.sh`：移动前装好的 QuotaBar 自动更新时会运行它。它在 `apps/quotabar` 编译，再把 App 复制到这里，更新后的 App 改从 `apps/quotabar` 更新。以前放在这里的 `Fonts/` 会在第一次编译时复制过去。

手动编译请到新目录：

```bash
cd apps/quotabar
./build.sh --install
```
