#!/bin/bash
# The local forwarder in the running app (CI only: it replaces the app's config and /etc/hosts).
# The model API is the stand-in API under a name of its own (http and not 127.0.0.1 by name, so
# Desktop would need the forwarder); Desktop's configuration is a stand-in in a temporary folder.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="$HOME/Library/Application Support/QuotaBar"
mkdir -p "$DIR"
IP=model-api.quotabar.test
grep -q "$IP" /etc/hosts || echo "127.0.0.1 $IP" | sudo tee -a /etc/hosts >/dev/null
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder || true
sleep 1
TMP="$(mktemp -d)"
mkdir -p "$TMP/claude" "$TMP/desktop/configLibrary"
printf '{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "sk-demo-yy"\n  }\n}\n' > "$TMP/claude/settings.json"
ID=00000000-0000-4000-8000-000000000001
printf '{"entries":[{"id":"%s","name":"t"}],"appliedId":"%s"}' $ID $ID > "$TMP/desktop/configLibrary/_meta.json"
printf '{"inferenceGatewayBaseUrl":"http://%s:9931/api","inferenceGatewayApiKey":"__sealed__:v1:x","inferenceProvider":"gateway","inferenceCredentialKind":"static"}' "$IP" > "$TMP/desktop/configLibrary/$ID.json"

python3 ci/fake_usage.py &
SERVER=$!
BUSY=""
PROXY=""
trap 'kill $SERVER $BUSY $PROXY 2>/dev/null || true; pkill -x QuotaBar || true; [[ -n "$PROXY" ]] && proxies off' EXIT
until curl -s -o /dev/null "http://$IP:9931/"; do sleep 0.2; done

