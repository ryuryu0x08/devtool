#!/bin/bash
# Screenshots of QuotaBar against a stand-in usage API (CI only: it replaces the app's config).
set -euo pipefail
cd "$(dirname "$0")/../QuotaBar"
SHOTS="$PWD/build/shots"
mkdir -p "$SHOTS"
DIR="$HOME/Library/Application Support/QuotaBar"
mkdir -p "$DIR"
TMP="$(mktemp -d)"
printf '{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "sk-demo-yy"\n  }\n}\n' > "$TMP/settings.json"

python3 ../ci/fake_usage.py &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true; pkill -x QuotaBar || true' EXIT

python3 - "$DIR" "$TMP/settings.json" <<'PY'
import json, math, sys, time
d, settings = sys.argv[1], sys.argv[2]
now = time.time() // 300 * 300
# ye, yy, 66 read fine; 老王's key was rotated (the API turns it down; the last reading stays);
# the last key is new and not read successfully yet.
old = {"at": now - 3 * 3600, "usage": {"daily": 120, "dailyLimit": 200, "over": 0, "overLimit": 100, "pool": 700, "poolLimit": 1000}}
people = [{"id": "a", "key": "sk-demo-ye"}, {"id": "b", "name": "yy", "key": "sk-demo-yy"},
          {"id": "c", "name": "66", "key": "sk-demo-66"}, {"id": "d", "name": "老王", "key": "sk-demo-gone", "lastGood": old},
          {"id": "e", "key": "sk-new-0123456789"}]
json.dump({"url": "http://127.0.0.1:9931/api/v1/billing/usage", "interval": 60, "people": people, "settingsPath": settings},
          open(d + "/config.json", "w"))
h = []
for i in range(288, 0, -1):
    t = now - i * 300
    f = (288 - i) / 288
    for k, top in (("a", 82), ("b", 236), ("c", 300)):
        h.append({"t": t, "key": k, "daily": round(top * f + 3 * math.sin(i / 7), 2), "over": None, "pool": None})
    h[-1]["pool"] = round(912 * f, 1)
json.dump(h, open(d + "/history.json", "w"))
PY

# The dashboard window as large as the screen allows, so the trends show too.
defaults write local.quotabar "NSWindow Frame dashboard" "20 20 1400 1150 0 0 1600 1200"
shot() {
  open build/QuotaBar.app --args "$2"
  sleep 8
  screencapture -x "$SHOTS/$1.png"
  if [[ "$2" == --dashboard ]]; then
    swift ../ci/scroll.swift && sleep 1 && screencapture -x "$SHOTS/$1-end.png"
  fi
  pkill -x QuotaBar || true
  sleep 1
}
dark() {
  osascript -e "tell application \"System Events\" to tell appearance preferences to set dark mode to $1" \
    || defaults write -g AppleInterfaceStyle Dark
}
shot panel-light --panel-window
shot dashboard-light --dashboard
shot settings-light --settings
dark true
shot panel-dark --panel-window
shot dashboard-dark --dashboard
dark false || true
ls -la "$SHOTS"
# Also in the log, smaller, for reading without downloading the artifact.
for f in "$SHOTS"/*.png; do
  sips -Z 1600 -s format jpeg -s formatOptions 70 "$f" --out "${f%.png}.jpg" >/dev/null
  echo "BEGIN-SHOT $(basename "$f")"
  base64 -i "${f%.png}.jpg"
  echo
  echo "END-SHOT"
done
