# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- MCP server injection from ACPilot settings is planned for 1.1. Agents still read their own CLI MCP config.
- Steer / interrupt follow-up modes are planned for 1.1. Mid-turn messages stay in the host-side queue.

## [1.0.0] - 2026-09-08

### Added

- Chat shell in the VS Code / Cursor secondary sidebar that drives official ACP CLIs (`grok agent stdio`, `devin acp`, `kimi acp`) and custom ACP commands.
- Sessions, permission approvals, multi-account logins, image and file attachments, a mid-turn prompt queue, and auto-compaction via `/compact`.
- Plan document cards (preview, View Plan, Build) kept outside the process fold.
- Historical message editing by reconstructing context into a fresh `session/new`.
- Settings for language, default agent, compact threshold, hidden option families, and appearance axes.

### Changed

- Follow-up steer / interrupt and MCP injection settings are not shipped in 1.0; mid-turn sends always queue.
