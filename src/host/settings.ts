import type { AgentId } from '@shared/transcript';
import type { AgentInventory, AgentRuntimeInfo } from '@shared/inventory';
import { DEFAULT_SETTINGS, type SettingKey, type SettingsView } from '@shared/settings';
import { resolveLocale, type Locale } from '@shared/i18n';
import type { AgentRegistry } from './acp/AgentRegistry';
import { agentExt } from './agentExt';
import { scanInventory } from './inventory';

export interface SettingsDeps {
  // Reads one acpilot.* setting; object values come back as a read-only Proxy, so view() JSON-round-trips them
  read: (key: SettingKey) => unknown;
  // Writes acpilot.<key> at user scope
  write: (key: SettingKey, value: unknown) => PromiseLike<void>;
  // The host's display language (vscode.env.language), for resolving `auto`
  hostLanguage: () => string;
  registry: () => AgentRegistry;
  // Runtime info of an agent's live session (version, MCP capabilities), when one is running
  runtimeInfo: (agent: AgentId) => AgentRuntimeInfo | undefined;
  home: () => string;
  cwd: () => string;
  log: (line: string) => void;
}

export type SettingsEvent = { type: 'settings'; settings: SettingsView; locale: Locale };

// The settings page's host-side counterpart: builds the SettingsView from acpilot.*, writes edits back, and scans agent inventories on demand.
// No vscode import, so it runs under vitest with injected deps
export class SettingsCenter {
  private listeners = new Set<(ev: SettingsEvent) => void>();

  constructor(private deps: SettingsDeps) {}

  private read<K extends SettingKey>(key: K): SettingsView[K] {
    const v = this.deps.read(key);
    if (v === undefined) return DEFAULT_SETTINGS[key];
    // getConfiguration().get() hands back a read-only Proxy that postMessage can't clone; a JSON round-trip fixes the object values
    return (typeof v === 'object' && v !== null ? JSON.parse(JSON.stringify(v)) : v) as SettingsView[K];
  }

  view(): SettingsView {
    return {
      language: this.read('language'),
      locale: this.locale(),
      defaultAgent: this.read('defaultAgent'),
      followUp: this.read('followUp'),
      autoCompact: this.read('autoCompact'),
      compactAtTokens: this.read('compactAtTokens'),
      mcpServers: this.read('mcpServers'),
      hiddenOptions: this.read('hiddenOptions'),
    };
  }

  locale(): Locale {
    return resolveLocale(this.read('language'), this.deps.hostLanguage());
  }

  // Write, then push: VS Code's own onDidChangeConfiguration also fires (and covers hand edits of settings.json), a double push is harmless
  async set(key: SettingKey, value: unknown): Promise<void> {
    await this.deps.write(key, value);
    this.emit();
  }

  // Scan one agent's extension points fresh; every request is a rescan (the page's refresh button sends the same message)
  async inventory(agent: AgentId): Promise<AgentInventory> {
    const binary = await this.deps.registry().resolveBinary(agent);
    const env = { home: this.deps.home(), cwd: this.deps.cwd() };
    return scanInventory({ agent, ext: agentExt(agent), binary, runtime: this.deps.runtimeInfo(agent) }, env);
  }

  subscribe(fn: (ev: SettingsEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Re-read everything and push (a setting changed in the page, in the Settings UI, or in settings.json)
  emit() {
    const ev: SettingsEvent = { type: 'settings', settings: this.view(), locale: this.locale() };
    for (const fn of this.listeners) fn(ev);
  }
}
