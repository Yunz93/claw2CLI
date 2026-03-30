# Technical Docs | 技术文档

This file contains the implementation-level documentation for `claw2cli`.

本文档包含 `claw2cli` 的实现细节。

## API | 接口

### `GET /healthz`

Health check.  
健康检查。

### `GET /sessions`

Debug view of in-memory sidecar sessions.  
查看 sidecar 当前内存中的 session。

### `POST /sessions/open`

```json
{
  "sessionId": "wx:chat_id",
  "backend": "codex",
  "cwd": "/path/to/workspace"
}
```

### `POST /sessions/send`

```json
{
  "sessionId": "wx:chat_id",
  "message": "hello"
}
```

### `GET /sessions/events?sessionId=wx:chat_id`

Read buffered events for the session.  
读取 session 的缓冲事件。

### `POST /sessions/wait`

```json
{
  "sessionId": "wx:chat_id",
  "timeoutMs": 1800000
}
```

For oneshot backends such as `codex`, `claude`, `kimi`, and `codex-echo`, the final answer is returned in `finalText`.

对于 `codex`、`claude`、`kimi`、`codex-echo` 这类 oneshot backend，最终答案会出现在 `finalText`。

### `POST /sessions/close`

```json
{
  "sessionId": "wx:chat_id"
}
```

## Environment Variables | 环境变量

### Sidecar

- `MAC_CLI_BRIDGE_PORT`: HTTP port, default `4317`
- `MAC_CLI_BRIDGE_ONESHOT_STALE_MS`: stale timeout for oneshot sessions, default `15000`

### Trigger / adapter

- `MAC_CLI_BRIDGE_PROJECT_ROOT`: base directory used for `/codex <project-name>` resolution
- `MAC_CLI_BRIDGE_CWD`: default workspace used by the trigger and adapter
- `MAC_CLI_BRIDGE_URL`: sidecar base URL, default `http://127.0.0.1:4317`
- `MAC_CLI_BRIDGE_BACKEND`: backend name used by the adapter, default `codex-exec`; supported aliases include `codex`, `cc`, `claude`, and `kimi`
- `MAC_CLI_BRIDGE_TIMEOUT_MS`: wait timeout for adapter calls, default `1800000`

## OpenClaw Integration | OpenClaw 集成

Reference scripts:

- [`wechat-trigger.js`](./wechat-trigger.js)
- [`wechat-auto-reply.js`](./wechat-auto-reply.js)
- [`openclaw-adapter.sh`](./openclaw-adapter.sh)
- [`WEIXIN_PLUGIN_PATCH.md`](./WEIXIN_PLUGIN_PATCH.md)

Start the sidecar first:

```bash
cd /path/to/claw2cli
node src/server.js
```

Then invoke the adapter:

```bash
/path/to/claw2cli/openclaw-adapter.sh wx:test "Reply with exactly: bridge-ok"
```

Or simulate a WeChat command directly:

```bash
node /path/to/claw2cli/wechat-trigger.js test-chat "/codex list"
```

For the Weixin-side integration changes, see [`WEIXIN_PLUGIN_PATCH.md`](./WEIXIN_PLUGIN_PATCH.md).

## Launchd Template | launchd 模板

A public-safe launchd template is included at [`launchd/claw2cli.plist`](./launchd/claw2cli.plist).

公开可用的 launchd 模板位于 [`launchd/claw2cli.plist`](./launchd/claw2cli.plist)。

Replace `__PROJECT_ROOT__` with your local absolute path before loading it.

使用前把 `__PROJECT_ROOT__` 替换成你本机的绝对路径。

## Repository Notes | 仓库说明

- Runtime state file `state/recent-sessions.json` is ignored and should not be committed
- `.DS_Store` is ignored
- Paths in scripts and docs are written as placeholders or resolved from script location

- 运行时状态文件 `state/recent-sessions.json` 已加入忽略规则，不应提交
- `.DS_Store` 已加入忽略规则
- 脚本和文档里的路径已改为占位形式或基于脚本位置自动解析

## Project Structure | 目录结构

```text
claw2cli/
├── src/
│   ├── server.js
│   ├── session-store.js
│   ├── codex-discovery.js
│   └── wechat-command.js
├── launchd/
│   └── claw2cli.plist
├── wechat-trigger.js
├── wechat-auto-reply.js
├── openclaw-adapter.sh
└── smoke-auto-reply.sh
```
