import type { AgentId } from './transcript';
import { isLanguage, type Language, type Locale } from './i18n';

// Hidden option families (acpira.hiddenOptions): agent → configOption id → source-qualified family keys (legacy family names remain readable; see models.ts) kept out of the composer menus.
// Long lists (Devin's 210 models) are trimmed to what is actually used via this; the option currently selected is never hidden
export type HiddenMap = Record<AgentId, Record<string, string[]>>;

// The settings the page shows and edits; the host builds it from acpira.* and pushes it on every change
export interface SettingsView {
  language: Language;
  // Language resolved against the host's display language
  locale: Locale;
  defaultAgent: AgentId;
  autoCompact: boolean;
  compactAtTokens: number;
  hiddenOptions: HiddenMap;
}

// Keys the webview may write back; the host maps them onto acpira.<key> at user scope
export type SettingKey = 'language' | 'defaultAgent' | 'autoCompact' | 'compactAtTokens' | 'hiddenOptions';

export const MIN_COMPACT_AT_TOKENS = 10_000;

export const DEFAULT_SETTINGS: SettingsView = {
  language: 'auto',
  locale: 'en',
  defaultAgent: 'grok',
  autoCompact: true,
  compactAtTokens: 300_000,
  hiddenOptions: {},
};

// A hand-edited settings.json or a forged webview message can send anything; fall back per key so the page never sees an illegal value
export function sanitizeSetting<K extends SettingKey>(key: K, value: unknown): SettingsView[K] {
  const fallback = DEFAULT_SETTINGS[key];
  switch (key) {
    case 'language':
      return (isLanguage(value) ? value : fallback) as SettingsView[K];
    case 'defaultAgent':
      return (typeof value === 'string' && value.trim() ? value.trim() : fallback) as SettingsView[K];
    case 'autoCompact':
      return (typeof value === 'boolean' ? value : fallback) as SettingsView[K];
    case 'compactAtTokens': {
      const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback as number;
      return Math.max(MIN_COMPACT_AT_TOKENS, n) as SettingsView[K];
    }
    case 'hiddenOptions':
      return (isHiddenMap(value) ? value : fallback) as SettingsView[K];
  }
}

function isHiddenMap(v: unknown): v is HiddenMap {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  for (const families of Object.values(v as Record<string, unknown>)) {
    if (!families || typeof families !== 'object' || Array.isArray(families)) return false;
    for (const names of Object.values(families as Record<string, unknown>)) {
      if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) return false;
    }
  }
  return true;
}
