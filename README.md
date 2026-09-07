# ACPilot

A chat interface for ACP coding agents in VS Code and Cursor.

**English** · [简体中文](README.zh.md)

ACPilot lives in the secondary sidebar and drives official agent CLIs over [ACP](https://agentclientprotocol.com) (JSON-RPC over stdio):

- `grok agent stdio`
- `devin acp`
- `kimi acp`
- any ACP-compatible command (added via the `acpilot.agents` setting)

The extension manages the UI, sessions, permission approvals, accounts, and context budget. Model calls, agent execution, and context compaction stay in the CLIs.

- **Bring your own agent:** Drive Grok, Devin, Kimi Code, or any ACP-compatible command from the composer toolbar.
- **Sessions and permissions:** Organize conversations in the sidebar and review tool approvals before they run.
- **Multiple accounts:** Store several logins per agent and start a new session with a different account.
- **Images, files, and queue:** Paste or drop images, attach workspace files with `@`, and queue follow-ups while a turn is running.

## Get started

1. Install the agent CLI and sign in. Add or switch accounts from the agent menu; see [Accounts](#accounts).
2. Open the ACPilot view in the secondary sidebar.
3. Choose an agent, mode, and model from the toolbar below the composer, then send a message. Follow-ups sent mid-turn are queued. The square button cancels the current turn.

### Images and files

- Paste or drop images (PNG, JPEG, GIF, or WebP, up to 10 MB). They are sent with the message.
- Drag files from Explorer into the composer, or type `@` to search the workspace. The agent reads those files itself. Image files dropped from Explorer are sent as images.
- Text files dropped from the system file manager (up to 256 KB) are embedded in the message. Binary files are not supported.

Sessions are stored in the extension's global storage. After a restart, ACPilot resumes the session when the agent allows it; otherwise the transcript remains available as read-only history. When context usage is high, ACPilot can send `/compact` automatically; you can also compact from the context panel.

### Accounts

ACPilot can store several logins per agent and bind one account to each session. Credentials are supplied when a session starts, so picking a different account starts a new session.

- The lower half of the agent menu lists saved accounts. Pick one to start a new session with it. **Import CLI login** reads the CLI’s existing local login (for Devin, `~/.local/share/devin/credentials.toml`). **Sign in in terminal** runs the agent’s login command in an isolated directory and does not change your existing local login. This also works on remote servers: copy the link and paste the code.
- Secrets are stored in the OS keychain (VS Code SecretStorage). `accounts.json` keeps metadata such as email and plan. Transcripts store only the account id.
- Each session is bound to one account. A **this session only** option on the sign-in notice (for example Devin’s **Sign in with browser**) authenticates the current process only and is not saved.

Agents without an account list still use their own CLI login.

## Development

```sh
pnpm install
pnpm build          # host (esbuild) + webview (Vite)
pnpm probe grok     # run initialize + session/new against a CLI directly
pnpm probe devin --import-local "Reply pong"   # via the account layer: import local login → authenticate → one turn
pnpm typecheck && pnpm test
pnpm package        # build a .vsix
```

Press F5 to launch an Extension Development Host. Logs are in Output → ACPilot. See [AGENTS.md](AGENTS.md) for the architecture map and protocol notes.

## License

[MIT](LICENSE)
