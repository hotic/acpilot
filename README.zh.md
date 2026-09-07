# ACPilot

面向 VS Code / Cursor 的 ACP 编程 Agent 聊天界面。

[English](README.md) · **简体中文**

ACPilot 位于副侧栏，通过 [ACP](https://agentclientprotocol.com)（JSON-RPC over stdio）驱动官方 Agent CLI：

- `grok agent stdio`
- `devin acp`
- `kimi acp`
- 任何兼容 ACP 的命令（通过 `acpilot.agents` 添加）

界面、会话、权限审批、账号与上下文预算由扩展管理；模型调用、Agent 执行与上下文压缩仍由各 CLI 完成。

- **接入已有 Agent：** 从输入框下方的工具栏驱动 Grok、Devin、Kimi Code，或任何兼容 ACP 的命令。
- **会话与权限：** 在侧栏中组织对话，并在工具运行前审批权限。
- **多账号：** 为每个 Agent 保存多份登录，切换账号即创建新会话。
- **图片、文件与队列：** 粘贴或拖入图片，用 `@` 附加工作区文件。当前回合进行中发送的消息会进入队列。

## 开始使用

1. 安装 Agent CLI 并登录。在 Agent 菜单中添加或切换账号，详见 [账号](#账号)。
2. 打开副侧栏中的 ACPilot 视图。
3. 在输入框下方的工具栏中选择 Agent、模式与模型，然后发送消息。回合进行中发送的后续消息会进入队列。点击方形按钮可取消当前回合。

### 图片与文件

- 支持粘贴或拖入 PNG、JPEG、GIF、WebP 图片（最大 10 MB），图片会随消息发送。
- 从资源管理器拖入文件，或输入 `@` 搜索工作区文件，由 Agent 自行读取。从资源管理器拖入的图片文件会作为图片发送。
- 从系统文件管理器拖入的文本文件（最大 256 KB）会嵌入消息。不支持二进制文件。

会话记录保存在扩展的全局存储中。重启后，若 Agent 支持恢复，ACPilot 会继续该会话；否则历史记录以只读方式保留。上下文用量较高时，ACPilot 可自动发送 `/compact`，也可以在上下文面板中手动压缩。

### 账号

ACPilot 可为每个 Agent 保存多份登录，并在创建会话时注入凭据。每个会话绑定一个账号，选择另一账号会创建新会话。

- Agent 菜单的下半部分列出已保存的账号，选择一项即可用该账号创建新会话。「导入 CLI 登录」读取该 CLI 本机已有的登录（Devin 为 `~/.local/share/devin/credentials.toml`）。「在终端登录」在隔离目录中运行该 Agent 的登录命令，不影响本机已有登录。远程服务器上同样可用：复制链接并粘贴验证码。
- 密钥保存在系统钥匙串（VS Code SecretStorage）中。`accounts.json` 仅保存邮箱、套餐等元信息。会话记录只存储账号 id。
- 每个会话自始至终绑定一个账号。登录提示上的「仅本次」选项（例如 Devin 的「浏览器登录」）只认证当前进程，不会保存。

尚未提供账号列表的 Agent，仍使用各自 CLI 的登录。

## 开发

```sh
pnpm install
pnpm build          # host（esbuild）+ webview（Vite）
pnpm probe grok     # 直接对 CLI 跑 initialize + session/new
pnpm probe devin --import-local "Reply pong"   # 走账号层：导入本机登录 → authenticate → 一轮
pnpm typecheck && pnpm test
pnpm package        # 打 .vsix
```

按 F5 启动 Extension Development Host。日志在 Output → ACPilot。架构与协议说明见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)
