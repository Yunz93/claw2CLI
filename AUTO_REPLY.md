# Auto reply (MVP)

这是最后一层闭环脚本：

- 输入：微信 chat_id + 原始消息文本
- 规则：只有 `/codex` 前缀才触发
- 输出：返回 `replyText`，供 OpenClaw 主会话直接发回微信

## 用法

```bash
PROJECT_ROOT=/path/to/claw2cli
cd "$PROJECT_ROOT"
node src/server.js
```

注意：生产态应该让 sidecar 在 4317 端口**单实例常驻**，自动回微信脚本只负责调用，不负责重复启动 sidecar。

另一个 shell：

```bash
node "$PROJECT_ROOT/wechat-auto-reply.js" \
  test-chat \
  "/codex Reply with exactly: bridge-ok"
```

## 结果

```json
{
  "ok": true,
  "triggered": true,
  "shouldReply": true,
  "replyText": "bridge-ok"
}
```

## 当前已识别并执行的优化项

- 单实例 sidecar 常驻，不再每次触发重复起 server
- oneshot session 检测 stale/死进程后自动重建
- wait 超时后自动 close，避免脏 session 长驻
- 增加 `/sessions` 调试接口，方便排查会话状态
- adapter 只接受 `oneshot` backend，避免 interactive backend 一直挂住
- 持久化 recent session 索引，支持 `/codex list`
- 支持 `/codex {编号}` 切换最近会话，并读取目标 session 最后两条消息

## 下一步

把这个脚本接入当前 OpenClaw 主消息处理逻辑：

- 命中 `/codex` 时执行脚本
- 读取 `replyText`
- 用当前会话直接回微信
