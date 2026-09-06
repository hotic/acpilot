import type { AgentId } from './transcript';
import type { Language, Locale } from './i18n';

// What happens when a message is sent while a turn is running:
// queue     — hold it, send after the turn ends (client-side; works with every agent)
// steer     — send it now as a second session/prompt; agents that support it fold it into the running turn at the next model call
//             (verified on Devin: `scripts/probe-steer.ts`). Agents without support fall back to queue
// interrupt — session/cancel the running turn, then send
export type FollowUp = 'queue' | 'steer' | 'interrupt';
export const FOLLOW_UPS: FollowUp[] = ['queue', 'steer', 'interrupt'];

// One entry of acpilot.mcpServers (keyed by name in the setting). Handed to agents over ACP in session/new / load / resume.
// stdio when `command` is set, otherwise http (or sse when type says so). `agents` limits it to some agents; absent = every agent
export interface McpServerSetting {
  type?: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  agents?: AgentId[];
  enabled?: boolean;
}

export type McpTransport = 'stdio' | 'http' | 'sse';

export function mcpTransport(s: McpServerSetting): McpTransport {
  if (s.type) return s.type;
  return s.command ? 'stdio' : 'http';
}

// Is this server meant for the given agent (ignoring transport capability, which only the live process knows)?
export function mcpAppliesTo(s: McpServerSetting, agent: AgentId): boolean {
  return s.enabled !== false && (!s.agents || s.agents.includes(agent));
}

// Hidden option families (acpilot.hiddenOptions): agent → configOption id → family names (see models.ts) kept out of the composer menus.
// Long lists (Devin's 210 models) are trimmed to what is actually used via this; the option currently selected is never hidden
export type HiddenMap = Record<AgentId, Record<string, string[]>>;

// The settings the page shows and edits; the host builds it from acpilot.* and pushes it on every change
export interface SettingsView {
  language: Language;
  // Language resolved against the host's display language
  locale: Locale;
  defaultAgent: AgentId;
  followUp: FollowUp;
  autoCompact: boolean;
  compactAtTokens: number;
  mcpServers: Record<string, McpServerSetting>;
  hiddenOptions: HiddenMap;
}

// Keys the webview may write back; the host maps them onto acpilot.<key> at user scope
export type SettingKey = 'language' | 'defaultAgent' | 'followUp' | 'autoCompact' | 'compactAtTokens' | 'mcpServers' | 'hiddenOptions';

export const DEFAULT_SETTINGS: SettingsView = {
  language: 'auto',
  locale: 'zh-CN',
  defaultAgent: 'grok',
  followUp: 'queue',
  autoCompact: true,
  compactAtTokens: 300_000,
  mcpServers: {},
  hiddenOptions: {},
};
