import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Paperclip } from 'lucide-react';
import type { AccountInfo, AgentInfo, AuthMethodInfo, Draft, PermissionBlock, QueuedPrompt, SessionControls, SessionStatus, SessionSummary, Turn, Usage } from '@shared/transcript';
import type { HiddenMap } from '@shared/settings';
import type { AccountAction, AddAccountVia, EditTurnRequest, FileHit } from '@shared/protocol';
import { AppearanceContext, appearanceDataAttrs, type Appearance } from '../appearance';
import { t } from '../i18n';
import { ShellLayerContext } from '../ui/Popover';
import { cn } from '../ui/cn';
import { Header } from './Header';
import { SessionList } from './SessionList';
import { AgentMessage } from './Turns';
import { HistoryContext, HistoryMessage } from './HistoryMessage';
import { Composer, type ComposerProps } from './Composer';
import { Notice } from './Notice';
import { Toast } from './Toast';
import { Alert, isShortStop } from './Alert';
import { PlanBar } from './PlanBar';
import { PlanDocumentContext } from './PlanDocument';
import { Queue } from './Queue';

// Every action the webview sends to the host; in the LAB a fake host implements these, the real build swaps in postMessage
export interface ShellHandlers {
  editTurn?: (edit: EditTurnRequest) => Promise<void>;
  send: (text: string, attachments: Draft[]) => void;
  // @ mention lookup over workspace files
  searchFiles: (query: string) => Promise<FileHit[]>;
  stop: () => void;
  permission: (blockId: string, optionId: string) => void;
  buildPlan?: (sessionId: string, planId: string, model?: { configId: string; value: string }, optionId?: string) => void;
  openPlan?: (sessionId: string, planId: string) => void;
  setMode: (id: string) => void;
  setConfig: (configId: string, value: string) => void;
  selectAgent: (id: AgentInfo['id']) => void;
  selectSession: (id: string) => void;
  // Without an agent the host falls back to the configured defaultAgent
  newSession: (agent?: AgentInfo['id']) => void;
  renameSession: (id: string, title: string) => void;
  deleteSession: (id: string) => void;
  restoreSession: (id: string) => void;
  pinSession: (id: string, pinned: boolean) => void;
  // Account layer: selecting an account starts a new session with it; adding an account goes through import / terminal login; removing only deletes the locally saved credential
  selectAccount: (id: string) => void;
  addAccount: (agent: AgentInfo['id'], via: AddAccountVia) => void;
  removeAccount: (id: string) => void;
  // An account list opened: re-read the quotas of that agent's accounts
  refreshQuota?: (agent: AgentInfo['id']) => void;
  compact: () => void;
  login: (methodId?: string) => void;
  retry: () => void;
  // Send the last user turn again after its agent turn ended in error
  retryTurn: () => void;
  // Queued prompts: drop one / replace one in place (kept attachments by index plus new drafts)
  dequeue?: (sessionId: string, id: string) => void;
  editQueued?: (sessionId: string, id: string, text: string, retainedAttachments: number[], attachments: Draft[]) => void;
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
  accountAction?: AccountAction;
  // Option families hidden from the composer menus (acpilot.hiddenOptions)
  hidden?: HiddenMap;
  title: string;
  status: SessionStatus;
  error?: string;
  authMethods?: AuthMethodInfo[];
  turns: Turn[];
  running: boolean;
  queued?: QueuedPrompt[];
  controls: SessionControls;
  usage?: Usage;
  // The context panel only gets a compact button when the agent has a /compact command
  canCompact?: boolean;
  sessions: SessionSummary[];
  activeSessionId?: string;
  // Workspace root of the session; attachments are labeled relative to it
  cwd?: string;
  // Where attachment blobs are served from (the host's sessions directory as a webview URI); absent in the LAB
  blobBase?: string;
  on: ShellHandlers;
  // Opens the settings page (a local view swap, not a host action — hence not part of ShellHandlers)
  onOpenSettings?: () => void;
  // For replaying the entrance animation: remounts the conversation when it changes
  replayKey?: number | string;
}

// A toast: text plus an optional undo; each dismisses itself, several can stack (an attachment notice must not take the undo of a deletion with it)
interface ToastState {
  key: string;
  text: string;
  icon?: ReactNode;
  undo?: () => void;
}

