import type { AgentId } from '@shared/transcript';

// Where each CLI keeps its extension points, as verified against the vendors' docs and a real machine (2026-09):
// Grok   — ~/.grok/README.md §Skills / §MCP Servers / §AGENTS.md; also reads Claude Code's ~/.claude/skills, ~/.claude.json, .mcp.json
// Devin  — docs/reference/configuration/config-file.mdx, extensibility/skills/overview.mdx, extensibility/rules.mdx
// Kimi   — kimi.com/code/docs: configuration/data-locations, customization/mcp, customization/skills
// Path templates: `~/` = home, `$CONFIG/` = XDG config home (%APPDATA% on Windows), anything else is relative to the workspace root

export interface McpSource {
  path: string;
  // json: { "mcpServers": { name: {...} } } (Devin / Kimi / Claude-compatible .mcp.json); toml: [mcp_servers.name] tables (Grok config.toml)
  format: 'json' | 'toml';
}

export interface RuleSource {
  path: string;
  // A directory of *.md / *.mdc rule files instead of a single file
  dir?: boolean;
}

export interface AgentExt {
  // The CLI's own config files (shown under "Config")
  config: string[];
  mcp: McpSource[];
  // Directories holding <name>/SKILL.md
  skills: string[];
  rules: RuleSource[];
  // A second session/prompt sent mid-turn is folded into the running turn (probe-steer.ts): Devin yes, Grok queues it agent-side, Kimi unverified
  steer: boolean;
}

export const AGENT_EXT: Record<string, AgentExt> = {
  grok: {
    config: ['~/.grok/config.toml', '.grok/config.toml'],
    mcp: [
      { path: '~/.grok/config.toml', format: 'toml' },
      { path: '.grok/config.toml', format: 'toml' },
      { path: '.mcp.json', format: 'json' },
      { path: '~/.claude.json', format: 'json' },
    ],
    skills: ['~/.grok/skills', '.grok/skills', '~/.claude/skills', '.claude/skills'],
    rules: [{ path: 'AGENTS.md' }, { path: 'CLAUDE.md' }, { path: 'AGENT.md' }],
    steer: false,
  },
  devin: {
    config: ['$CONFIG/devin/config.json', '.devin/config.json', '.devin/config.local.json'],
    mcp: [
      { path: '$CONFIG/devin/mcp_config.json', format: 'json' },
      { path: '.devin/mcp_config.json', format: 'json' },
      { path: '.devin/mcp_config.local.json', format: 'json' },
    ],
    skills: ['~/.agents/skills', '$CONFIG/devin/skills', '.agents/skills', '.devin/skills', '.windsurf/skills'],
    rules: [
      { path: 'AGENTS.md' }, { path: 'AGENTS.local.md' }, { path: 'CLAUDE.md' },
      { path: '$CONFIG/devin/AGENTS.md' }, { path: '~/.claude/CLAUDE.md' },
      { path: '.devin/rules', dir: true }, { path: '.cursor/rules', dir: true }, { path: '~/.devin/rules', dir: true },
    ],
    steer: true,
  },
  kimi: {
    config: ['~/.kimi-code/config.toml'],
    mcp: [
      { path: '~/.kimi-code/mcp.json', format: 'json' },
      { path: '.kimi-code/mcp.json', format: 'json' },
      { path: '.mcp.json', format: 'json' },
    ],
    skills: ['~/.kimi-code/skills', '~/.agents/skills', '.kimi-code/skills', '.agents/skills'],
    rules: [{ path: 'AGENTS.md' }, { path: '~/.kimi-code/AGENTS.md' }],
    steer: false,
  },
};

export function agentExt(id: AgentId): AgentExt | undefined {
  return AGENT_EXT[id];
}
