import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AccountInfo, AgentInfo, AuthMethodInfo, PinMap, SessionControls, SessionStatus, SessionSummary, Turn, Usage } from '@shared/transcript';
import type { AddAccountVia } from '@shared/protocol';
import { AppearanceContext, appearanceDataAttrs, type Appearance } from '../appearance';
import { ShellLayerContext } from '../ui/Popover';
import { cn } from '../ui/cn';
import { Header } from './Header';
import { SessionList } from './SessionList';
import { AgentMessage, UserMessage } from './Turns';
import { Composer } from './Composer';
import { Notice } from './Notice';
import { Toast } from './Toast';

// Every action the webview sends to the host; in the LAB a fake host implements these, the real build swaps in postMessage
export interface ShellHandlers {
  send: (text: string) => void;
  stop: () => void;
  permission: (blockId: string, optionId: string) => void;
  setMode: (id: string) => void;
  setConfig: (configId: string, value: string) => void;
  // Pin one value of a configOption, into the pinned section at the menu's top
  pinOption: (agent: AgentInfo['id'], configId: string, value: string, pinned: boolean) => void;
  selectAgent: (id: AgentInfo['id']) => void;
  selectSession: (id: string) => void;
  newSession: () => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  restoreSession: (id: string) => void;
  pinSession: (id: string, pinned: boolean) => void;
  // Account layer: selecting an account starts a new session with it; adding an account goes through import / terminal login; removing only deletes the locally saved credential
  selectAccount: (id: string) => void;
  addAccount: (agent: AgentInfo['id'], via: AddAccountVia) => void;
  removeAccount: (id: string) => void;
  compact: () => void;
  login: (methodId?: string) => void;
  retry: () => void;
}

export interface ShellProps {
  appearance: Appearance;
  theme: 'dark' | 'light';
  // Lives in the sidebar or the editor area: decides the background level and content width
  host: 'sidebar' | 'editor';
  agent: AgentInfo;
  agents: AgentInfo[];
  // Accounts across all agents; the current session is bound to accountId
  accounts?: AccountInfo[];
  accountId?: string;
  pins?: PinMap;
  title: string;
  status: SessionStatus;
  error?: string;
  authMethods?: AuthMethodInfo[];
  turns: Turn[];
  running: boolean;
  queued?: string;
  controls: SessionControls;
  usage?: Usage;
  // The context panel only gets a compact button when the agent has a /compact command
  canCompact?: boolean;
  sessions: SessionSummary[];
  activeSessionId?: string;
  on: ShellHandlers;
  // For replaying the entrance animation: remounts the conversation when it changes
  replayKey?: number | string;
}

