#!/bin/bash
set -euo pipefail
curl -s -X POST http://127.0.0.1:4317/sessions/close -H 'content-type: application/json' -d '{"sessionId":"wx:test-chat"}' || true
curl -s -X POST http://127.0.0.1:4317/sessions/close -H 'content-type: application/json' -d '{"sessionId":"wx:test-trigger"}' || true
curl -s -X POST http://127.0.0.1:4317/sessions/close -H 'content-type: application/json' -d '{"sessionId":"wx:codex"}' || true
