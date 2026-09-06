import type { AccountInfo, AgentId, AgentInfo, ConfigControl } from './transcript';
import type { Appearance } from './appearance';
import type { Locale } from './i18n';
import type { SettingKey, SettingsView } from './settings';
import type { AgentInventory } from './inventory';

// Message contract of the settings webview (editor tab "ACPilot Settings"). Kept next to protocol.ts; the bridge dispatches by `view`

export interface SettingsInitState {
  view: 'settings';
  appearance: Appearance;
  locale: Locale;
  settings: SettingsView;
  agents: AgentInfo[];
  accounts: AccountInfo[];
  // The select-type configOptions each agent offered in its latest session (model / reasoning level …): the source of the hide lists
  controls: Partial<Record<AgentId, ConfigControl[]>>;
  // For shortening paths in the inventory lists
  home: string;
  cwd: string;
}

export type SettingsHostMsg =
  | { type: 'settingsInit'; state: SettingsInitState }
  | { type: 'settings'; settings: SettingsView; locale: Locale }
  | { type: 'appearance'; appearance: Appearance }
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'accounts'; accounts: AccountInfo[] }
  | { type: 'controls'; agent: AgentId; controls: ConfigControl[] }
  | { type: 'inventory'; agent: AgentId; inventory: AgentInventory };

export type SettingsWebviewMsg =
  | { type: 'ready' }
  // The back button of a standalone settings tab: the host closes the panel
  | { type: 'close' }
  | { type: 'setSetting'; key: SettingKey; value: unknown }
  | { type: 'openPath'; path: string }
  // Open settings.json (or the Settings UI filtered to `key`)
  | { type: 'openSettingsJson'; key?: string }
  | { type: 'inventory'; agent: AgentId }
  | { type: 'selectAccount'; id: string }
  | { type: 'addAccount'; agent: AgentId; via: 'auto' }
  | { type: 'removeAccount'; id: string };
