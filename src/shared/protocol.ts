import type { AccountInfo, AgentId, AgentInfo, PinMap, SessionSummary, SessionView } from './transcript';
import type { Appearance } from './appearance';

// Message contract between host ↔ webview; both sides trust only this file

export type WebviewHost = 'sidebar' | 'editor';

export interface InitState {
  host: WebviewHost;
  appearance: Appearance;
  agents: AgentInfo[];
  accounts: AccountInfo[];
  pins: PinMap;
  sessions: SessionSummary[];
  active?: SessionView;
}

export type HostMsg =
  | { type: 'init'; state: InitState }
  | { type: 'appearance'; appearance: Appearance }
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'session'; session: SessionView }
  | { type: 'accounts'; accounts: AccountInfo[] }
  | { type: 'pins'; pins: PinMap }
  | { type: 'toast'; level: 'info' | 'error'; text: string };

// How an account comes in: import reads the CLI's own local login; login runs an isolated login in the terminal that leaves the local login untouched;
// auto is the "+" in the menu: import the local login if it hasn't been imported yet, otherwise log in a new one in the terminal
export type AddAccountVia = 'import' | 'login' | 'auto';

export type WebviewMsg =
  | { type: 'ready' }
  | { type: 'send'; text: string }
  | { type: 'stop' }
  | { type: 'permission'; blockId: string; optionId: string }
  | { type: 'setMode'; id: string }
  | { type: 'setConfig'; configId: string; value: string }
  | { type: 'selectAgent'; id: AgentId }
  | { type: 'selectSession'; id: string }
  | { type: 'newSession'; agent?: AgentId }
  | { type: 'renameSession'; id: string; title: string }
  | { type: 'deleteSession'; id: string }
  | { type: 'restoreSession'; id: string }
  | { type: 'pinSession'; id: string; pinned: boolean }
  // Start a new session with this account (also becomes the agent's default account)
  | { type: 'selectAccount'; id: string }
  | { type: 'addAccount'; agent: AgentId; via: AddAccountVia }
  | { type: 'removeAccount'; id: string }
  // Pin / unpin one option value of a configOption
  | { type: 'pinOption'; agent: AgentId; configId: string; value: string; pinned: boolean }
  | { type: 'compact' }
  | { type: 'login'; methodId?: string }
  | { type: 'retry' }
  | { type: 'openInEditor' };