# A system proxy, as Clash and the like set, that answers everything with an empty 400: the
# forwarder must go straight to the model API, not through it.
python3 -c '
import http.server
class P(http.server.BaseHTTPRequestHandler):
    def handle_one_request(self):
        self.raw_requestline = self.rfile.readline(65537)
        self.wfile.write(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        self.close_connection = True
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(("127.0.0.1", 7890), P).serve_forever()' &
PROXY=$!
SERVICES="$(networksetup -listallnetworkservices | tail -n +2 | grep -v '^\*')"
proxies() {
  while IFS= read -r svc; do
    if [[ $1 == on ]]; then
      sudo networksetup -setwebproxy "$svc" 127.0.0.1 7890
      sudo networksetup -setsocksfirewallproxy "$svc" 127.0.0.1 7890
    else
      sudo networksetup -setwebproxystate "$svc" off
      sudo networksetup -setsocksfirewallproxystate "$svc" off
    fi
  done <<< "$SERVICES"
}
proxies on
scutil --proxy | grep -E "HTTPEnable|HTTPPort|SOCKSEnable" || true

python3 - "$DIR" "$TMP" "$IP" <<'PY'
import json, sys
d, tmp, ip = sys.argv[1:]
json.dump({"url": "http://127.0.0.1:9931/api/v1/billing/usage", "baseURL": f"http://{ip}:9931/api", "forward": True,
           "people": [{"id": "b", "name": "yy", "key": "sk-demo-yy"}], "claudeDir": tmp + "/claude", "desktopDir": tmp + "/desktop"},
          open(d + "/config.json", "w"))
PY

desktop_url() { python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["inferenceGatewayBaseUrl"])' "$TMP/desktop/configLibrary/$ID.json"; }
wait_for() { for _ in $(seq 40); do [[ "$(desktop_url)" == "$1" ]] && return 0; sleep 0.5; done; echo "Desktop address: $(desktop_url), wanted $1"; return 1; }
check() {
  local port=$1
  wait_for "http://127.0.0.1:$port"
  local out ok=0
  for i in $(seq 20); do
    out="$(curl -sS -m 10 -H 'Authorization: Bearer sk-demo-ye' "http://127.0.0.1:$port/v1/billing/usage" 2>&1 || true)"
    [[ "$out" == *'"nick_name": "ye"'* ]] && ok=$((ok + 1)) || break
  done
  echo "through 127.0.0.1:$port: $ok/20 answered, last: $out"
  if [[ $ok != 20 ]]; then
    echo "the forwarder did not pass the request on"
    pgrep -lx QuotaBar || echo "QuotaBar is not running"
    lsof -nP -iTCP -sTCP:LISTEN | grep -E "4783[0-9]" || true
    echo "--- app output"; cat "$TMP/app.log" || true
    ls -t ~/Library/Logs/DiagnosticReports/ 2>/dev/null | grep -i quotabar | head -1 | while read f; do head -60 ~/Library/Logs/DiagnosticReports/"$f"; done
    return 1
  fi
}

launch() { build/QuotaBar.app/Contents/MacOS/QuotaBar >>"$TMP/app.log" 2>&1 & }
launch
check 47831
echo "OK: forwarder on 47831, Desktop moved to it without asking, requests pass"
# As Claude Desktop does: Node's fetch, connections kept and reused, a stream among them.
node ci/desktop_like.mjs http://127.0.0.1:47831
echo "OK: a Desktop-like client works through the forwarder"
quit() { pkill -x QuotaBar; while pgrep -x QuotaBar >/dev/null; do sleep 0.2; done; }

# Restarted right after requests passed (their connections linger in TIME_WAIT): the same port.
quit
launch
sleep 3
check 47831
echo "OK: restarted, still on 47831"
quit

# 47831 is taken now: the next port, and Desktop follows (it was on an address of ours).
python3 -c 'import socket,time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("127.0.0.1",47831)); s.listen(); print("47831 taken by another program", flush=True); time.sleep(120)' &
BUSY=$!
sleep 1
launch
sleep 2
grep -o '"forwardPort" : [0-9]*' "$DIR/config.json" || true
check 47832
echo "OK: 47831 taken, forwarder on 47832, Desktop followed without asking"
grep -o '"forwardPort" : [0-9]*' "$DIR/config.json"
grep -q '"inferenceGatewayApiKey":"__sealed__:v1:x"' "$TMP/desktop/configLibrary/$ID.json" && echo "OK: Desktop's key left as it was"
quit
kill $BUSY 2>/dev/null || true; BUSY=""

# Swapping keys: the forwarder sends the chosen person's key (yy), not the one the client sent (ye).
python3 - "$DIR" "$TMP" "$IP" <<'PY'
import json, sys
d, tmp, ip = sys.argv[1:]
json.dump({"url": "http://127.0.0.1:9931/api/v1/billing/usage", "baseURL": f"http://{ip}:9931/api", "forward": True,
           "swapKeys": True, "desktopPerson": "b", "forwardPort": 47831,
           "people": [{"id": "a", "name": "ye", "key": "sk-demo-ye"}, {"id": "b", "name": "yy", "key": "sk-demo-yy"}],
           "claudeDir": tmp + "/claude", "desktopDir": tmp + "/desktop"},
          open(d + "/config.json", "w"))
PY
launch
sleep 2
for _ in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:47831/" && break; sleep 0.5; done
out="$(curl -sS -m 10 -H 'Authorization: Bearer sk-demo-ye' "http://127.0.0.1:47831/v1/billing/usage")"
echo "with swapping: $out"
[[ "$out" == *'"nick_name": "yy"'* ]] || { echo "the forwarder did not send the chosen key"; cat "$TMP/app.log"; exit 1; }
out="$(curl -sS -m 10 "http://127.0.0.1:47831/v1/billing/usage")"
[[ "$out" != *'"nick_name"'* ]] || { echo "a request without a key of its own got one: $out"; exit 1; }
code="$(curl -sS -m 10 -o /dev/null -w '%{http_code}' -H 'Host: evil.example:47831' -H 'Authorization: Bearer sk-demo-ye' "http://127.0.0.1:47831/v1/billing/usage")"
[[ "$code" == 403 ]] || { echo "a request for another host name was not turned away: $code"; exit 1; }
echo "OK: swapping keys, the forwarder sends the chosen person's key (only in place of one sent, only to this machine's name)"
quit

# Not swapping: the forwarder sends the key in Desktop's configuration (yy), not the one the
# running Desktop read at launch (ye): a key written there works with no restart.
python3 - "$DIR" "$TMP" "$IP" "$TMP/desktop/configLibrary/$ID.json" <<'PY'
import json, sys
d, tmp, ip, entry = sys.argv[1:]
json.dump({"url": "http://127.0.0.1:9931/api/v1/billing/usage", "baseURL": f"http://{ip}:9931/api", "forward": True,
           "forwardPort": 47831,
           "people": [{"id": "a", "name": "ye", "key": "sk-demo-ye"}, {"id": "b", "name": "yy", "key": "sk-demo-yy"}],
           "claudeDir": tmp + "/claude", "desktopDir": tmp + "/desktop"},
          open(d + "/config.json", "w"))
e = json.load(open(entry))
e["inferenceGatewayApiKey"] = "sk-demo-yy"
json.dump(e, open(entry, "w"))
PY
launch
sleep 2
for _ in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:47831/" && break; sleep 0.5; done
out="$(curl -sS -m 10 -H 'Authorization: Bearer sk-demo-ye' "http://127.0.0.1:47831/v1/billing/usage")"
echo "Desktop's configured key: $out"
[[ "$out" == *'"nick_name": "yy"'* ]] || { echo "the forwarder did not send Desktop's configured key"; cat "$TMP/app.log"; exit 1; }
echo "OK: not swapping, the forwarder sends the key in Desktop's configuration"

# The update's last step, as the app does it: the build put in place of the running app (here a
# copy in a folder of its own), opened, the old one quitting; the new one keeps the port.
quit
APPS="$TMP/Apps"
mkdir -p "$APPS"
cp -R build/QuotaBar.app "$APPS/"
printf 'old' > "$APPS/QuotaBar.app/Contents/Resources/marker"
open -n "$APPS/QuotaBar.app" --args --reinstall-from "$PWD/build/QuotaBar.app"
OLD=""
for _ in $(seq 40); do OLD="$(pgrep -x QuotaBar | head -1 || true)"; [[ -n "$OLD" ]] && break; sleep 0.25; done
[[ -n "$OLD" ]] || { echo "the app did not open"; exit 1; }
echo "old: $OLD"
NEW=""
for _ in $(seq 120); do
  NEW="$(pgrep -x QuotaBar | grep -vx "$OLD" | head -1 || true)"
  [[ -n "$NEW" ]] && ! kill -0 "$OLD" 2>/dev/null && break
  sleep 0.25
done
ps -o pid,args -p "$NEW" 2>/dev/null || true
[[ -n "$NEW" ]] || { echo "the new app was not opened"; cat "$TMP/app.log" || true; exit 1; }
! kill -0 "$OLD" 2>/dev/null || { echo "the old app did not quit"; exit 1; }
[[ ! -e "$APPS/QuotaBar.app/Contents/Resources/marker" ]] || { echo "the app was not replaced"; exit 1; }
ls -a "$APPS"
[[ "$(ls -A "$APPS")" == "QuotaBar.app" ]] || { echo "something was left beside the app"; exit 1; }
ps -o args= -p "$NEW" | grep -q -- "Apps/QuotaBar.app/Contents/MacOS/QuotaBar --after-update $OLD" || { echo "not the replaced app, or not told to wait"; exit 1; }
for _ in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:47831/" && break; sleep 0.5; done
# As Desktop does: with the key it read at launch (ye); the forwarder sends the configured one (yy).
out="$(curl -sS -m 10 -H 'Authorization: Bearer sk-demo-ye' "http://127.0.0.1:47831/v1/billing/usage")"
[[ "$out" == *'"nick_name": "yy"'* ]] || { echo "the new app's forwarder is not on 47831: $out"; exit 1; }
echo "OK: updated in place, the old app quit, the new one opened on the same port"
quit