// Chat shell: header / conversation flow / composer stacked vertically; the drawer axis adds a column on the left. The shell root doubles as the overlay mount point
export function Shell(p: ShellProps) {
  const { appearance: a, on } = p;
  const wide = p.host === 'editor';
  const root = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Deletion applies immediately, with an undoable toast floating at the bottom (modeled on Codex's archive), no confirmation dialog
  const [deleted, setDeleted] = useState<{ id: string; title: string }>();
  const closeToast = useCallback(() => setDeleted(undefined), []);
  const handlers = useMemo<ShellHandlers>(() => ({
    ...on,
    deleteSession: id => {
      const title = p.sessions.find(s => s.id === id)?.title ?? '会话';
      on.deleteSession(id);
      setDeleted({ id, title });
    },
  }), [on, p.sessions]);
  const sessionsPanel = (
    <SessionList
      sessions={p.sessions}
      agents={p.agents}
      activeId={p.activeSessionId}
      onSelect={id => { on.selectSession(id); setDrawerOpen(false); }}
      onNew={() => { on.newSession(); setDrawerOpen(false); }}
      onRename={on.renameSession}
      onDelete={handlers.deleteSession}
      onPin={on.pinSession}
    />
  );

  return (
    <AppearanceContext.Provider value={a}>
      <ShellLayerContext.Provider value={root}>
        <div
          ref={root}
          className={cn('acp-shell relative flex h-full min-h-0 w-full overflow-hidden', wide && 'acp-wide')}
          data-theme={p.theme}
          data-surface-host={p.host}
          data-agent={p.agent.id}
          {...appearanceDataAttrs(a)}
        >
          {a.sessions === 'drawer' && (
            <aside className={cn(
              'shrink-0 overflow-auto border-r border-line p-2',
              wide ? 'w-56 bg-bg-0' : 'absolute inset-y-0 left-0 z-20 w-64 bg-bg-1 shadow-pop transition-transform',
              !wide && !drawerOpen && '-translate-x-[102%]',
            )}>
              {sessionsPanel}
            </aside>
          )}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Header
              title={p.title}
              sessions={p.sessions}
              agents={p.agents}
              activeSessionId={p.activeSessionId}
              on={handlers}
              onToggleDrawer={() => setDrawerOpen(o => !o)}
            />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <Thread turns={p.turns} running={p.running} wide={wide} replayKey={p.replayKey} onPermission={on.permission} />
              {deleted && (
                <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center px-page">
                  <Toast
                    key={deleted.id}
                    text={`已删除「${deleted.title}」`}
                    onUndo={() => { on.restoreSession(deleted.id); setDeleted(undefined); }}
                    onClose={closeToast}
                  />
                </div>
              )}
            </div>
            <div className={cn('shrink-0', wide && a.composer === 'island' && 'mx-auto w-full max-w-[calc(720px+2*var(--pad))]')}>
              <Notice
                status={p.status} error={p.error} agent={p.agent} authMethods={p.authMethods}
                accounts={p.accounts?.filter(x => x.agent === p.agent.id)} accountId={p.accountId}
                onLogin={on.login} onRetry={on.retry} onNewSession={on.newSession}
                onSelectAccount={on.selectAccount} onAddAccount={via => on.addAccount(p.agent.id, via)}
              />
              {p.queued && <div className="truncate px-page pt-2 text-3 text-fg-3">已排队：{p.queued}</div>}
              <Composer
                running={p.running}
                disabled={p.status !== 'ready'}
                theme={p.theme}
                agent={p.agent}
                agents={p.agents}
                accounts={p.accounts}
                accountId={p.accountId}
                turns={p.turns}
                controls={p.controls}
                pins={p.pins?.[p.agent.id]}
                usage={p.usage}
                canCompact={p.canCompact}
                onSend={on.send}
                onStop={on.stop}
                onSetMode={on.setMode}
                onSetConfig={on.setConfig}
                onPinOption={(configId, value, pinned) => on.pinOption(p.agent.id, configId, value, pinned)}
                onSelectAgent={on.selectAgent}
                onSelectAccount={on.selectAccount}
                onAddAccount={on.addAccount}
                onRemoveAccount={on.removeAccount}
                onCompact={on.compact}
              />
            </div>
          </div>
        </div>
      </ShellLayerContext.Provider>
    </AppearanceContext.Provider>
  );
}

interface ThreadProps {
  turns: Turn[];
  running: boolean;
  wide: boolean;
  replayKey?: number | string;
  onPermission: ShellHandlers['permission'];
}

// Entrance stagger caps out at the 12th block, so long sessions don't take seconds
const STAGGER_CAP = 12;

// Conversation flow: stick-to-bottom following only happens on transcript changes (new content / streaming growth); user actions like expand / collapse never touch the scroll position —
// the toggle under the mouse stays put while the content below it moves. Scrolling away from the bottom releases the follow; scrolling back to the bottom restores it
function Thread({ turns, running, wide, replayKey, onPermission }: ThreadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTop = el.scrollHeight;
    const onScroll = () => { pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; };
    el.addEventListener('scroll', onScroll, { passive: true });
    // Keep stuck to the bottom when the container itself shrinks (composer grows / panel narrows); observe only the container, not the content
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el);
    return () => { ro.disconnect(); el.removeEventListener('scroll', onScroll); };
  }, [replayKey]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns, running]);

  let i = 0;
  return (
    <div ref={ref} className="scroll-stable min-h-0 min-w-0 flex-1 overflow-y-auto px-page pt-pad-y">
      <div key={replayKey} className={cn('mx-auto flex flex-col gap-msg pb-gap', wide && 'max-w-[720px]')}>
        {turns.map((t, ti) => {
          const idx = Math.min(i, STAGGER_CAP);
          i += t.role === 'agent' ? t.blocks.length + 1 : 1;
          return t.role === 'user'
            ? <UserMessage key={ti} turn={t} index={idx} />
            : <AgentMessage key={ti} turn={t} index={idx} running={running && ti === turns.length - 1} onPermission={onPermission} />;
        })}
      </div>
    </div>
  );
}
