import type { AccountInfo, AgentId, AgentInfo, ConfigControl, SessionSummary, SessionView } from '@shared/transcript';
import type { AccountAction, AddAccountVia, WebviewMsg } from '@shared/protocol';
import type { HiddenMap } from '@shared/settings';
import type { AgentRuntimeInfo } from '@shared/inventory';
import { AgentRegistry } from './acp/AgentRegistry';
import { AcpSession, type CompactionPolicy, type SessionRecord } from './acp/AcpSession';
import type { AccountManager } from './accounts/AccountManager';
import { TranscriptStore, summarize } from './store/TranscriptStore';
import { t } from './i18n';

export interface ManagerDeps {
  registry: AgentRegistry;
  store: TranscriptStore;
  log: (line: string) => void;
  cwd: () => string;
  defaultAgent: () => AgentId;
  // Terminal-style login: open a terminal on the host and run the command
  runInTerminal: (title: string, command: string, args: string[]) => void;
  toast: (level: 'info' | 'error', text: string) => void;
  // Account layer (optional): agents on the account layer bind an account when opening a session
  accounts?: AccountManager;
  compaction?: () => CompactionPolicy;
  // Option families hidden from the composer menus (in VS Code, the acpilot.hiddenOptions setting, edited from the settings page)
  hidden?: () => HiddenMap;
}

export type ManagerEvent =
  | { type: 'agents'; agents: AgentInfo[] }
  | { type: 'sessions'; sessions: SessionSummary[] }
  | { type: 'session'; session: SessionView }
  | { type: 'accounts'; accounts: AccountInfo[] }
  | { type: 'accountActions'; actions: AccountAction[] }
  | { type: 'hidden'; hidden: HiddenMap };

// Master of all sessions: live processes, the summary list, the active item; every webview action enters here. No vscode import, so it stays testable
const TRASH_TTL = 30_000;

export class SessionManager {
  private live = new Map<string, AcpSession>();
  private index: SessionSummary[] = [];
  private trash = new Map<string, { summary: SessionSummary; timer: NodeJS.Timeout }>();
  private listeners = new Set<(ev: ManagerEvent) => void>();
  private accountActionState = new Map<AgentId, AccountAction>();
  activeId?: string;

  constructor(private deps: ManagerDeps) {
    deps.accounts?.subscribe(accounts => this.emit({ type: 'accounts', accounts }));
  }

  async init() {
    this.index = await this.deps.store.loadIndex();
    this.activeId = this.index[0]?.id;
    await this.deps.registry.probeAll();
  }

  get registry(): AgentRegistry { return this.deps.registry; }

  // Swap the registry (acpilot.agents changed): re-probe the binaries, then push the new list out
  setRegistry(r: AgentRegistry) {
    this.deps.registry = r;
    void r.probeAll().then(() => this.emit({ type: 'agents', agents: this.agents() }));
  }

  agents(): AgentInfo[] {
    return this.deps.registry.list().map(a => (this.deps.accounts?.supports(a.id) ? { ...a, accounts: true } : a));
  }

  accounts(): AccountInfo[] { return this.deps.accounts?.list() ?? []; }

  accountActions(): AccountAction[] { return [...this.accountActionState.values()]; }

  private setAccountAction(action: AccountAction) {
    this.accountActionState.set(action.agent, action);
    this.emit({ type: 'accountActions', actions: this.accountActions() });
  }

  // Version / MCP capabilities of an agent's live session (from its initialize response); undefined when nothing of that agent is running
  runtimeInfo(agent: AgentId): AgentRuntimeInfo | undefined {
    for (const s of this.live.values()) {
      if (s.agent !== agent) continue;
      const info = s.runtimeInfo();
      if (info) return info;
    }
    return undefined;
  }

  // VS Code's getConfiguration().get() returns a read-only Proxy that structuredClone / postMessage can't swallow; a JSON round-trip turns it into a plain object
  hidden(): HiddenMap { return JSON.parse(JSON.stringify(this.deps.hidden?.() ?? {})) as HiddenMap; }

