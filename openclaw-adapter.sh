#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BRIDGE_URL="${MAC_CLI_BRIDGE_URL:-http://127.0.0.1:4317}"
SESSION_ID="${1:-}"
PROMPT="${2:-}"
CWD="${3:-${MAC_CLI_BRIDGE_CWD:-$DEFAULT_PROJECT_ROOT}}"
CLI_SESSION_ID="${4:-}"
BACKEND="${5:-${MAC_CLI_BRIDGE_BACKEND:-codex-exec}}"
TIMEOUT_MS="${MAC_CLI_BRIDGE_TIMEOUT_MS:-1800000}"

if [[ -z "$SESSION_ID" || -z "$PROMPT" ]]; then
  echo "usage: $0 <session_id> <prompt> [cwd] [cli_session_id] [backend]" >&2
  exit 2
fi

OPEN_PAYLOAD="$(python3 - "$SESSION_ID" "$BACKEND" "$CWD" "$CLI_SESSION_ID" <<'PY'
import json
import sys

session_id, backend, cwd, codex_session_id = sys.argv[1:5]
payload = {
    "sessionId": session_id,
    "backend": backend,
    "cwd": cwd,
}
if codex_session_id:
    payload["codexSessionId"] = codex_session_id
print(json.dumps(payload))
PY
)"

OPEN_RESPONSE="$(curl -fsS -X POST "$BRIDGE_URL/sessions/open" \
  -H 'content-type: application/json' \
  -d "$OPEN_PAYLOAD")"

OPEN_MODE="$(python3 - "$OPEN_RESPONSE" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
print(payload.get("mode") or "")
PY
)"

if [[ "$OPEN_MODE" != "oneshot" ]]; then
  python3 - "$OPEN_RESPONSE" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
print(json.dumps({
    "ok": False,
    "error": "unsupported_backend_mode",
    "details": response,
}, indent=2))
PY
  exit 1
fi

SEND_PAYLOAD="$(python3 - "$SESSION_ID" "$PROMPT" <<'PY'
import json
import sys

session_id, prompt = sys.argv[1:3]
print(json.dumps({
    "sessionId": session_id,
    "message": prompt,
}))
PY
)"

curl -fsS -X POST "$BRIDGE_URL/sessions/send" \
  -H 'content-type: application/json' \
  -d "$SEND_PAYLOAD" >/dev/null

curl -fsS -X POST "$BRIDGE_URL/sessions/wait" \
  -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SESSION_ID\",\"timeoutMs\":$TIMEOUT_MS}"
