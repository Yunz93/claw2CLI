# claw2cli

Local CLI bridge for Codex in WeChat.

中文说明见 [`README.md`](./README.md).

## What it is

`claw2cli` lets you use Codex through WeChat on macOS. It keeps the chat flow in OpenClaw and routes `/codex` commands to a local CLI session.

This project is not standalone. It requires OpenClaw and the Weixin channel plugin.

## Preview

<p align="center">
  <img src="./assets/preview/wechat-codex-list.jpg" alt="WeChat /codex list preview" width="45%" />
  <img src="./assets/preview/wechat-codex-session.jpg" alt="WeChat /codex session preview" width="45%" />
</p>

<p align="center">
  <sub>WeChat preview of <code>/codex list</code> and session handoff</sub>
</p>

## What it can do

- Start a Codex session from WeChat
- List recent Codex sessions on your Mac
- Re-enter the last session used by the same chat
- Switch sessions by number and continue the conversation
- Show a clean preview of the target session before you continue

## Before you start

- Tested with OpenClaw `2026.3.12 (6472949)`
- Tested with `@tencent-weixin/openclaw-weixin` `1.0.2`
- You need the `openclaw` CLI available locally
- You need the Weixin channel installed and logged in before `/codex` can work
- The Weixin plugin must delegate `/codex` handling to `claw2cli`

## How to use

### 1. Start the bridge

```bash
cd /path/to/claw2cli
npm start
```

### 2. In WeChat, send `/codex`

If this chat has already used a session before, `claw2cli` jumps back to that one. If not, it shows the recent session list.

### 3. Pick a session or continue chatting

```text
/codex list
/codex 2
/codex 2 help me continue the earlier investigation
```

## Weixin side setup

`openclaw-weixin` is the transport layer. It stays responsible for login, message delivery, and active mode switching, while `/codex` session policy lives in `claw2cli`.

If you are integrating from a clean OpenClaw Weixin setup, apply the plugin-side patch notes in [`WEIXIN_PLUGIN_PATCH.md`](./WEIXIN_PLUGIN_PATCH.md).

> If you don't know how to adapt it，let codex fix it 🤣

## Requirements

- macOS
- Node.js 18+
- Codex CLI installed for `codex-exec`
- OpenClaw installed and the Weixin channel enabled

## More details

Technical docs live in [`TECHNICAL.md`](./TECHNICAL.md).
