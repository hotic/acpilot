# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- MCP server injection from Acpira settings remains planned. Agents still read their own CLI MCP config.
- Steer / interrupt follow-up modes remain planned. Mid-turn messages stay in the host-side queue.

### Changed

- Sessions, accounts, and secrets now live in `~/.acpira` (override with `ACPIRA_HOME`) instead of VS Code `globalStorage` and SecretStorage. Existing data is copied once on first launch; the previous location is left untouched. Secrets are stored in `secrets.json` (mode 600), not the OS keychain.

## [1.1.0] - 2026-09-09

### Added

- Activity Bar chat view (primary sidebar), plus **Acpira: Open Chat**. The view can be moved to the secondary sidebar from the icon context menu.
- User prompts stick to the top of their exchange and fold to a few lines once stuck, so a long message does not wall off the reply. Click the card to edit (and copy from the editor); hover copy actions are gone.
- Overlay-style scrollbars: the hairline thumb shows while a pane is scrolling or under the pointer, never as a permanent grey bar.
- Model panels use a searchable command list once a catalog is large; menus, switches, radios, dialogs, and toasts share Base UI primitives.

### Changed

- Chat overlays and settings controls share one primitive set (`DropdownMenu`, `Command`, `Switch`, `RadioGroup`, `Dialog`, `Collapsible`). Stylesheets are split into tokens / base / prose / motion / chat with explicit cascade layers.
- Tool rows distinguish queued from in-progress (`Read queued` vs `Read…`). Compaction's live label is just Compacting.
- Context usage caps the ring at the auto-compact threshold when that budget is smaller than the agent's reported window.

### Fixed

- Devin background shells no longer look like a hung generic tool. A parked exec is skipped as current activity; `get_output` / `kill_shell` show as wait/stop on the parked command.
- Opening an attachment uses `vscode.open`, so images and other binaries preview instead of failing as "the file appears to be binary".

## [1.0.2] - 2026-09-08

### Added

- Each sidebar and editor webview now keeps its own active session. Session events go only to viewers showing that conversation; the shared list and process pool stay global.
- New chats reuse a warm, initialize-only agent process. Opening `+` on an empty same-agent session keeps that session instead of killing it, and the composer can accept the first prompt while startup finishes.
- Streamed text fades in per grapheme with a bounded visual backlog and no chunk batching. Live row slots enter in sequence; connected rails attach to icon strokes and end in a short solid dot.

### Changed

- The turn heading owns the only activity orb. Working stays visible across tool changes and fold expansion; thought rows use a static icon plus shimmer; initialization reuses the connecting orb; approval and question waits pause on static icons.
- Permission cards use a compact approvals menu instead of a stacked option list.
- Native reasoning presentation splits on/off from Low / High / Max, so DeepSeek Off is a Thinking switch rather than a radio sibling. Vendor marks resolve from option IDs, so a bare K3 name still brands as Kimi.
- History stays static. Disabled motion and reduced-motion settings also stop rail animations.
- Local `.agents/skills` is ignored in the packaged extension, and the marketplace description is tighter.

### Fixed

- After a Kimi model switch, leftover thinking values the new model does not offer are dropped, and a native thinking id is written so the phantom value does not stay on the wire.
- Empty thought blocks stay hidden. Completed edit diffs keep their stats in every tool-line mode, including collapsed rows.
- Tool generation time is no longer counted as thinking duration.
- A finished to-do dock stays visible only while its own turn is still running; open entries remain pinned across turns. To-do expansion spacing is tighter and no longer jumps when the list updates.
- Account quota is fetched as soon as an account is imported or logged in, without waiting for a session. Settings rows re-read when the account set changes while the page is open. Stored account details no longer include the user name.
- Menu content columns stay aligned when a row is checked.
- The session list popover empty state matches the search field inset, skips the trailing list container so padding stays symmetric, and uses a neutral working spinner.

## [1.0.1] - 2026-09-08

### Changed

- Renamed the project and extension to Acpira, published as `hotic.acpira`.
- Updated command IDs, settings, client metadata, and repository links to the `acpira` namespace.
- Updated GitHub Release automation to publish the renamed extension to both marketplaces.
- Extension storage and saved credentials use the new identity; earlier development installs require account re-import and settings reconfiguration.

## [1.0.0] - 2026-09-08

### Added

- Chat shell in the VS Code / Cursor secondary sidebar that drives official ACP CLIs (`grok agent stdio`, `devin acp`, `kimi acp`) and custom ACP commands.
- Sessions, permission approvals, multi-account logins, image and file attachments, a mid-turn prompt queue, and auto-compaction via `/compact`.
- Plan document cards (preview, View Plan, Build) kept outside the process fold.
- Historical message editing by reconstructing context into a fresh `session/new`.
- Settings for language, default agent, compact threshold, hidden option families, and appearance axes.

### Changed

- Follow-up steer / interrupt and MCP injection settings are not shipped in 1.0; mid-turn sends always queue.