// Chat shell: header / conversation flow / composer stacked vertically; the drawer axis adds a column on the left. The shell root doubles as the overlay mount point
export function Shell(p: ShellProps) {
  const { appearance: a, on } = p;
  const wide = p.host === 'editor';
  const root = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<{ sessionId: string; index: number }>();
  useEffect(() => setEditing(undefined), [p.activeSessionId]);
  // Deletion applies immediately, with an undoable toast floating at the bottom (modeled on Codex's archive), no confirmation dialog; refused attachments show up the same way
  const [toasts, setToasts] = useState<ToastState[]>([]);
  const dropToast = useCallback((key: string) => setToasts(ts => ts.filter(t => t.key !== key)), []);
  const pushToast = useCallback((t: ToastState) => setToasts(ts => [...ts.filter(x => x.key !== t.key), t]), []);
  const notice = useCallback((text: string) => pushToast({ key: `n${Date.now()}`, text, icon: <Paperclip className="size-icon shrink-0 text-fg-3" strokeWidth={1.5} /> }), [pushToast]);
  const handlers = useMemo<ShellHandlers>(() => ({
    ...on,
    deleteSession: id => {
      const title = p.sessions.find(s => s.id === id)?.title ?? t('session.fallbackTitle');
      on.deleteSession(id);
      pushToast({ key: id, text: t('session.deleted', { title }), undo: () => { on.restoreSession(id); dropToast(id); } });
    },
  }), [on, p.sessions, pushToast, dropToast]);
  const blobUrl = useMemo(() => (p.blobBase && p.activeSessionId ? (blob: string) => `${p.blobBase}/${p.activeSessionId}/${blob}` : undefined), [p.blobBase, p.activeSessionId]);
  // The card for a turn that stopped short stands until dismissed or until the transcript moves on; the key ties the dismissal to that one turn.
  // While the session isn't ready the Notice has the floor (a login problem after a failed prompt is its business)
  const lastTurn = p.turns[p.turns.length - 1];
  const alertKey = `${p.activeSessionId}:${p.turns.length}`;
  const [dismissedAlert, setDismissedAlert] = useState<string>();
  const alertTurn = !p.running && p.status === 'ready' && lastTurn?.role === 'agent' && isShortStop(lastTurn) && dismissedAlert !== alertKey ? lastTurn : undefined;
  const sessionsPanel = (
    <SessionList
      sessions={p.sessions}
      agents={p.agents}
      activeId={p.activeSessionId}
      onSelect={id => { on.selectSession(id); setDrawerOpen(false); }}
      onRename={on.renameSession}
      onDelete={handlers.deleteSession}
      onPin={on.pinSession}
    />
  );

  const composerProps: ComposerProps = useMemo(() => ({
    running: p.running, disabled: p.status !== 'ready',
    theme: p.theme, turns: p.turns, controls: p.controls, hidden: p.hidden?.[p.agent.id],
    usage: p.usage, canCompact: p.canCompact, cwd: p.cwd ?? '',
    onSend: on.send, onSearchFiles: on.searchFiles, onNotice: notice, onStop: on.stop,
    onSetMode: on.setMode, onSetConfig: on.setConfig, onCompact: on.compact,
  }), [p.running, p.status, p.theme, p.turns, p.controls, p.hidden, p.agent.id, p.usage, p.canCompact, p.cwd, on.send, on.searchFiles, notice, on.stop, on.setMode, on.setConfig, on.compact]);
  const planDoc = useMemo(() => ({
    controls: p.controls, hidden: p.hidden?.[p.agent.id], running: p.running, ready: p.status === 'ready',
    permissions: p.turns.flatMap(t => t.role === 'agent' ? t.blocks.filter((b): b is PermissionBlock => b.type === 'permission') : []),
    build: p.activeSessionId && on.buildPlan ? (id: string, model?: { configId: string; value: string }, optionId?: string) => on.buildPlan!(p.activeSessionId!, id, model, optionId) : undefined,
    open: p.activeSessionId && on.openPlan ? (id: string) => on.openPlan!(p.activeSessionId!, id) : undefined,
  }), [p.controls, p.hidden, p.agent.id, p.running, p.status, p.turns, p.activeSessionId, on.buildPlan, on.openPlan]);
  const history = useMemo(() => on.editTurn && p.activeSessionId ? {
    sessionId: p.activeSessionId, composer: composerProps, edit: on.editTurn,
    editing: editing?.sessionId === p.activeSessionId ? editing.index : undefined,
    select: (index: number | undefined) => setEditing(current => index === undefined
      ? current?.sessionId === p.activeSessionId ? undefined : current
      : { sessionId: p.activeSessionId!, index }),
  } : undefined, [on.editTurn, p.activeSessionId, composerProps, editing]);

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
              agent={p.agent}
              agents={p.agents}
              accounts={p.accounts}
              accountId={p.accountId}
              activeSessionId={p.activeSessionId}
              on={handlers}
              onToggleDrawer={() => setDrawerOpen(o => !o)}
              drawerOpen={drawerOpen}
              onOpenSettings={p.onOpenSettings}
            />
            <div className="relative flex min-h-0 flex-1 flex-col">
              <PlanDocumentContext.Provider value={planDoc}>
                <HistoryContext.Provider value={history}>
                  <Thread key={p.activeSessionId} turns={p.turns} running={p.running} wide={wide} replayKey={p.replayKey} blobUrl={blobUrl} onPermission={on.permission} />
                </HistoryContext.Provider>
              </PlanDocumentContext.Provider>
              {toasts.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex flex-col items-center gap-1 px-page">
                  {toasts.map(t => <Toast key={t.key} text={t.text} icon={t.icon} onUndo={t.undo} onClose={() => dropToast(t.key)} />)}
                </div>
              )}
            </div>
            <div className={cn('shrink-0', wide && a.composer === 'island' && 'mx-auto w-full max-w-[calc(var(--content-w)+2*var(--pad))]')}>
              <PlanBar key={p.activeSessionId} turns={p.turns} running={p.running} />
              {alertTurn && (
                <Alert
                  turn={alertTurn}
                  onRetry={on.retryTurn}
                  onContinue={() => on.send(t('alert.continueText'), [])}
                  onDismiss={() => setDismissedAlert(alertKey)}
                />
              )}
              <Notice
                status={p.status} error={p.error} agent={p.agent} authMethods={p.authMethods}
                accounts={p.accounts?.filter(x => x.agent === p.agent.id)} accountId={p.accountId}
                accountAction={p.accountAction}
                onLogin={on.login} onRetry={on.retry} onNewSession={on.newSession}
                onSelectAccount={on.selectAccount} onAddAccount={via => on.addAccount(p.agent.id, via)}
              />
              {p.queued?.length && p.activeSessionId
                ? <Queue key={p.activeSessionId} items={p.queued} composer={composerProps} blobUrl={blobUrl}
                    on={on.dequeue && on.editQueued ? { remove: id => on.dequeue!(p.activeSessionId!, id), edit: (id, text, kept, drafts) => on.editQueued!(p.activeSessionId!, id, text, kept, drafts) } : undefined} />
                : null}
              {/* Keyed by session so each one has its own field; the unsent draft is parked under the same key while another session is shown */}
              <Composer key={p.activeSessionId} {...composerProps} draftKey={p.activeSessionId} />
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
  blobUrl?: (blob: string) => string;
  onPermission: ShellHandlers['permission'];
}

