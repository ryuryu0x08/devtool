#!/bin/bash
# The local forwarder in the running app (CI only: it replaces the app's config and /etc/hosts).
# The model API is the stand-in API under a name of its own (http and not 127.0.0.1 by name, so
# Desktop would need the forwarder); Desktop's configuration is a stand-in in a temporary folder.
set -euo pipefail
cd "$(dirname "$0")/../QuotaBar"
DIR="$HOME/Library/Application Support/QuotaBar"
mkdir -p "$DIR"
IP=model-api.quotabar.test
grep -q "$IP" /etc/hosts || echo "127.0.0.1 $IP" | sudo tee -a /etc/hosts >/dev/null
TMP="$(mktemp -d)"
mkdir -p "$TMP/claude" "$TMP/desktop/configLibrary"
printf '{\n  "env": {\n    "ANTHROPIC_AUTH_TOKEN": "sk-demo-yy"\n  }\n}\n' > "$TMP/claude/settings.json"
ID=00000000-0000-4000-8000-000000000001
printf '{"entries":[{"id":"%s","name":"t"}],"appliedId":"%s"}' $ID $ID > "$TMP/desktop/configLibrary/_meta.json"
printf '{"inferenceGatewayBaseUrl":"http://%s:9931/api","inferenceGatewayApiKey":"__sealed__:v1:x","inferenceProvider":"gateway","inferenceCredentialKind":"static"}' "$IP" > "$TMP/desktop/configLibrary/$ID.json"

python3 ../ci/fake_usage.py &
SERVER=$!
BUSY=""
trap 'kill $SERVER $BUSY 2>/dev/null || true; pkill -x QuotaBar || true' EXIT
until curl -s -o /dev/null "http://$IP:9931/"; do sleep 0.2; done

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
  out="$(curl -s -H 'Authorization: Bearer sk-demo-ye' "http://127.0.0.1:$port/v1/billing/usage")"
  echo "through 127.0.0.1:$port: $out"
  [[ "$out" == *'"nick_name": "ye"'* ]] || { echo "the forwarder did not pass the request on"; return 1; }
}

open build/QuotaBar.app
check 47831
echo "OK: forwarder on 47831, Desktop moved to it without asking, requests pass"
pkill -x QuotaBar
while pgrep -x QuotaBar >/dev/null; do sleep 0.2; done
while nc -z 127.0.0.1 47831 2>/dev/null; do sleep 0.2; done

# 47831 is taken now: the next port, and Desktop follows (it was on an address of ours).
python3 -c 'import socket,time; s=socket.socket(); s.bind(("127.0.0.1",47831)); s.listen(); time.sleep(120)' &
BUSY=$!
sleep 1
open build/QuotaBar.app
grep -o '"forwardPort" : [0-9]*' "$DIR/config.json" || true
check 47832
echo "OK: 47831 taken, forwarder on 47832, Desktop followed without asking"
grep -o '"forwardPort" : [0-9]*' "$DIR/config.json"
grep -q '"inferenceGatewayApiKey":"__sealed__:v1:x"' "$TMP/desktop/configLibrary/$ID.json" && echo "OK: Desktop's key left as it was"
