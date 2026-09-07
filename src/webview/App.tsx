import { useEffect, useMemo, useState } from 'react';
import type { FileHit, HostMsg, InitState, WebviewMsg } from '@shared/protocol';
import type { AccountInfo, AgentId, AgentInfo, ConfigControl, SessionSummary, SessionView } from '@shared/transcript';
import type { HiddenMap, SettingsView } from '@shared/settings';
import type { AgentInventory } from '@shared/inventory';
import type { Locale } from '@shared/i18n';
import { BASE_APPEARANCE, type Appearance } from './appearance';
import { setLocale } from './i18n';
import { Shell, type ShellHandlers } from './chat/Shell';
import { useVsCodeTheme } from './useVsCodeTheme';
import { vscodeApi } from './vscodeApi';
import { SettingsShell, type SettingsHandlers } from './settings/SettingsShell';
import type { SettingsPage } from './settings/Nav';

declare global {
  interface Window { __acpilot?: { host: 'sidebar' | 'editor' } }
}

// Always through the memo: acquireVsCodeApi() throws when called twice, and other components (Link) reach the api via vscodeApi()
const vscode = vscodeApi();
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

// Root of the real webview: consumes the whole state pushed by the host, posts actions back via postMessage unchanged.
// The settings page is a local view swap over the chat (Codex-style), not a separate webview
export function App() {
  const [init, setInit] = useState<InitState>();
  const [appearance, setAppearance] = useState<Appearance>(BASE_APPEARANCE);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [hidden, setHidden] = useState<HiddenMap>({});
  const [session, setSession] = useState<SessionView>();
  const [view, setView] = useState<'chat' | 'settings'>('chat');
  const [settings, setSettings] = useState<SettingsView>();
  const [locale, setLoc] = useState<Locale>('zh-CN');
  const [inventories, setInventories] = useState<Partial<Record<AgentId, AgentInventory>>>({});
  const [controls, setControls] = useState<Partial<Record<AgentId, ConfigControl[]>>>({});
  const [page, setPage] = useState<SettingsPage>({ kind: 'general' });
  const theme = useVsCodeTheme();

  useEffect(() => {
    const onMsg = (e: MessageEvent<HostMsg>) => {
      const m = e.data;
      switch (m.type) {
        case 'init': setInit(m.state); setAppearance(m.state.appearance); setAgents(m.state.agents); setSessions(m.state.sessions); setAccounts(m.state.accounts); setHidden(m.state.hidden); setSession(m.state.active); setSettings(m.state.settings); setLocale(m.state.locale); setLoc(m.state.locale); break;
        case 'appearance': setAppearance(m.appearance); break;
        case 'agents': setAgents(m.agents); break;
        case 'sessions': setSessions(m.sessions); break;
        case 'accounts': setAccounts(m.accounts); break;
        case 'hidden': setHidden(m.hidden); break;
        case 'session': setSession(m.session); break;
        case 'settings': setSettings(m.settings); setLocale(m.locale); setLoc(m.locale); break;
        case 'inventory': setInventories(inv => ({ ...inv, [m.agent]: m.inventory })); break;
        case 'controls': setControls(c => ({ ...c, [m.agent]: m.controls })); break;
        case 'files': settleFiles(m.seq, m.files); break;
        case 'toast': break;
      }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // The model lists of an agent page come from the configOptions of its latest session; ask for them on first visit
  useEffect(() => {
    if (view === 'settings' && page.kind === 'agent' && controls[page.id] === undefined) post({ type: 'controls', agent: page.id });
  }, [view, page, controls]);

  const on = useMemo<ShellHandlers>(() => ({
    send: (text, attachments) => post({ type: 'send', text, ...(attachments.length ? { attachments } : {}) }),
    searchFiles,
    stop: () => post({ type: 'stop' }),
    permission: (blockId, optionId) => post({ type: 'permission', blockId, optionId }),
    setMode: id => post({ type: 'setMode', id }),
    setConfig: (configId, value) => post({ type: 'setConfig', configId, value }),
    selectAgent: id => post({ type: 'selectAgent', id }),
    selectSession: id => post({ type: 'selectSession', id }),
    newSession: agent => post({ type: 'newSession', ...(agent ? { agent } : {}) }),
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

  const settingsOn = useMemo<SettingsHandlers>(() => ({
    setSetting: (key, value) => post({ type: 'setSetting', key, value }),
    openPath: path => post({ type: 'openPath', path }),
    openSettingsJson: key => post({ type: 'openSettingsJson', ...(key ? { key } : {}) }),
    // Drop the cached copy first so the page shows the scanning shimmer until the reply lands
    refreshInventory: agent => { setInventories(inv => { const { [agent]: _drop, ...rest } = inv; return rest; }); post({ type: 'inventory', agent }); },
    selectAccount: id => post({ type: 'selectAccount', id }),
    addAccount: agent => post({ type: 'addAccount', agent, via: 'auto' }),
    removeAccount: id => post({ type: 'removeAccount', id }),
  }), []);

  if (!init || !settings) return null;
  const agent = agents.find(a => a.id === session?.agent) ?? agents[0] ?? { id: 'grok', name: 'Grok Build' };
  // A locale change re-renders through a fresh dictionary: t() reads module state, so the tree remounts on key
  if (view === 'settings') {
    return (
      <SettingsShell
        key={locale}
        appearance={appearance}
        theme={theme}
        host={init.host}
        locale={locale}
        settings={settings}
        agents={agents}
        accounts={accounts}
        inventories={inventories}
        controls={controls}
        env={{ home: init.home, cwd: session?.cwd ?? init.cwd }}
        page={page}
        onPage={setPage}
        onBack={() => setView('chat')}
        on={settingsOn}
      />
    );
  }
  return (
    <Shell
      key={locale}
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
      onOpenSettings={() => setView('settings')}
    />
  );
}
