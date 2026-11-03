#!/bin/bash
# Builds QuotaBar.app into ./build. Needs Xcode or the Xcode command line tools
# (xcode-select --install). With --install it is also copied to /Applications and opened.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/QuotaBar"
APP=build/QuotaBar.app

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/QuotaBar"
cp Resources/Info.plist "$APP/Contents/Info.plist"
# Signed for this Mac only (no developer account needed).
codesign --force --sign - "$APP"
echo "Built $PWD/$APP"

if [[ "${1:-}" == "--install" ]]; then
  pkill -x QuotaBar 2>/dev/null || true
  rm -rf /Applications/QuotaBar.app
  cp -R "$APP" /Applications/
  open /Applications/QuotaBar.app
  echo "Installed /Applications/QuotaBar.app"
fi
