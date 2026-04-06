# claw2cli

Local CLI bridge for Codex, Claude Code, and Kimi in WeChat.

中文说明见 [`README.md`](./README.md).

## What it is

`claw2cli` lets you use Codex, Claude Code, or Kimi through WeChat on macOS. It keeps the chat flow in OpenClaw and routes `/codex`, `/cc`, `/claude`, and `/kimi` commands to local CLI sessions.

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

- Start a Codex, Claude Code, or Kimi session from WeChat
- List recent sessions for the selected backend on your Mac
- Re-enter the last session used by the same chat
- Switch sessions by number and continue the conversation
- Explicitly start fresh in a chosen workspace
- Show a clean preview of the target session before you continue

## Before you start

- Tested with OpenClaw `2026.3.12 (6472949)`
- Tested with `@tencent-weixin/openclaw-weixin` `1.0.2`
- You need the `openclaw` CLI available locally
- You need the Weixin channel installed and logged in before `/codex`, `/cc`, `/claude`, or `/kimi` can work
- The Weixin plugin must delegate these commands to `claw2cli`

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
/codex new /Users/yunz/Code/VibeCoding/claw2cli
/codex 2
/codex 2 help me continue the earlier investigation
/cc list
/cc new ../other-project
/claude list
/kimi 2
```

`/codex new {workspace_path}` switches the chat into the target workspace and makes the next message start a fresh session there instead of resuming the previously bound one. It also expands leading `~`, creates the directory if it does not exist yet, and returns a clearer error if the target path exists but is not a directory.

## Weixin side setup

`openclaw-weixin` is the transport layer. It stays responsible for login, message delivery, and active mode switching, while `/codex`, `/cc`, `/claude`, and `/kimi` session policy lives in `claw2cli`.

If you are integrating from a clean OpenClaw Weixin setup, apply the plugin-side patch notes in [`WEIXIN_PLUGIN_PATCH.md`](./WEIXIN_PLUGIN_PATCH.md).

> If you don't know how to adapt it，let codex fix it 🤣

## Requirements

- macOS
- Node.js 18+
- Codex CLI, Claude Code CLI, and Kimi CLI installed for the backends you plan to use
- OpenClaw installed and the Weixin channel enabled

## More details

Technical docs live in [`TECHNICAL.md`](./TECHNICAL.md).
