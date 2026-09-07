# 压缩期间跟进消息排队

核验日期：2026-09-07。范围为本机注册的 Devin、Grok、Kimi ACP CLI，以及 ACPilot 的真实 AcpSession 队列。探针使用新建临时目录、新会话和 160 条合成记录，禁用工具调用，未复用现有工作会话。

## 根因

调用链为 Composer → `send` → `SessionManager.handle` → `AcpSession.prompt`。队列由 ACPilot 管理，`running` 为真时保存跟进消息。旧实现收到 `session/prompt` 的 `end_turn` 后立即 `settle`，清除 `running` 并发送队列。

Devin 和 Kimi 的 `/compact` 会提前返回，后台压缩仍在执行。旧实现将请求返回误判为压缩完成，下一条消息提前到达 CLI。

| CLI | 本机版本 | 直接发送的实测结果 |
| --- | --- | --- |
| Devin | 3000.6.14，18033302 | `/compact` 在约 1 ms 内返回；第一条 `Compacting context…` 甚至晚于返回。紧接着发送跟进消息会得到 `Compaction canceled.`。单独压缩约 9.5 秒后才出现 `Context compacted` |
| Kimi | 0.41.0 | `/compact` 约 32 ms 返回，正文说明后台执行。跟进消息约 24 ms 返回 `end_turn`，未输出回复标记；约 21 秒后压缩正常完成，仍无跟进回复标记 |
| Grok | 1.0.18，ea950872ad51 | 本次 `/compact` 请求持续约 54.5 秒才返回，随后跟进消息正常回复。未观察到 Devin 式取消 |

Kimi 安装包中的 ACP 适配器进一步印证了行为：`driveBuiltinCommand` 只等待命令启动；压缩结束由独立订阅发送 `Compaction completed.`。`driveLaunch` 对未启动的轮次也会返回 `end_turn`。实测证明了跟进请求提前结束且回复没有传回；仅凭这些结果不能断言底层消息永久丢失。

上述耗时仅用于判定事件顺序，不构成性能对比。

## 修复

- Devin、Kimi 的显式 `/compact` 在发出前建立完成等待状态，覆盖返回早于首个通知的时序。
- 收到 CLI 的完成、取消、失败文本后再释放队列。识别仅作用于这两个适配器的压缩命令，支持文本分片及 `/compact` 后附加指令。
- 标准 `compaction_update` 按 compactionId 跟踪；已开始的结构化压缩须收到终止状态才允许释放队列。
- 手动和 ACPilot 自动压缩共用该路径。进程退出、请求报错、会话关闭均结束本地等待，关闭会话时不发送待排队消息。
- Grok 保持请求期间排队的行为。生产逻辑没有通过定时延迟判断完成。

Devin、Kimi 当前手动压缩只发普通文本，兼容层依赖已核验的 CLI 状态文案。未知自定义 ACP 的后台文本语义未作普遍保证。

## 修复后真实调用

| CLI | 关键顺序，探针启动后的毫秒数 | 结果 |
| --- | --- | --- |
| Devin | 3992：压缩请求返回、跟进进入队列；11684：`Context compacted`；11689：发送跟进；12819：`FOLLOWUP_OK` | 压缩未取消，跟进正常回复 |
| Kimi | 10731：压缩请求返回、跟进进入队列；28721：`Compaction completed`、发送跟进；33361：`FOLLOWUP_OK` | 跟进等待压缩完成，正常回复 |
| Grok | 6530：发送压缩；7031：跟进进入队列；21696：压缩请求返回、发送跟进；25591：`FOLLOWUP_OK` | 压缩期间排队，正常回复 |

回归测试包含延迟首个通知、结构化事件、自动压缩、取消及失败文案、关闭会话释放等待。新增队列集成用例在旧实现下 6 个全部失败，修复后通过。

## 复现命令

```sh
# 绕过宿主队列，检查 CLI 返回与压缩状态的时序。
pnpm tsx scripts/probe-compaction.ts devin --follow-up
pnpm tsx scripts/probe-compaction.ts kimi --follow-up
pnpm tsx scripts/probe-compaction.ts grok --follow-up

# 使用真实宿主队列验证，Devin 凭据仅在内存中读取和交接。
pnpm tsx --tsconfig tsconfig.host.json scripts/probe-compaction-queue.ts devin
pnpm tsx --tsconfig tsconfig.host.json scripts/probe-compaction-queue.ts kimi
pnpm tsx --tsconfig tsconfig.host.json scripts/probe-compaction-queue.ts grok --during

pnpm exec tsc -p tsconfig.host.json --noEmit
pnpm test
pnpm build
```

## 验证边界

全量类型检查通过，全量 Vitest 为 12 个文件、102 个用例通过，Host bundle 编译通过。Webview 构建仍在同一工作区的其他前端变更处失败：`src/webview/main.tsx` 无法解析 `katex/dist/katex.min.css`。当前修复未安装进 Cursor，安装版仍需后续更新。

另行确认：本次核验时 `acpilot.followUp` 已有设置 UI 和持久化，`SessionManager.handle` 的发送路径尚未读取该值，实际全部经过同一宿主队列。压缩排队修复未扩展为实现 steer / interrupt 设置。
