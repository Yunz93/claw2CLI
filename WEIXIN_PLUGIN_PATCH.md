# OpenClaw Weixin Plugin Patch Notes

This file documents the minimal changes required in the `openclaw-weixin` plugin to integrate `claw2cli`.

本文档整理 `openclaw-weixin` 插件侧为接入 `claw2cli` 所需的最小改动，方便开源时单独说明边界。

## Goal | 目标

Keep Weixin as a transport adapter and move `/codex` session logic into `claw2cli`.

让微信插件只负责消息通道和状态切换，把 `/codex` 的 session 发现、列表、选择和续聊逻辑下沉到 `claw2cli`。

## Files Touched | 涉及文件

- `src/messaging/slash-commands.ts`
- `src/messaging/codex-session.ts`

Plugin path in the current local setup:

当前本机上的插件路径：

- `/Users/yunz/.openclaw/extensions/openclaw-weixin/src/messaging/slash-commands.ts`
- `/Users/yunz/.openclaw/extensions/openclaw-weixin/src/messaging/codex-session.ts`

## Required Changes | 必要修改

### 1. Route `/codex` through `claw2cli`

`slash-commands.ts` should stop implementing `/codex` business rules locally and always delegate the raw command text to `claw2cli`.

`slash-commands.ts` 不再自己实现 `/codex` 的业务分支，而是把原始 `/codex ...` 文本统一交给 `claw2cli`。

What the plugin still does:

- authorization check
- call bridge script
- update local active mode based on bridge metadata
- send `replyText` back to WeChat

插件层仍保留的职责：

- 权限校验
- 调用 bridge 脚本
- 根据 bridge 返回的 metadata 更新本地 active mode
- 把 `replyText` 回发给微信

What the plugin should not do anymore:

- scan Codex session files itself for `/codex list`
- implement its own recent-session ranking
- implement its own workspace dedupe policy
- decide prompt wrapping rules for Codex input

插件层不应再做的事：

- 自己扫描 Codex session 文件来实现 `/codex list`
- 自己实现 recent session 排序
- 自己实现按工作空间去重
- 自己决定发给 Codex 的 prompt 包装规则

### 2. Accept bridge metadata

`codex-session.ts` needs to accept and persist metadata returned by `claw2cli`:

- `modeAction`
- `commandType`
- `cwd`
- `projectName`
- `codexSessionId`

`codex-session.ts` 需要接收并保存 `claw2cli` 返回的 metadata，用来同步插件本地状态：

- `modeAction`
- `commandType`
- `cwd`
- `projectName`
- `codexSessionId`

`modeAction` drives session mode transitions:

- `enable`: keep Codex mode active and update session state
- `keep`: do not change active mode, but allow informational replies such as `/codex list`
- `disable`: exit Codex mode and clear plugin-side session state

### 3. Forward plain follow-up messages in active mode

When Codex mode is active and the user sends a non-slash message, the plugin should forward it through the same bridge entrypoint.

当 Codex mode 已激活且用户发送普通文本时，插件应继续通过同一个 bridge 入口转发。

Current implementation detail:

- plain messages are normalized to `/codex <user_message>` before invoking `wechat-auto-reply.js`

当前实现细节：

- 普通文本会先被规范成 `/codex <用户消息>`，再调用 `wechat-auto-reply.js`

### 4. Keep script paths configurable

The plugin currently relies on environment variables for bridge integration and should keep doing so:

- `MAC_CLI_BRIDGE_AUTO_REPLY_SCRIPT`
- `MAC_CLI_BRIDGE_NODE_BIN`
- `MAC_CLI_BRIDGE_TIMEOUT_MS`
- `MAC_CLI_BRIDGE_PROJECT_ROOT`
- `MAC_CLI_BRIDGE_CWD`
- `MAC_CLI_BRIDGE_URL`
- `MAC_CLI_BRIDGE_BACKEND`

插件与 bridge 的连接应继续保持环境变量可配置，不要把 `claw2cli` 路径硬编码成私有机器路径。

## Behavioral Contract | 行为约定

The plugin can assume:

- `claw2cli` fully owns `/codex list`
- `claw2cli` fully owns numbered session selection
- `claw2cli` decides whether the next step is `enable`, `keep`, or `disable`
- `replyText` is already the final user-facing WeChat text

插件可以把下面这些都视为 `claw2cli` 的职责：

- `/codex list` 的结果生成
- 编号选 session 的规则
- 是否 `enable / keep / disable` 的模式切换决策
- 最终返回给微信的文案生成

## Recommended Boundary | 推荐边界

Use this split if the project is going to be open-sourced:

- `openclaw-weixin`: transport adapter only
- `claw2cli`: Codex bridge and session policy owner

如果项目准备开源，推荐边界如下：

- `openclaw-weixin` 只做通道适配
- `claw2cli` 负责 Codex bridge 和 session 策略

This keeps the plugin generic and prevents channel-specific business logic from being duplicated across integrations.

这样做的好处是：微信插件保持通用，渠道相关以外的业务逻辑不会在多个接入层重复实现。
