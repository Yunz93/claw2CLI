# OpenClaw Weixin Plugin Patch Notes

This document describes the minimal plugin-side changes needed for `claw2cli`.

本文档说明接入 `claw2cli` 时，`openclaw-weixin` 侧需要做的最小改动。

## Summary | 一句话说明

`openclaw-weixin` should stay a transport layer. It should forward `/codex` handling to `claw2cli` and only keep login, message delivery, and mode switching.

`openclaw-weixin` 只做通道层适配：把 `/codex` 转交给 `claw2cli`，自己只保留登录、消息收发和模式切换。

## What to change | 需要改什么

### 1. Forward `/codex` to `claw2cli`

`src/messaging/slash-commands.ts` should not implement `/codex` session discovery or session ranking locally. It should pass the raw `/codex ...` text to `claw2cli`.

`src/messaging/slash-commands.ts` 不再本地实现 `/codex` 的 session 发现和排序逻辑，而是把原始 `/codex ...` 文本交给 `claw2cli`。

Keep these responsibilities in the plugin:

- authorization checks
- calling the bridge script
- applying bridge metadata to local active mode
- sending `replyText` back to WeChat

插件层只保留这些职责：

- 权限校验
- 调用 bridge 脚本
- 根据 bridge 返回的 metadata 更新本地 active mode
- 把 `replyText` 回发给微信

Do not keep these responsibilities in the plugin:

- scanning Codex session files for `/codex list`
- maintaining recent-session ranking
- applying workspace dedupe rules
- wrapping the prompt before sending it to Codex

插件层不要再做这些事：

- 自己扫描 Codex session 文件来实现 `/codex list`
- 自己维护 recent session 排序
- 自己实现按工作空间去重
- 自己包装发送给 Codex 的 prompt

### 2. Persist bridge metadata

`src/messaging/codex-session.ts` should accept and store these fields returned by `claw2cli`:

- `modeAction`
- `commandType`
- `cwd`
- `projectName`
- `codexSessionId`

`src/messaging/codex-session.ts` 需要接收并保存 `claw2cli` 返回的这些字段：

- `modeAction`
- `commandType`
- `cwd`
- `projectName`
- `codexSessionId`

`modeAction` means:

- `enable`: keep Codex mode active
- `keep`: leave the current mode unchanged
- `disable`: exit Codex mode and clear plugin-side session state

`modeAction` 的含义：

- `enable`：保持 Codex mode
- `keep`：保持当前状态不变
- `disable`：退出 Codex mode，并清理插件侧 session 状态

### 3. Forward plain follow-up messages

When Codex mode is active and the user sends a normal message, forward it through the same bridge entrypoint.

当 Codex mode 已激活且用户发送普通消息时，继续通过同一个 bridge 入口转发。

Current implementation detail:

- plain messages are normalized to `/codex <user_message>` before invoking `wechat-auto-reply.js`

当前实现方式：

- 普通消息会先被规范成 `/codex <用户消息>`，再调用 `wechat-auto-reply.js`

### 4. Keep paths configurable

Keep bridge integration controlled by environment variables instead of hardcoding private machine paths.

继续用环境变量控制 bridge 集成，不要硬编码私有机器路径。

Supported variables:

- `MAC_CLI_BRIDGE_AUTO_REPLY_SCRIPT`
- `MAC_CLI_BRIDGE_NODE_BIN`
- `MAC_CLI_BRIDGE_TIMEOUT_MS`
- `MAC_CLI_BRIDGE_PROJECT_ROOT`
- `MAC_CLI_BRIDGE_CWD`
- `MAC_CLI_BRIDGE_URL`
- `MAC_CLI_BRIDGE_BACKEND`

支持的环境变量：

- `MAC_CLI_BRIDGE_AUTO_REPLY_SCRIPT`
- `MAC_CLI_BRIDGE_NODE_BIN`
- `MAC_CLI_BRIDGE_TIMEOUT_MS`
- `MAC_CLI_BRIDGE_PROJECT_ROOT`
- `MAC_CLI_BRIDGE_CWD`
- `MAC_CLI_BRIDGE_URL`
- `MAC_CLI_BRIDGE_BACKEND`

## What `claw2cli` owns | `claw2cli` 负责什么

The plugin can assume that `claw2cli` fully owns:

- `/codex list`
- numbered session selection
- the `enable / keep / disable` decision
- the final `replyText`

插件可以直接假设下面这些都由 `claw2cli` 负责：

- `/codex list`
- 编号选择 session
- `enable / keep / disable` 的状态判断
- 最终 `replyText`

## Recommended boundary | 推荐边界

- `openclaw-weixin`: transport adapter only
- `claw2cli`: Codex bridge and session policy owner

- `openclaw-weixin`：只做通道适配
- `claw2cli`：负责 Codex bridge 和 session 策略
