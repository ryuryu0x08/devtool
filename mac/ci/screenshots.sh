#!/bin/bash
# Screenshots of QuotaBar against a stand-in usage API (CI only: it replaces the app's config).
set -euo pipefail
cd "$(dirname "$0")/../QuotaBar"
SHOTS="$PWD/build/shots"
mkdir -p "$SHOTS"
DIR="$HOME/Library/Application Support/QuotaBar"
mkdir -p "$DIR"
TMP="$(mktemp -d)"
# Claude Code still uses ye's old key, which was rotated.
printf '{\n  "model": "opus",\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "sk-demo-ye-old"\n  }\n}\n' > "$TMP/settings.json"

python3 ../ci/fake_usage.py &
SERVER=$!
until curl -s -o /dev/null http://127.0.0.1:9931/; do sleep 0.2; done
trap 'kill $SERVER 2>/dev/null || true; pkill -x QuotaBar || true' EXIT

python3 - "$DIR" "$TMP/settings.json" <<'PY'
import json, math, sys, time
d, settings = sys.argv[1], sys.argv[2]
now = time.time() // 300 * 300
# ye's key was rotated: the old one is turned down, the new one (just pasted, not yet named)
# reads as ye. yy and 66 read fine. 老王's key was rotated too, with no new one yet (the last
# reading stays). The last key is new and turned down.
old = {"at": now - 3 * 3600, "usage": {"daily": 120, "dailyLimit": 200, "over": 0, "overLimit": 100, "pool": 700, "poolLimit": 1000}}
people = [{"id": "a", "name": "ye", "key": "sk-demo-ye-old", "lastGood": old}, {"id": "b", "name": "yy", "key": "sk-demo-yy"},
          {"id": "c", "name": "66", "key": "sk-demo-66"}, {"id": "d", "name": "老王", "key": "sk-demo-gone", "lastGood": old},
          {"id": "e", "key": "sk-new-0123456789"}, {"id": "f", "key": "sk-demo-ye"}]
json.dump({"url": "http://127.0.0.1:9931/api/v1/billing/usage", "interval": 60, "people": people, "settingsPath": settings},
          open(d + "/config.json", "w"))
# 24 hours: the quota came back 8 hours ago (use starts again from 0), and the app wasn't
# running for an hour 14 hours ago.
h = []
for i in range(288, 0, -1):
    t = now - i * 300
    if 14 * 12 >= i > 13 * 12:
        continue
    f = (96 - i) / 96 if i < 96 else (288 - i) / 192
    for k, top in (("a", 82), ("b", 236), ("c", 300)):
        h.append({"t": t, "key": k, "daily": round(max(0, top * f + 2 * math.sin(i / 7)), 2), "over": None, "pool": None})
    h[-1]["pool"] = round(912 * f, 1)
json.dump(h, open(d + "/history.json", "w"))
PY

# The dashboard window as large as the screen allows, so the trends show too.
defaults write local.quotabar "NSWindow Frame dashboard" "20 20 1400 1150 0 0 1600 1200"
# osascript with a time limit: it can wait on a permission prompt forever.
osa() { perl -e 'alarm 20; exec @ARGV' osascript "$@"; }
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
  osa -e "tell application \"System Events\" to tell appearance preferences to set dark mode to $1" \
    || defaults write -g AppleInterfaceStyle Dark
}
shot panel-light --panel-window
shot dashboard-light --dashboard
shot settings-light --settings
# The ⓘ of the forwarder rows (Desktop section, further down), its bubble shown.
open build/QuotaBar.app --args --settings --show-tip
sleep 6
swift ../ci/scroll.swift || true
sleep 4
screencapture -x "$SHOTS/settings-tip.png"
pkill -x QuotaBar || true
sleep 1
# ⌘A ⌘C ⌘V in a text field: the address field of the settings has the focus.
open build/QuotaBar.app --args --settings
sleep 6
osa -e 'tell application "QuotaBar" to activate' || true
sleep 1
printf 'x' | pbcopy
osa -e 'tell application "System Events" to keystroke "a" using command down' -e 'tell application "System Events" to keystroke "c" using command down' || true
sleep 1
echo "--- copied with ⌘A ⌘C: $(pbpaste)"
printf 'http://127.0.0.1:9931/pasted' | pbcopy
osa -e 'tell application "System Events" to keystroke "a" using command down' -e 'tell application "System Events" to keystroke "v" using command down' || true
sleep 2
echo "--- model API after ⌘V: $(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["baseURL"])' "$DIR/config.json")"
screencapture -x "$SHOTS/pasted.png"
pkill -x QuotaBar || true
sleep 1
# Switching the system to dark while the app runs: it follows at once.
open build/QuotaBar.app --args --dashboard
sleep 8
osa -e 'tell application "System Events" to tell appearance preferences to set dark mode to true' || true
sleep 2
screencapture -x "$SHOTS/live-dark.png"
pkill -x QuotaBar || true
osa -e 'tell application "System Events" to tell appearance preferences to set dark mode to false' || true
sleep 1
dark true
shot panel-dark --panel-window
shot dashboard-dark --dashboard
dark false || true
ls -la "$SHOTS"
echo "--- settings.json after the runs:"
cat "$TMP/settings.json"
echo "--- people after the runs:"
python3 -c 'import json,sys; [print(p.get("name"), p["key"]) for p in json.load(open(sys.argv[1]))["people"]]' "$DIR/config.json"
# Also in the log, smaller, for reading without downloading the artifact.
for f in "$SHOTS"/*.png; do
  sips -Z 1600 -s format jpeg -s formatOptions 70 "$f" --out "${f%.png}.jpg" >/dev/null
  echo "BEGIN-SHOT $(basename "$f")"
  base64 -i "${f%.png}.jpg"
  echo
  echo "END-SHOT"
done
