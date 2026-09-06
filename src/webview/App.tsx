import { useEffect, useMemo, useState } from 'react';
import type { FileHit, HostMsg, InitState, WebviewMsg } from '@shared/protocol';
import type { AccountInfo, AgentInfo, SessionSummary, SessionView } from '@shared/transcript';
import type { HiddenMap } from '@shared/settings';
import { BASE_APPEARANCE, type Appearance } from './appearance';
import { Shell, type ShellHandlers } from './chat/Shell';

declare global {
  interface Window { __acpilot?: { host: 'sidebar' | 'editor' } }
  function acquireVsCodeApi(): { postMessage(msg: unknown): void };
}

const vscode = acquireVsCodeApi();
const post = (m: WebviewMsg) => vscode.postMessage(m);

// The one request/response pair over postMessage: file search for @ mentions. Each request gets a seq; the matching `files` reply resolves it.
// A reply that never comes (host gone) resolves empty after a while so nothing waits forever
const FILES_TIMEOUT = 5000;
let fileSeq = 0;
const fileWaits = new Map<number, (files: FileHit[]) => void>();
const settleFiles = (seq: number, files: FileHit[]) => { fileWaits.get(seq)?.(files); fileWaits.delete(seq); };
const searchFiles = (query: string) => new Promise<FileHit[]>(resolve => {
  const seq = ++fileSeq;
  fileWaits.set(seq, resolve);
  setTimeout(() => settleFiles(seq, []), FILES_TIMEOUT);
  post({ type: 'searchFiles', query, seq });
});

// Root of the real webview: consumes the whole state pushed by the host, posts actions back via postMessage unchanged
export function App() {
  const [init, setInit] = useState<InitState>();
  const [appearance, setAppearance] = useState<Appearance>(BASE_APPEARANCE);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [hidden, setHidden] = useState<HiddenMap>({});
  const [session, setSession] = useState<SessionView>();
  const theme = useVsCodeTheme();

  useEffect(() => {
    const onMsg = (e: MessageEvent<HostMsg>) => {
      const m = e.data;
      switch (m.type) {
        case 'init': setInit(m.state); setAppearance(m.state.appearance); setAgents(m.state.agents); setSessions(m.state.sessions); setAccounts(m.state.accounts); setHidden(m.state.hidden); setSession(m.state.active); break;
        case 'appearance': setAppearance(m.appearance); break;
        case 'agents': setAgents(m.agents); break;
        case 'sessions': setSessions(m.sessions); break;
        case 'accounts': setAccounts(m.accounts); break;
        case 'hidden': setHidden(m.hidden); break;
        case 'session': setSession(m.session); break;
        case 'files': settleFiles(m.seq, m.files); break;
        case 'toast': break;
      }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const on = useMemo<ShellHandlers>(() => ({
    send: (text, attachments) => post({ type: 'send', text, ...(attachments.length ? { attachments } : {}) }),
    searchFiles,
    stop: () => post({ type: 'stop' }),
    permission: (blockId, optionId) => post({ type: 'permission', blockId, optionId }),
    setMode: id => post({ type: 'setMode', id }),
    setConfig: (configId, value) => post({ type: 'setConfig', configId, value }),
    selectAgent: id => post({ type: 'selectAgent', id }),
    selectSession: id => post({ type: 'selectSession', id }),
    newSession: () => post({ type: 'newSession' }),
    renameSession: (id, title) => post({ type: 'renameSession', id, title }),
    deleteSession: id => post({ type: 'deleteSession', id }),
    restoreSession: id => post({ type: 'restoreSession', id }),
    pinSession: (id, pinned) => post({ type: 'pinSession', id, pinned }),
    selectAccount: id => post({ type: 'selectAccount', id }),
    addAccount: (agent, via) => post({ type: 'addAccount', agent, via }),
    removeAccount: id => post({ type: 'removeAccount', id }),
    compact: () => post({ type: 'compact' }),
    login: methodId => post({ type: 'login', methodId }),
    retry: () => post({ type: 'retry' }),
    retryTurn: () => post({ type: 'retryTurn' }),
  }), []);

  if (!init) return null;
  const agent = agents.find(a => a.id === session?.agent) ?? agents[0] ?? { id: 'grok', name: 'Grok' };
  return (
    <Shell
      appearance={appearance}
      theme={theme}
      host={init.host}
      agent={agent}
      agents={agents}
      accounts={accounts}
      accountId={session?.accountId}
      hidden={hidden}
      title={session?.title ?? '新会话'}
      status={session?.status ?? 'starting'}
      error={session?.error}
      authMethods={session?.authMethods}
      turns={session?.turns ?? []}
      running={session?.running ?? false}
      queued={session?.queued}
      controls={session?.controls ?? { modes: [], options: [] }}
      usage={session?.usage}
      canCompact={session?.commands.some(c => c.name === 'compact')}
      sessions={sessions}
      activeSessionId={session?.id}
      cwd={session?.cwd}
      blobBase={init.blobBase}
      on={on}
      replayKey={session?.id}
    />
  );
}

// VS Code hangs theme classes on body (vscode-dark / vscode-light / vscode-high-contrast*); follow it
function useVsCodeTheme(): 'dark' | 'light' {
  const read = () => (document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? 'light' : 'dark');
  const [theme, setTheme] = useState<'dark' | 'light'>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}
