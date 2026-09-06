import type { AccountInfo, AgentId, AgentInfo, Draft, SessionSummary, SessionView } from './transcript';
import type { Appearance } from './appearance';
import type { HiddenMap } from './settings';

// Message contract between host ↔ webview; both sides trust only this file

export type WebviewHost = 'sidebar' | 'editor';

export interface InitState {
  host: WebviewHost;
  appearance: Appearance;
  agents: AgentInfo[];
  accounts: AccountInfo[];
  hidden: HiddenMap;
  sessions: SessionSummary[];
  active?: SessionView;
  // Webview URI of the sessions directory: an attachment blob is loaded from `${blobBase}/${sessionId}/${blob}`
  blobBase?: string;
}

// One hit of the @ file search: file URI plus the workspace-relative path shown in the list
export interface FileHit {
  uri: string;
  path: string;
}

export type HostMsg =
  | { type: 'init'; state: InitState }
  | { type: 'appearance'; appearance: Appearance }
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'session'; session: SessionView }
  | { type: 'accounts'; accounts: AccountInfo[] }
  | { type: 'hidden'; hidden: HiddenMap }
  | { type: 'toast'; level: 'info' | 'error'; text: string }
  // Reply to searchFiles; seq echoes the request so stale replies can be dropped
  | { type: 'files'; seq: number; files: FileHit[] };

// How an account comes in: import reads the CLI's own local login; login runs an isolated login in the terminal that leaves the local login untouched;
// auto is the "+" in the menu: import the local login if it hasn't been imported yet, otherwise log in a new one in the terminal
export type AddAccountVia = 'import' | 'login' | 'auto';

export type WebviewMsg =
  | { type: 'ready' }
  | { type: 'send'; text: string; attachments?: Draft[] }
  | { type: 'stop' }
  // @ mention: fuzzy search over workspace files, answered with a `files` message
  | { type: 'searchFiles'; query: string; seq: number }
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
  | { type: 'compact' }
  | { type: 'login'; methodId?: string }
  | { type: 'retry' }
  // Send the last user turn again after its agent turn ended in error / a short stop; both turns are dropped from the transcript first
  | { type: 'retryTurn' }
  | { type: 'openInEditor' };
