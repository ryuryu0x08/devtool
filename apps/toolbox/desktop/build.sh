#!/bin/bash
# Builds devtool as a desktop app on this computer: macOS (devtool.app) or Linux (.deb).
#   ./build.sh             build only; prints where the app is
#   ./build.sh --install   also put it in place and open it (macOS: /Applications; Linux: the .deb,
#                          with sudo), quitting a running one first
# Needs Node 18+. The first build downloads Electron (about 100 MB); later ones take well under a
# minute.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../../.. && pwd)"

INSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=1 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "不认识的参数: $1 (可用: --install)" >&2; exit 1 ;;
  esac
  shift
done

OS="$(uname -s)"
case "$OS" in
  Darwin|Linux) ;;
  *) echo "这个脚本用于 macOS 和 Linux; Windows 请在仓库根目录运行: npm install && npm run dist -w @devtool/toolbox-desktop" >&2; exit 1 ;;
esac

command -v node >/dev/null && command -v npm >/dev/null || { echo "需要 Node 18 或更新版本: https://nodejs.org" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 18 ]] || { echo "Node 版本太旧 ($(node -v)), 需要 18 或更新" >&2; exit 1; }

echo "==> 安装 JS 依赖 (仓库根目录; 第一次会下载 Electron, 约 100 MB)"
(cd "$ROOT" && npm install --no-audit --no-fund --loglevel=error)

# Where the app was built from: its update (macOS) fetches into this clone and builds again.
if COMMIT="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"; then
  printf '{"sourceDir":%s,"commit":"%s","built":"%s"}\n' "$(node -p 'JSON.stringify(process.argv[1])' "$ROOT")" "$COMMIT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > build-info.json
else
  rm -f build-info.json
fi

if [[ "$OS" == Darwin ]]; then
  echo "==> 编译"
  (cd "$ROOT" && npm run pack -w @devtool/toolbox-desktop)
  APP="$(ls -d "$PWD"/release/mac*/devtool.app | head -1)"
  [[ -d "$APP" ]] || { echo "没有编译出 devtool.app" >&2; exit 1; }
  # The same app as Toolbox.app beside it (an APFS clone: no more room): an app from before it was
  # renamed looks for that name when it updates itself.
  rm -rf "$(dirname "$APP")/Toolbox.app"
  cp -cR "$APP" "$(dirname "$APP")/Toolbox.app" 2>/dev/null || cp -R "$APP" "$(dirname "$APP")/Toolbox.app"
  echo "Built $APP"
  if [[ $INSTALL == 1 ]]; then
    # The running one quits first, under either name (Toolbox.app before the rename).
    for name in devtool Toolbox; do
      if pgrep -f "/Applications/$name.app/" >/dev/null; then
        osascript -e "tell application \"$name\" to quit" >/dev/null 2>&1 || true
        for _ in $(seq 20); do pgrep -f "/Applications/$name.app/" >/dev/null || break; sleep 0.25; done
        pkill -f "/Applications/$name.app/" 2>/dev/null || true
      fi
    done
    rm -rf /Applications/devtool.app /Applications/Toolbox.app
    cp -R "$APP" /Applications/
    open /Applications/devtool.app
    echo "Installed /Applications/devtool.app (已打开)"
  fi
else
  echo "==> 编译 (.deb)"
  (cd "$ROOT" && npm run web -w @devtool/toolbox-desktop && npm run electron -w @devtool/toolbox-desktop && cd apps/toolbox/desktop && npx electron-builder --linux deb)
  DEB="$(ls -t "$PWD"/release/*.deb | head -1)"
  echo "Built $DEB"
  if [[ $INSTALL == 1 ]]; then
    pkill -x devtool 2>/dev/null || true
    pkill -x toolbox 2>/dev/null || true
    # The package was called toolbox before the rename: that one goes.
    if dpkg -s toolbox >/dev/null 2>&1; then sudo apt-get remove -y toolbox; fi
    sudo apt-get install -y --reinstall "$DEB"
    (nohup devtool >/dev/null 2>&1 &)
    echo "Installed $(basename "$DEB") (已打开)"
  fi
fi
