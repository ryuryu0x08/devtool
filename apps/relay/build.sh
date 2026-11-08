#!/bin/bash
# Builds 接口中继 (Relay) on this computer: macOS (Relay.app) or Linux (.deb).
#   ./build.sh             build only; prints where the app is
#   ./build.sh --install   also put it in place and open it (macOS: /Applications; Linux: the .deb,
#                          with sudo), quitting a running one first
# Needs Node 18+ and Rust; offers to install Rust if it is missing. The first build takes a few
# minutes (Rust compiles the libraries once), later ones well under a minute.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"

INSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=1 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "不认识的参数: $1 (可用: --install)" >&2; exit 1 ;;
  esac
  shift
done

OS="$(uname -s)"
case "$OS" in
  Darwin) BUNDLE=app ;;
  Linux) BUNDLE=deb ;;
  *) echo "这个脚本用于 macOS 和 Linux; Windows 请在仓库根目录运行: npm install && npm run build -w @devtool/relay" >&2; exit 1 ;;
esac

# --- What the build needs -------------------------------------------------------------------
command -v node >/dev/null && command -v npm >/dev/null || { echo "需要 Node 18 或更新版本: https://nodejs.org" >&2; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 18 ]] || { echo "Node 版本太旧 ($(node -v)), 需要 18 或更新" >&2; exit 1; }

if [[ "$OS" == Darwin ]] && ! xcode-select -p >/dev/null 2>&1; then
  echo "需要 Xcode 命令行工具: 运行 xcode-select --install, 装好后再运行本脚本" >&2
  exit 1
fi
if [[ "$OS" == Linux ]] && ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo "需要系统库: sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev" >&2
  exit 1
fi

# Rust: installed by rustup into ~/.cargo, which a shell opened before may not have on its PATH.
[[ -f "$HOME/.cargo/env" ]] && source "$HOME/.cargo/env"
if ! command -v cargo >/dev/null; then
  echo "没找到 Rust (编译接口中继需要)。"
  read -r -p "现在用官方的 rustup 安装吗 (装到 ~/.cargo, 约 1-2 分钟)? [Y/n] " yes
  if [[ "${yes:-Y}" =~ ^[Yy]$ ]]; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
    source "$HOME/.cargo/env"
  else
    echo "可以手动安装: https://rustup.rs" >&2
    exit 1
  fi
fi
# rustup there but no toolchain chosen (installed some other way, or never set): cargo then
# refuses to run ("rustup could not choose a version of cargo"). The stable one is set.
if ! cargo --version >/dev/null 2>&1; then
  if command -v rustup >/dev/null; then
    echo "==> Rust 还没有默认版本, 设为 stable (第一次要下载, 约 1 分钟)"
    rustup default stable
  fi
  cargo --version >/dev/null 2>&1 || { echo "cargo 不能运行: $(cargo --version 2>&1 | head -1)" >&2; exit 1; }
fi

# --- Build ------------------------------------------------------------------------------------
echo "==> 安装 JS 依赖 (仓库根目录)"
(cd "$ROOT" && npm install --no-audit --no-fund --loglevel=error)
echo "==> 编译 (第一次要几分钟)"
(cd "$ROOT" && npm run build -w @devtool/relay -- --bundles "$BUNDLE")

if [[ "$OS" == Darwin ]]; then
  APP="$PWD/target/release/bundle/macos/Relay.app"
  [[ -d "$APP" ]] || { echo "没有编译出 $APP" >&2; exit 1; }
  echo "Built $APP"
  if [[ $INSTALL == 1 ]]; then
    # The running one: asked to quit, then ended if it is still there (it holds the port).
    if pgrep -f "/Applications/Relay.app/" >/dev/null; then
      osascript -e 'tell application "Relay" to quit' >/dev/null 2>&1 || true
      for _ in $(seq 20); do pgrep -f "/Applications/Relay.app/" >/dev/null || break; sleep 0.25; done
      pkill -f "/Applications/Relay.app/" 2>/dev/null || true
    fi
    rm -rf /Applications/Relay.app
    cp -R "$APP" /Applications/
    open /Applications/Relay.app
    echo "Installed /Applications/Relay.app (已打开; 关掉窗口后在菜单栏的图标里还能找到)"
  fi
else
  DEB="$(ls -t "$PWD"/target/release/bundle/deb/*.deb | head -1)"
  echo "Built $DEB"
  if [[ $INSTALL == 1 ]]; then
    pkill -x relay-app 2>/dev/null || true
    sudo apt-get install -y --reinstall "$DEB"
    (nohup relay-app >/dev/null 2>&1 &)
    echo "Installed $(basename "$DEB") (已打开)"
  fi
fi
