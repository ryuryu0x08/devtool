#!/bin/bash
# Builds QuotaBar.app into ./build. Needs Xcode or the Xcode command line tools
# (xcode-select --install).
#   --install          also copy it to /Applications and open it
#   --fonts <path>     a folder or .zip of fonts (.woff2 / .ttf / .otf) to use; kept in ./Fonts
#                      for later builds. Without fonts the app uses the system font.
set -euo pipefail
cd "$(dirname "$0")"

INSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=1 ;;
    --fonts)
      SRC="$2"; shift
      rm -rf Fonts && mkdir -p Fonts
      if [[ "$SRC" == *.zip ]]; then
        TMP="$(mktemp -d)"
        ditto -x -k "$SRC" "$TMP"
        SRC="$TMP"
      fi
      find "$SRC" -type f \( -iname '*.woff2' -o -iname '*.woff' -o -iname '*.ttf' -o -iname '*.otf' \) ! -path '*__MACOSX*' -exec cp {} Fonts/ \;
      echo "Fonts: $(ls Fonts | tr '\n' ' ')"
      ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

swift build -c release
BIN="$(swift build -c release --show-bin-path)/QuotaBar"
APP=build/QuotaBar.app

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/QuotaBar"
cp Resources/Info.plist "$APP/Contents/Info.plist"
# The icon, at the sizes macOS asks for.
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s Resources/AppIcon.png --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) Resources/AppIcon.png --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
if [[ -d Fonts ]] && ls Fonts/* >/dev/null 2>&1; then
  mkdir -p "$APP/Contents/Resources/Fonts"
  cp Fonts/* "$APP/Contents/Resources/Fonts/"
fi
# Signed for this Mac only (no developer account needed).
codesign --force --sign - "$APP"
echo "Built $PWD/$APP"

if [[ $INSTALL == 1 ]]; then
  pkill -x QuotaBar 2>/dev/null || true
  rm -rf /Applications/QuotaBar.app
  cp -R "$APP" /Applications/
  open /Applications/QuotaBar.app
  echo "Installed /Applications/QuotaBar.app"
fi
