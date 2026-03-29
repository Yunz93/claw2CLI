# claw2cli

Local CLI bridge sidecar for OpenClaw on macOS.  
OpenClaw 的本地 CLI bridge sidecar，面向 macOS 场景。

## Overview | 项目简介

`claw2cli` keeps the existing OpenClaw message path and inserts a small local bridge for Codex-style CLI execution.

`claw2cli` 不重写微信协议，而是在现有 OpenClaw 链路里补一层本地 bridge，用来承接 Codex 风格的 CLI 会话。

Message flow:

- `WeChat -> OpenClaw -> claw2cli -> local CLI`
- `local CLI -> claw2cli -> OpenClaw -> WeChat`

## Features | 当前功能

- Sidecar HTTP server with session lifecycle APIs
- `codex-echo` backend for smoke testing
- `codex-exec` backend for real Codex one-shot execution
- `/codex list` lists real Codex sessions discovered from macOS
- Session list is deduplicated by workspace, keeping only the most recently activated session per workspace
- Session list shows `session_id`, workspace, last activation time, and a preview of the latest message
- `/codex <index>` switches to the selected session
- `/codex <index> <message>` continues the selected session directly
- Empty `/codex` re-enters the last bridge-selected session for the current chat; on first use, it returns the session list instead
- Messages sent to Codex are forwarded as raw user text without extra bridge system prompts

- sidecar HTTP 服务和 session 生命周期接口
- `codex-echo` backend 用于联调和 smoke test
- `codex-exec` backend 用于真实 Codex 单轮执行
- `/codex list` 会枚举 mac 本机上的真实 Codex session
- 列表按工作空间去重，同一工作空间只保留最近激活的一条
- 列表展示 `session_id`、工作空间、上次激活时间、最后一条消息缩略信息
- `/codex <编号>` 可切到目标 session
- `/codex <编号> <消息>` 可直接续聊目标 session
- 空 `/codex` 会优先接回当前微信会话最近一次 bridge 使用的 session；首次使用则直接返回列表供选择
- 发给 Codex 的内容保持用户原文，不附加 bridge 层 system prompt

## Requirements | 运行要求

- macOS
- Node.js 18+
- Codex CLI installed at `/opt/homebrew/bin/codex` for `codex-exec`
- OpenClaw integration on the caller side

## Quick Start | 快速开始

### 1. Install dependencies | 安装依赖

This project currently has no external npm dependencies.

当前项目没有额外 npm 依赖，直接使用 Node.js 即可。

### 2. Start the sidecar | 启动 sidecar

```bash
cd /path/to/claw2cli
npm start
```

The server listens on `http://127.0.0.1:4317` by default.

默认监听地址为 `http://127.0.0.1:4317`。

### 3. Run tests | 运行测试

```bash
npm test
```

## WeChat Command Behavior | 微信命令行为

### `/codex`

- Re-enter the last bridge-selected session for the current chat
- If the chat has never selected a session before, return `/codex list` output instead

- 重新进入当前微信会话上次通过 bridge 选中的 session
- 如果这个微信会话还没有选中过 session，就直接返回 `/codex list` 的结果

### `/codex list`

- Lists recent real Codex sessions from the local macOS machine
- Default limit is `5`
- Output is deduplicated by workspace

- 列出本机 macOS 上最近的真实 Codex session
- 默认最多返回 `5` 条
- 结果按工作空间去重

### `/codex <index>`

- Activates the selected session
- Returns the last two recorded messages as preview

- 激活目标 session
- 返回该 session 最近两条消息作为预览

### `/codex <index> <message>`

- Activates the selected session
- Sends `<message>` to Codex immediately

- 激活目标 session
- 立刻把 `<消息>` 发送给 Codex

## HTTP API | HTTP 接口

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
  "backend": "codex-exec",
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
  "timeoutMs": 120000
}
```

For oneshot backends such as `codex-exec` and `codex-echo`, the final answer is returned in `finalText`.

对于 `codex-exec`、`codex-echo` 这类 oneshot backend，最终答案会出现在 `finalText`。

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
- `MAC_CLI_BRIDGE_BACKEND`: backend name used by the adapter, default `codex-exec`
- `MAC_CLI_BRIDGE_TIMEOUT_MS`: wait timeout for adapter calls, default `120000`

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

For the required Weixin-side integration changes, see:

微信插件侧需要配合的改动，见：

- [`WEIXIN_PLUGIN_PATCH.md`](./WEIXIN_PLUGIN_PATCH.md)

## Launchd Template | launchd 模板

A public-safe launchd template is included at:

公开可用的 launchd 模板位于：

- [`launchd/claw2cli.plist`](./launchd/claw2cli.plist)

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

## Status | 当前状态

This project is still an MVP, but the documented flow above is implemented and covered by basic tests.

当前项目仍然是 MVP，但上面列出的行为已经落地，并有基础测试覆盖。
