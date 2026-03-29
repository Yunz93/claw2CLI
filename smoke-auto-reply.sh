#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_URL="${MAC_CLI_BRIDGE_URL:-http://127.0.0.1:4317}"
BACKEND="${MAC_CLI_BRIDGE_BACKEND:-codex-echo}"
if ! curl -sf "$BRIDGE_URL/healthz" >/dev/null; then
  echo "bridge not running at $BRIDGE_URL" >&2
  exit 2
fi
MAC_CLI_BRIDGE_URL="$BRIDGE_URL" \
MAC_CLI_BRIDGE_BACKEND="$BACKEND" \
node "$SCRIPT_DIR/wechat-auto-reply.js" test-chat '/codex bridge-ok'
