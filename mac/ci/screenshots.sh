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
keys = [{"id": "a", "name": "野", "key": "sk-demo-ye"}, {"id": "b", "name": "", "key": "sk-demo-yy"},
        {"id": "c", "name": "66", "key": "sk-demo-66"}, {"id": "d", "name": "旧 key", "key": "sk-demo-gone"}]
json.dump({"url": "http://127.0.0.1:9931/api/v1/billing/usage", "interval": 60, "keys": keys, "settingsPath": settings},
          open(d + "/config.json", "w"))
now = time.time() // 300 * 300
h = []
for i in range(288, 0, -1):
    t = now - i * 300
    f = (288 - i) / 288
    for k, top in (("a", 82), ("b", 236), ("c", 300)):
        h.append({"t": t, "key": k, "daily": round(top * f + 3 * math.sin(i / 7), 2), "over": None, "pool": None})
    h[-1]["pool"] = round(912 * f, 1)
json.dump(h, open(d + "/history.json", "w"))
PY

shot() {
  open build/QuotaBar.app --args --dashboard --panel-window
  sleep 8
  screencapture -x "$SHOTS/$1.png"
  pkill -x QuotaBar || true
  sleep 1
}
shot light
defaults write -g AppleInterfaceStyle Dark
shot dark
defaults delete -g AppleInterfaceStyle || true
ls -la "$SHOTS"
