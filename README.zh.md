# ACPilot

[English](README.md) | 简体中文

一个聊天壳，装在 VS Code / Cursor 的副侧栏里，通过 [ACP](https://agentclientprotocol.com)（JSON-RPC over stdio）驱动官方 agent CLI：

- `grok agent stdio`
- `devin acp`
- `kimi acp`
- 任何支持 ACP 的命令（`acpilot.agents` 里追加）

壳只管界面、会话组织、权限审批、账号与上下文预算；模型调用、Agent 执行、上下文压缩本身全部留给 CLI。

## 用

1. 装好 CLI（Grok / Kimi 在自己的终端里登录；Devin 见下）
2. 打开副侧栏的 ACPilot 视图，下方工具行切 agent / 模式 / 模型
3. 输入即发；进行中再发会排队；方块钮取消

### 图片与文件

- 直接粘贴 / 拖入图片（PNG · JPEG · GIF · WebP，≤ 10 MB）：以 base64 内联进 prompt。Grok 虽然在 `initialize` 里报 `image: false`，实测照样看得见，所以不看这个标志
- 从资源管理器拖文件进输入框，或输入 `@` 搜索工作区文件：作为 `resource_link` 发送，agent 自己去读（拖进来的图片文件会被读成图片发出）
- 从 Finder 拖入的文本文件（≤ 256 KB）：webview 拿不到路径，内容内嵌为 `resource` 块；二进制文件拒收

会话记录落在扩展的 globalStorage 里，重启后优先 `session/resume`，其次 `session/load`，都不支持就只读历史。

### Devin 多账号

Devin 的 ACP 模式不读本地登录，凭据由 ACPilot 在开会话时交给它，因此可以存多份账号、按会话切换（一个 Max 额度用完换另一个）：

- agent Chip 菜单下半段是账号列表：选一个 → 用它开新会话；「导入本机 CLI 登录」读 `~/.local/share/devin/credentials.toml`；「在终端登录新账号…」在隔离目录里跑一次 `devin auth login`，不动本机已有登录，服务器上也能用（复制链接 → 粘贴 code）
- 密钥只进系统钥匙串（VS Code SecretStorage），`accounts.json` 里只有邮箱 / 套餐这类元信息；会话记录里只有账号 id
- 一条会话从头到尾绑一个账号；Notice 上的「Log in with browser（仅本次）」是 Devin 自带的浏览器登录，只认证当前进程，不保存

### 自动压缩

一轮结束后上下文用量达到 `acpilot.compactAtTokens`（默认 300k）就自动给 agent 发 `/compact`（`acpilot.autoCompact`，默认开）；上下文环里也能手动压。只对报 usage 且有 `/compact` 命令的 agent 生效（Devin / Grok 都有）。

## 开发

```sh
pnpm install
pnpm build          # host（esbuild）+ webview（Vite）
pnpm probe grok     # 直接对 CLI 跑 initialize + session/new
pnpm probe devin --import-local "Reply pong"   # 走账号层：导入本机登录 → authenticate → 一轮
pnpm typecheck && pnpm test
pnpm package        # 打 .vsix
```

F5 起 Extension Development Host。日志在 Output → ACPilot。架构图与协议坑见 [AGENTS.md](AGENTS.md)。
