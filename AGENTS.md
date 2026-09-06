# ACPilot

A chat shell for VS Code / Cursor that drives official agent CLIs (`grok agent stdio`, `devin acp`, `kimi acp`, or any ACP-compatible command) over [ACP](https://agentclientprotocol.com) (JSON-RPC over stdio). The shell owns UI, session organization, permission approvals, accounts, and context budget; model calls and agent execution stay in the CLIs.

## Commands

- `pnpm build` — host bundle (esbuild → `dist/extension.cjs`) + webview bundle (Vite → `dist/webview/main.{js,css}`)
- `pnpm typecheck` — two tsconfigs (`tsconfig.webview.json` / `tsconfig.host.json`, shared options in `tsconfig.base.json`); the root `tsconfig.json` is a solution file with `references` only, do not add `compilerOptions` to it
- `pnpm test` — vitest; `test/fake-agent.ts` is a fake ACP agent built on the SDK that feeds events to `AcpSession` tests
- `pnpm probe grok [--auth] [--api-key-env VAR] [--import-local] [prompt]` — run `initialize` + `session/new` (+ one prompt) against a CLI without VS Code; use this first when debugging protocol issues
- `pnpm package` — build a `.vsix`

## Architecture

- `src/shared/transcript.ts` — normalized transcript shape, the single contract between host and webview; `SessionView` is the full state pushed to the webview
- `src/shared/protocol.ts` — `HostMsg` / `WebviewMsg` message contract; `src/shared/appearance.ts` — appearance axes
- `src/host/extension.ts` — `activate`: registers the secondary-sidebar WebviewView, editor WebviewPanel, commands, settings listeners
- `src/host/bridge.ts` — one bridge per webview (HTML + CSP); manager events are batched over 30 ms before pushing
- `src/host/SessionManager.ts` — session hub (live processes, summaries, active session); all webview actions enter here; must not import `vscode`
- `src/host/acp/` — `AgentRegistry` (built-in grok / devin / kimi + user-defined via `acpilot.agents`, binary probing), `AgentProcess` (spawn + ndjson + `acp.client`), `AcpSession` (state machine: start → resume | load | new → ready, with auth_required / readonly / error states), `normalize.ts` (`session/update` → blocks, pure functions)
- `src/host/store/TranscriptStore.ts` — `globalStorage/sessions` holds `index.json` + `<id>.json`, writes are debounced
- `src/host/accounts/` — account layer. `types.ts` (`AccountProvider`: importLocal / login / spawnEnv? / authenticate?), `AccountStore` (metadata → `globalStorage/accounts.json`, secrets → `SecretVault`: `context.secrets` in VS Code, `MemoryVault` in tests), `AccountManager` (import / terminal login / removal + two hooks for `AcpSession`), `devin.ts` (first provider). Must not import `vscode`
- `src/webview/` — React UI: `ui/` primitives (Row / Disclosure / Button / Chip / Card / Popover / Menu), `chat/` conversation components, `effects/` visual effects, `styles/tokens.css` design tokens
- `src/webview/` and `src/host/acp/` must never import `vscode`

## Protocol gotchas

Hard-won facts about the ACP implementations we drive; check here before assuming the spec:

- Grok echoes our prompt back as `user_message_chunk`; ignore it while a turn is in flight, and suppress content updates during load/resume replay
- Grok's first `tool_call` packet carries only `title` (e.g. `"read_file"`); kind/locations arrive in later `tool_call_update`s. A target inferred from the title is a fallback only — never overwrite rawInput/locations
- The SDK's `ctx.request(method, params)` generic inference is fragile: when params is a separate variable, annotate it explicitly as `acp.XxxRequest` or it silently degrades to `unknown`
- Permission requests usually carry only `toolCall.title`; get the command/verb from the corresponding tool call
- Controls are not hardcoded into "model / mode" buckets: `modes` come from `session/new`; every other select-type configOption goes into `controls.options` (ordered by category: model → thought_level → model_config → rest), one Chip per option in the Composer, switched via `setConfig(configId, value)`. A `category=mode` configOption only stands in as modes when the protocol didn't send any (legacy Grok path); when modes exist it's a duplicate (Kimi sends both) and stays out of the control list
- Grok does not advertise modes in the protocol, but CLI ≥ 0.2.117 accepts `session/set_mode`, so the registry declares synthetic modes (`AgentDef.modes`): default / plan go over the protocol, yolo is host-side auto-approval of permissions while the CLI stays in default; `AcpSession.applyControls` backfills when the protocol gave no modes. Grok's reasoning effort hides in `_meta.reasoningEfforts` (not a standard configOption) and is not wired up yet
- Session deletion is soft: `SessionManager.deleteSession` removes from the list and moves to a 30 s trash (files untouched); the webview shows an undo Toast; files are really deleted on timeout or dispose
- Devin credentials are a long-lived API key (`windsurf_api_key` from a PKCE login) stored at `~/.local/share/devin/credentials.toml`. With `ACP_BACKEND` set, `devin acp` only accepts credentials handed over by the host (the registry sets `ACP_BACKEND=windsurf`): `session/new` fails with -32000 until `authenticate({ methodId, _meta: { api_key, api_server_url } })` — any advertised methodId works if `_meta` has the key
- Devin's browser login (`devin-browser`) authenticates only the current process: the response is `{}`, the key is never returned or persisted. Durable accounts come from the toml only: import the local login, or run `devin auth login` in an isolated XDG directory (needs a TTY, so it runs in a VS Code terminal with file polling)
- `devin auth status` reads only the toml (ignores `WINDSURF_API_KEY`); delete `ACP_BACKEND` from the env before running it or it reports "Not logged in"
- Accounts are bound per session: one agent process uses one credential; switching accounts = starting a new session. `SessionRecord.accountId` is persisted so restored sessions keep their original account
- Auto-compaction: ACP has no compact request, so we use the agent's `/compact` slash command (Devin / Grok both expose it in `available_commands_update`). After a turn ends, `AcpSession.prompt` sends `/compact` when `usage.used ≥ acpilot.compactAtTokens` (default 300k) and `acpilot.autoCompact` is on. Devin reports `compaction_update` (in_progress → completed), normalized into a single `compaction` block
- Devin sweeps empty sessions that never received a message when the creating process exits: `session/load` then returns `-32016 Session not found`. `AcpSession.openSession` catches this and falls back to `session/new`; other load failures still go readonly. Another common errorKind is `session_locked` (-32015, retryable: another process holds the session) — that one is not downgraded
- `getConfiguration().get()` returns a read-only Proxy: it cannot be `structuredClone`d or `postMessage`d (`#<Object> could not be cloned`) — round-trip through JSON first

## Conventions

- Write code comments in English
- Components must not contain raw numbers: sizes, type scale, spacing, and radii all use token classes (`h-ctl`, `px-pad`, `gap-gap`, `rounded-md`, …)
- Every "row" (thought / plan / tool / status / session item) uses `ui/Row`
- Menus: the options area holds only homogeneous option rows; all actions (add account / back / hints) go in the footer; unavailable items are greyed out, not hidden
