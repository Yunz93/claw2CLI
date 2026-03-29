# OpenClaw integration (MVP)

当前采用 **sidecar + adapter script** 的方式接入现有 OpenClaw 链路，而不是直接改 OpenClaw 源码。

adapter 当前只支持会自行结束的 `oneshot` backend，包括 Codex、Claude Code 和 Kimi。

## 组件

- sidecar: `claw2cli/src/server.js`
- adapter: `claw2cli/openclaw-adapter.sh`

## 调用方式

```bash
PROJECT_ROOT=/path/to/claw2cli
cd "$PROJECT_ROOT"
node src/server.js
```

另一个 shell：

```bash
"$PROJECT_ROOT/openclaw-adapter.sh" wx:test "Reply with exactly: bridge-ok"
```

## 返回

adapter 会直接返回 sidecar `/sessions/wait` 的 JSON：

```json
{
  "ok": true,
  "sessionId": "wx:test",
  "done": true,
  "finalText": "bridge-ok"
}
```

## 下一步

1. 让 OpenClaw 主 agent 在特定微信消息上调用这个 adapter
2. 把 `finalText` 直接回发微信
3. 增加 message chunking / timeout / interrupt
4. 以后再把 adapter 升级成真正的 OpenClaw tool/runtime