  // The setting changed (settings page or a hand edit of settings.json): re-push a copy
  emitHidden() { this.emit({ type: 'hidden', hidden: this.hidden() }); }

  // The configOptions an agent offered most recently: from a live session when there is one, else from the newest stored record of that agent.
  // This is what the settings page lists when it lets families be hidden, since options only ever come over ACP
  async knownControls(agent: AgentId): Promise<ConfigControl[]> {
    for (const s of this.index) {
      if (s.agent !== agent) continue;
      const options = this.live.get(s.id)?.view().controls.options ?? (await this.deps.store.load(s.id))?.controls?.options;
      if (options?.length) return options;
    }
    return [];
  }

  sessions(): SessionSummary[] {
    return this.index.map(s => {
      const live = this.live.get(s.id);
      const turns = live?.view().turns ?? [];
      const last = turns[turns.length - 1];
      const state = live?.isRunning ? 'working'
        : turns.some(t => t.role === 'agent' && t.blocks.some(b => b.type === 'permission')) ? 'waiting'
          : last?.role === 'agent' && last.stop === 'error' ? 'error' : undefined;
      return { ...s, state };
    });
  }

  active(): SessionView | undefined {
    return this.activeId ? this.live.get(this.activeId)?.view() : undefined;
  }

  subscribe(fn: (ev: ManagerEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: ManagerEvent) { for (const fn of this.listeners) fn(ev); }
  private emitSessions() { this.emit({ type: 'sessions', sessions: this.sessions() }); }

  private onChange = (s: AcpSession) => {
    // A deleted session still calls back once while winding down; don't let it write its record back
    if (!this.live.has(s.id)) return;
    const i = this.index.findIndex(x => x.id === s.id);
    const sum = summarize(s.toRecord());
    if (i >= 0) this.index[i] = sum; else this.index.unshift(sum);
    this.sortIndex();
    this.deps.store.save(s.toRecord());
    void this.deps.store.saveIndex(this.index);
    if (s.id === this.activeId) this.emit({ type: 'session', session: s.view() });
    this.emitSessions();
  };

  private sessionDeps() {
    return {
      registry: this.deps.registry, log: this.deps.log, onChange: this.onChange, blobs: this.deps.store,
      notify: (text: string) => this.deps.toast('info', text), accounts: this.deps.accounts, compaction: this.deps.compaction,
    };
  }

  // On activation, if there is no session or the current one is gone, start a new one; otherwise bring the current session live (no replay)
  async ensureActive(): Promise<void> {
    if (this.activeId && this.live.has(this.activeId)) return;
    if (this.activeId) { await this.selectSession(this.activeId); return; }
    await this.newSession();
  }

  // Agents on the account layer: with no account specified, use that agent's default account (most recently used); if there is none, leave it unbound and let the Notice guide login
  async newSession(agent?: AgentId, accountId?: string): Promise<void> {
    const id = agent ?? this.deps.defaultAgent();
    const acc = this.deps.accounts?.supports(id) ? accountId ?? this.deps.accounts.defaultFor(id)?.id : undefined;
    await this.dropEmptyCurrent();
    const s = AcpSession.fresh(id, this.deps.cwd(), this.sessionDeps(), acc);
    this.live.set(s.id, s);
    this.activeId = s.id;
    this.onChange(s);
    await s.start();
  }

  // If the current session hasn't said a word yet (just opened / stuck on login), replace it directly; don't leave a trail of empty "New session" entries.
  // A session still staging its first prompt (attachments being written, no turn yet) is not empty
  private async dropEmptyCurrent() {
    const cur = this.current();
    if (!cur || cur.view().turns.length > 0 || cur.isRunning) return;
    cur.dispose();
    this.live.delete(cur.id);
    this.index = this.index.filter(x => x.id !== cur.id);
    await this.deps.store.remove(cur.id);
    await this.deps.store.saveIndex(this.index);
  }

  async selectSession(id: string): Promise<void> {
    if (this.activeId === id && this.live.has(id)) return;
    this.activeId = id;
    const live = this.live.get(id);
    if (live) { this.emit({ type: 'session', session: live.view() }); this.emitSessions(); return; }
    const record = await this.deps.store.load(id);
    if (!record) { this.deps.toast('error', t('host.recordLost')); this.index = this.index.filter(s => s.id !== id); this.emitSessions(); return; }
    const s = new AcpSession(record, this.sessionDeps());
    this.live.set(id, s);
    this.emit({ type: 'session', session: s.view() });
    await s.start();
  }

  private current(): AcpSession | undefined {
    return this.activeId ? this.live.get(this.activeId) : undefined;
  }

  async editTurn(edit: import('@shared/protocol').EditTurnRequest): Promise<void> {
    const session = this.live.get(edit.sessionId);
    if (!session) throw new Error(t('history.unavailable'));
    await session.editTurn(edit);
  }

  planDocument(sessionId: string, planId: string) {
    return this.live.get(sessionId)?.view().turns.flatMap(t => t.role === 'agent' ? t.blocks : [])
      .find(b => b.type === 'plan_document' && b.id === planId);
  }

  async handle(msg: WebviewMsg): Promise<void> {
    const s = this.current();
    try {
      switch (msg.type) {
        case 'send': await s?.prompt(msg.text, msg.attachments); break;
        case 'stop': await s?.cancel(); break;
        case 'permission': s?.resolvePermission(msg.blockId, msg.optionId); break;
        case 'buildPlan': await this.live.get(msg.sessionId)?.buildPlan(msg.planId, msg.model, msg.optionId); break;
        case 'setMode': await s?.setMode(msg.id); break;
        case 'setConfig': await s?.setConfig(msg.configId, msg.value); break;
        case 'selectAgent': if (s?.agent !== msg.id) await this.newSession(msg.id); break;
        case 'selectSession': await this.selectSession(msg.id); break;
        case 'newSession': await this.newSession(msg.agent); break;
        case 'renameSession': await this.renameSession(msg.id, msg.title); break;
        case 'deleteSession': await this.deleteSession(msg.id); break;
        case 'restoreSession': await this.restoreSession(msg.id); break;
        case 'pinSession': await this.pinSession(msg.id, msg.pinned); break;
        case 'selectAccount': await this.selectAccount(msg.id); break;
        case 'addAccount': await this.addAccount(msg.agent, msg.via); break;
        case 'removeAccount': await this.deps.accounts?.remove(msg.id); break;
        case 'compact': await s?.compact(); break;
        case 'retry': await s?.retry(); break;
        case 'retryTurn': await s?.retryTurn(); break;
        case 'login': await this.login(s, msg.methodId); break;
        default: break;
      }
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      this.deps.log(`handle ${msg.type} failed: ${text}`);
      this.deps.toast('error', text);
    }
  }

  // Rename / pin: for a live session, mutate the object (onChange syncs the index and the disk); for one not loaded, patch the on-disk record directly
  async renameSession(id: string, title: string) {
    const t = title.trim().slice(0, 80);
    if (!t) return;
    const live = this.live.get(id);
    if (live) { live.rename(t); return; }
    await this.patchRecord(id, r => { r.title = t; });
  }

  async pinSession(id: string, pinned: boolean) {
    const live = this.live.get(id);
    if (live) { live.setPinned(pinned); return; }
    await this.patchRecord(id, r => { r.pinned = pinned || undefined; });
  }

  private async patchRecord(id: string, patch: (r: SessionRecord) => void) {
    const r = await this.deps.store.load(id);
    if (!r) return;
    patch(r);
    await this.deps.store.flush(r);
    const i = this.index.findIndex(s => s.id === id);
    if (i >= 0) this.index[i] = summarize(r);
    this.sortIndex();
    await this.deps.store.saveIndex(this.index);
    this.emitSessions();
  }

  private sortIndex() {
    this.index.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  }

  // Deletion is soft: kill the process, drop it from the list, keep the record on disk in a "trash bin" with a 30-second undo window; the file is really deleted only after that.
  // If the deleted one is the current session, switch to the first in the list; if none, open a new one
  async deleteSession(id: string) {
    const live = this.live.get(id);
    if (live) { await this.deps.store.flush(live.toRecord()); live.dispose(); this.live.delete(id); }
    const sum = this.index.find(s => s.id === id);
    this.index = this.index.filter(s => s.id !== id);
    await this.deps.store.saveIndex(this.index);
    if (sum) {
      this.trash.set(id, { summary: sum, timer: setTimeout(() => { this.trash.delete(id); void this.deps.store.remove(id); }, TRASH_TTL) });
    }
    if (this.activeId === id) {
      this.activeId = undefined;
      const next = this.index[0]?.id;
      if (next) await this.selectSession(next); else await this.newSession();
    }
    this.emitSessions();
  }

  // Undo deletion: pull it back from the trash into the list; the record stayed on disk the whole time and restores as usual when opened
  async restoreSession(id: string) {
    const t = this.trash.get(id);
    if (!t) return;
    clearTimeout(t.timer);
    this.trash.delete(id);
    this.index.push(t.summary);
    this.sortIndex();
    await this.deps.store.saveIndex(this.index);
    this.emitSessions();
  }

  // Switching accounts = opening a new session with it (an agent process accepts only one credential; a session is bound to one account from start to finish); it also becomes the default account
  async selectAccount(accountId: string) {
    const acc = this.deps.accounts?.get(accountId);
    if (!acc) return;
    const cur = this.current();
    if (cur?.agent === acc.agent && cur.accountId === accountId && cur.alive) return;
    await this.deps.accounts!.touch(accountId);
    await this.newSession(acc.agent, accountId);
  }

  // Add an account: importing a local login is usable immediately; terminal login waits for the write in the background. If the current session is stuck on login, reopen it with the new account once added
  async addAccount(agent: AgentId, via: AddAccountVia) {
    const accounts = this.deps.accounts;
    if (!accounts || this.accountActionState.get(agent)?.status === 'pending') return;
    this.setAccountAction({ agent, via, status: 'pending' });
    try {
      const acc = via === 'import' ? await accounts.import(agent) : via === 'login' ? await accounts.login(agent) : await accounts.add(agent);
      if (!acc) {
        this.setAccountAction({ agent, via, status: via === 'import' ? 'missing' : 'cancelled' });
        return;
      }
      const cur = this.current();
      if (cur?.agent === agent && (cur.view().status === 'auth_required' || !cur.accountId)) await this.newSession(agent, acc.id);
      this.setAccountAction({ agent, via, status: 'success' });
    } catch (e) {
      this.setAccountAction({ agent, via, status: 'error', error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  // Login: prefer the agent's own authenticate; if that fails, run the registry's login command in a terminal
  private async login(s: AcpSession | undefined, methodId?: string) {
    if (!s) return;
    const def = this.deps.registry.get(s.agent);
    try {
      await s.authenticate(methodId);
      await s.retry();
    } catch (e) {
      this.deps.log(`authenticate failed: ${e instanceof Error ? e.message : String(e)}`);
      if (def.login) {
        // When the login command is the same binary as the agent, use the probed absolute path; a GUI process's PATH may not have it
        const bin = def.login.command === def.command ? await this.deps.registry.resolveBinary(s.agent) : null;
        this.deps.runInTerminal(t('host.loginTerminalTitle', { agent: def.name }), bin ?? def.login.command, def.login.args);
        this.deps.toast('info', t('host.loginThenRetry', { agent: def.name }));
      } else throw e;
    }
  }

  async dispose() {
    for (const s of this.live.values()) {
      await this.deps.store.flush(s.toRecord());
      s.dispose();
    }
    this.live.clear();
    // Trashed entries are cleaned up when their time comes
    for (const [id, t] of this.trash) { clearTimeout(t.timer); await this.deps.store.remove(id); }
    this.trash.clear();
  }
}
