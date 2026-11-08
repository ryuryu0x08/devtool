#!/bin/bash
# The built app, for real (Linux, under a virtual display): it reads its saved config, relays a
# request with a token to the upstream with the upstream's key, on this machine and from the local
# network (the config has it on), and a second launch leaves the first one serving. Usage: ci/app_e2e.sh <path to the app binary>
set -euo pipefail
# The path as given, from where the script was started (before moving to apps/relay).
APP="$(realpath "$1")"
cd "$(dirname "$0")/.."
TMP="$(mktemp -d)"
export XDG_CONFIG_HOME="$TMP/config"
DIR="$XDG_CONFIG_HOME/com.devtool.relay"
mkdir -p "$DIR"
PORT=18790 UP=18791
TOKEN="rl-ci-token-0123456789"
HASH="$(printf '%s' "$TOKEN" | sha256sum | cut -d' ' -f1)"
cat > "$DIR/config.json" <<JSON
{ "port": $PORT, "lan": true, "routes": [ { "id": "r1", "name": "主线", "protocol": "anthropic",
  "upstreams": [ { "id": "u1", "name": "stand-in", "baseUrl": "http://127.0.0.1:$UP/api", "key": "sk-upstream-key", "auth": "bearer" } ],
  "tokens": [ { "id": "t1", "name": "ci", "hash": "$HASH", "hint": "rl-ci…6789", "created": 1 } ] } ] }
JSON

python3 ci/fake_upstream.py $UP "$TMP/seen.json" &
FAKE=$!
# One session bus for both launches (the single-instance check finds the first one there).
BUS="$(dbus-daemon --session --fork --print-address=1 --print-pid=1)"
export DBUS_SESSION_BUS_ADDRESS="$(echo "$BUS" | head -1)"
BUS_PID="$(echo "$BUS" | tail -1)"
cleanup() { kill $FAKE "$BUS_PID" 2>/dev/null || true; pkill -f "$APP" 2>/dev/null || true; }
trap cleanup EXIT

# The app, under a virtual display.
xvfb-run -a -s "-screen 0 1280x860x24" "$APP" >"$TMP/app.log" 2>&1 &
for _ in $(seq 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
curl -s -o /dev/null "http://127.0.0.1:$PORT/" || { echo "the app's relay did not start"; cat "$TMP/app.log"; exit 1; }
echo "OK: the app started and listens on $PORT"

# No token: turned away by the app.
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/v1/messages")"
[[ "$code" == 401 ]] || { echo "no token: expected 401, got $code"; exit 1; }
# With the token: to the upstream, with its key as Bearer, the path after its prefix.
out="$(curl -sS -X POST -H "x-api-key: $TOKEN" -H 'content-type: application/json' -d '{"model":"m"}' "http://127.0.0.1:$PORT/v1/messages?beta=true")"
echo "reply: $out"
python3 - "$TMP/seen.json" "$TOKEN" <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
assert s["path"] == "/api/v1/messages?beta=true", s
assert s["authorization"] == "Bearer sk-upstream-key", s
assert s["x-api-key"] is None, s
assert s["body"] == '{"model":"m"}', s
assert sys.argv[2] not in json.dumps(s), "the token reached the upstream"
print("OK: relayed with the upstream's key, the token kept back")
PY

# From the local network: this machine's private address reaches it too (it listens on 0.0.0.0).
LAN="$(hostname -I | tr ' ' '\n' | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -1 || true)"
[[ -n "$LAN" ]] || { echo "no private address on this machine to test the local network with"; exit 1; }
code="$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -H "x-api-key: $TOKEN" -X POST "http://$LAN:$PORT/v1/messages")"
[[ "$code" == 200 ]] || { echo "from the local network ($LAN): expected 200, got $code"; exit 1; }
echo "OK: reached from the local network at $LAN:$PORT"

# A second launch: it hands over to the first one and quits; the first keeps serving.
start=$(date +%s)
xvfb-run -a -s "-screen 0 1280x860x24" timeout 20 "$APP" >"$TMP/second.log" 2>&1 || true
took=$(( $(date +%s) - start ))
[[ $took -lt 15 ]] || { echo "the second launch kept running (${took}s)"; exit 1; }
curl -s -o /dev/null -w '%{http_code}' -H "x-api-key: $TOKEN" -X POST "http://127.0.0.1:$PORT/v1/messages" | grep -q 200 || { echo "the first app stopped serving"; exit 1; }
echo "OK: a second launch left the first one serving (${took}s)"

# The saved config was not rewritten with the token or changed by starting.
grep -q "$TOKEN" "$DIR/config.json" && { echo "the token's text is in the config"; exit 1; }
echo "OK: the app end to end"
