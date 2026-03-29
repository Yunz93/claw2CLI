# WeChat trigger (MVP)

当前实现的是 **最小上线模式**：

- 只有以 `/codex`、`/cc`、`/claude` 或 `/kimi` 开头的微信消息才触发 bridge
- 其它消息直接忽略
- 当前 adapter 只支持会结束的 `oneshot` backend
- `/codex list`、`/cc list`、`/claude list`、`/kimi list` 默认只展示最近激活的 5 个对应 backend session
- `/codex {编号}`、`/cc {编号}`、`/claude {编号}`、`/kimi {编号}` 可以切换到目标 session；如果只发编号，会直接回最近两条消息预览

## 触发器脚本

- `claw2cli/wechat-trigger.js`

## 用法

先确保 sidecar 已常驻启动（推荐 launchd 单实例常驻），不要每次触发都重复起一个新 server：

```bash
PROJECT_ROOT=/path/to/claw2cli
cd "$PROJECT_ROOT"
node src/server.js
```

再模拟微信消息触发：

```bash
node "$PROJECT_ROOT/wechat-trigger.js" \
  o9cq80_EfrcDvilGHP5_xvHSzQSg@im.wechat \
  "/codex Reply with exactly: bridge-ok"
```

查看最近 session：

```bash
node "$PROJECT_ROOT/wechat-trigger.js" \
  o9cq80_EfrcDvilGHP5_xvHSzQSg@im.wechat \
  "/cc list"
```

切到第 2 个 session 并继续提问：

```bash
node "$PROJECT_ROOT/wechat-trigger.js" \
  o9cq80_EfrcDvilGHP5_xvHSzQSg@im.wechat \
  "/kimi 2 帮我继续刚才那个排查"
```

## 返回

成功时返回：

```json
{
  "ok": true,
  "triggered": true,
  "sessionId": "wx:o9cq80...",
  "result": {
    "ok": true,
    "done": true,
    "finalText": "bridge-ok"
  }
}
```

## 下一步

1. 把这个触发器接进当前 OpenClaw 主会话逻辑
2. 在命中 `/codex`、`/cc`、`/claude` 或 `/kimi` 前缀时自动调用
3. 直接把 `result.finalText` 回发微信
4. 增加消息切片和超时提示