// Entrance stagger caps out at the 12th block, so long sessions don't take seconds
const STAGGER_CAP = 12;

// Conversation flow: stick-to-bottom following only happens on transcript changes (new content / streaming growth); user actions like expand / collapse never touch the scroll position —
// the toggle under the mouse stays put while the content below it moves. Scrolling away from the bottom releases the follow; scrolling back to the bottom restores it
function Thread({ turns, running, wide, replayKey, blobUrl, onPermission }: ThreadProps) {
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

  // Each user message sticks only within its own exchange. Automatic commands belong
  // to the preceding exchange so compaction does not replace the user's context.
  let i = 0;
  const exchanges: { key: number; messages: ReactNode[] }[] = [];
  turns.forEach((turn, ti) => {
    const index = Math.min(i, STAGGER_CAP);
    i += turn.role === 'agent' ? turn.blocks.length + 1 : 1;
    if (!exchanges.length || (turn.role === 'user' && !turn.auto)) {
      exchanges.push({ key: ti, messages: [] });
    }
    exchanges[exchanges.length - 1]!.messages.push(turn.role === 'user'
      ? <HistoryMessage key={turn.id ?? ti} turn={turn} turnIndex={ti} index={index} blobUrl={blobUrl} />
      : <AgentMessage key={ti} turn={turn} index={index} running={running && ti === turns.length - 1} onPermission={onPermission} />);
  });
  return (
    <div ref={ref} className="thread-scroll scroll-stable min-h-0 min-w-0 flex-1 overflow-y-auto px-page">
      <div key={replayKey} className={cn('mx-auto flex flex-col gap-msg pt-pad-y pb-gap', wide && 'max-w-(--content-w)')}>
        {exchanges.map(exchange => (
          <section key={exchange.key} className="flex min-w-0 flex-col gap-msg">
            {exchange.messages}
          </section>
        ))}
      </div>
    </div>
  );
}
