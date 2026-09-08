import type { AccountInfo, AgentId, AgentInfo, ConfigControl, SessionSummary, SessionView } from '@shared/transcript';
import type { AccountAction, AddAccountVia, EditTurnRequest, WebviewMsg } from '@shared/protocol';
import type { HiddenMap } from '@shared/settings';
import type { AgentRuntimeInfo } from '@shared/inventory';
import { captureTurnSettings } from '@shared/turnSettings';
import { AgentRegistry } from './acp/AgentRegistry';
import { AgentPool } from './acp/AgentPool';
import { AcpSession, type CompactionPolicy, type SessionRecord } from './acp/AcpSession';
import type { AccountManager } from './accounts/AccountManager';
import { TranscriptStore, summarize, type SessionPrefs } from './store/TranscriptStore';
import { cloneJson } from './clone';
import { msg } from './errors';
import { t } from './i18n';
import { RENAME_MAX } from './limits';

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
  // Option families hidden from the composer menus (in VS Code, the acpira.hiddenOptions setting, edited from the settings page)
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
  private readonly pool: AgentPool;
  // Sessions seen running at the last onChange; a running → idle edge is the moment to re-read the account's quota
  private wasRunning = new Set<string>();
  // Mode of each live session at the last onChange: a change that did not come through setMode (a permission answer like Devin's
  // "switch to bypass mode", Kimi leaving plan after approval) is still the mode in effect, so it is remembered too
  private modeSeen = new Map<string, string>();
  private prefs: SessionPrefs = { lastSettings: {} };
  activeId?: string;

  constructor(private deps: ManagerDeps) {
    deps.accounts?.subscribe(accounts => this.emit({ type: 'accounts', accounts }));
    this.pool = new AgentPool({
      registry: () => this.deps.registry,
      log: line => this.deps.log(line),
      spawnEnv: (agent, accountId) => this.deps.accounts?.spawnEnv(agent, accountId) ?? Promise.resolve(undefined),
    });
  }

  async init() {
    this.index = await this.deps.store.loadIndex();
    this.prefs = await this.deps.store.loadPrefs();
    this.activeId = this.index[0]?.id;
    await this.deps.registry.probeAll();
    this.deps.accounts?.refreshQuotas().catch(e => this.deps.log(`quota refresh failed: ${msg(e)}`));
    this.warm(this.deps.defaultAgent());
  }

  private warm(agent: AgentId, accountId?: string) {
    const acc = accountId ?? (this.deps.accounts?.supports(agent) ? this.deps.accounts.defaultFor(agent)?.id : undefined);
    this.pool.ensure(agent, this.deps.cwd(), acc);
  }

  // The mode / config values last chosen for an agent, replayed onto its next new session
  lastSettings(agent: AgentId) { return this.prefs.lastSettings[agent]; }

  private remember(s: AcpSession) {
    this.prefs.lastSettings[s.agent] = captureTurnSettings(s.view().controls);
    this.savePrefs();
  }

  private rememberMode(agent: AgentId, modeId: string) {
    const cur = this.prefs.lastSettings[agent];
    if (cur?.modeId === modeId) return;
    this.prefs.lastSettings[agent] = { config: {}, ...cur, modeId };
    this.savePrefs();
  }

  // Fire-and-forget disk writes surface their failures in the log rather than as unhandled rejections
  private savePrefs() {
    this.deps.store.savePrefs(this.prefs).catch(e => this.deps.log(`prefs save failed: ${msg(e)}`));
  }

  private saveIndex() {
    this.deps.store.saveIndex(this.index).catch(e => this.deps.log(`index save failed: ${msg(e)}`));
  }

  get registry(): AgentRegistry { return this.deps.registry; }

  // Swap the registry (acpira.agents changed): re-probe the binaries, then push the new list out
  setRegistry(r: AgentRegistry) {
    this.deps.registry = r;
    r.probeAll().then(() => this.emit({ type: 'agents', agents: this.agents() })).catch(e => this.deps.log(`agent probe failed: ${msg(e)}`));
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

  hidden(): HiddenMap { return cloneJson(this.deps.hidden?.() ?? {}); }

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
        : turns.some(t => t.role === 'agent' && t.blocks.some(b => b.type === 'permission' || (b.type === 'question' && !b.outcome))) ? 'waiting'
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
    this.saveIndex();
    if (s.id === this.activeId) this.emit({ type: 'session', session: s.view() });
    this.emitSessions();
    if (s.isRunning) this.wasRunning.add(s.id);
    else if (this.wasRunning.delete(s.id) && s.accountId) this.deps.accounts?.refreshQuota(s.accountId, true).catch(e => this.deps.log(`quota refresh failed: ${msg(e)}`));
    // Only ready sessions count, and the first ready sighting only records: the mode a session opens with (agent default, or a restored
    // session's own) is not a new choice; a change after that is
    const view = s.view();
    if (view.status === 'ready') {
      this.pool.ensure(s.agent, s.cwd, s.accountId);
      const prev = this.modeSeen.get(s.id);
      const mode = view.controls.modeId ?? '';
      this.modeSeen.set(s.id, mode);
      if (prev !== undefined && mode && mode !== prev) this.rememberMode(s.agent, mode);
    }
  };

  private sessionDeps() {
    return {
      registry: this.deps.registry, log: this.deps.log, onChange: this.onChange, blobs: this.deps.store,
      notify: (text: string) => this.deps.toast('info', text), accounts: this.deps.accounts, compaction: this.deps.compaction,
      pool: this.pool,
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
    const cwd = this.deps.cwd();
    const cur = this.current();
    if (cur && this.keepEmpty(cur, id, acc, cwd)) return;
    await this.dropEmptyCurrent();
    const s = AcpSession.fresh(id, cwd, this.sessionDeps(), acc);
    s.previewControls(await this.knownControls(id), this.lastSettings(id));
    this.live.set(s.id, s);
    this.activeId = s.id;
    this.onChange(s);
    await s.start();
    const last = this.lastSettings(id);
    if (last) await s.adoptControls(last);
  }

  // Same agent / account / cwd and still empty: keep the process instead of killing it to spawn another
  private keepEmpty(cur: AcpSession, agent: AgentId, accountId: string | undefined, cwd: string) {
    if (cur.agent !== agent || cur.accountId !== accountId || cur.cwd !== cwd) return false;
    const v = cur.view();
    if (v.turns.length > 0 || cur.isRunning) return false;
    return v.status === 'starting' || v.status === 'ready';
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

  async editTurn(edit: EditTurnRequest): Promise<void> {
    const session = this.live.get(edit.sessionId);
    if (!session) throw new Error(t('history.unavailable'));
    await session.editTurn(edit);
  }

  planDocument(sessionId: string, planId: string) {
    return this.live.get(sessionId)?.view().turns.flatMap(t => t.role === 'agent' ? t.blocks : [])
      .find(b => b.type === 'plan_document' && b.id === planId);
  }

  async handle(m: WebviewMsg): Promise<void> {
    const s = this.current();
    try {
      switch (m.type) {
        case 'send': await s?.prompt(m.text, m.attachments); break;
        case 'stop': await s?.cancel(); break;
        case 'permission': s?.resolvePermission(m.blockId, m.optionId); break;
        case 'answer': s?.answerQuestions(m.blockId, m.answers, m.skip); break;
        case 'buildPlan': await this.live.get(m.sessionId)?.buildPlan(m.planId, m.model, m.optionId); break;
        case 'setMode': if (s) { await s.setMode(m.id); this.remember(s); } break;
        case 'setConfig': if (s) { await s.setConfig(m.configId, m.value); this.remember(s); } break;
        case 'selectAgent': if (s?.agent !== m.id) await this.newSession(m.id); break;
        case 'selectSession': await this.selectSession(m.id); break;
        case 'newSession': await this.newSession(m.agent); break;
        case 'renameSession': await this.renameSession(m.id, m.title); break;
        case 'deleteSession': await this.deleteSession(m.id); break;
        case 'restoreSession': await this.restoreSession(m.id); break;
        case 'pinSession': await this.pinSession(m.id, m.pinned); break;
        case 'selectAccount': await this.selectAccount(m.id); break;
        case 'addAccount': await this.addAccount(m.agent, m.via); break;
        case 'removeAccount': await this.deps.accounts?.remove(m.id); break;
        case 'refreshQuota': await this.deps.accounts?.refreshQuotas(m.agent); break;
        case 'compact': await s?.compact(); break;
        case 'retry': await s?.retry(); break;
        case 'retryTurn': await s?.retryTurn(); break;
        case 'dequeue': this.live.get(m.sessionId)?.dequeue(m.id); break;
        case 'sendQueued': await this.live.get(m.sessionId)?.sendQueued(m.id); break;
        case 'editQueued': await this.live.get(m.sessionId)?.editQueued(m.id, m.text, m.retainedAttachments, m.attachments); break;
        case 'login': await this.login(s, m.methodId); break;
        default: break;
      }
    } catch (e) {
      const text = msg(e);
      this.deps.log(`handle ${m.type} failed: ${text}`);
      this.deps.toast('error', text);
    }
  }

  // Rename / pin: for a live session, mutate the object (onChange syncs the index and the disk); for one not loaded, patch the on-disk record directly
  async renameSession(id: string, title: string) {
    const t = title.trim().slice(0, RENAME_MAX);
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
    this.wasRunning.delete(id);
    this.modeSeen.delete(id);
    const sum = this.index.find(s => s.id === id);
    this.index = this.index.filter(s => s.id !== id);
    await this.deps.store.saveIndex(this.index);
    if (sum) {
      this.trash.set(id, { summary: sum, timer: setTimeout(() => {
        this.trash.delete(id);
        this.deps.store.remove(id).catch(e => this.deps.log(`session ${id}: delete failed (${msg(e)})`));
      }, TRASH_TTL) });
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
      this.setAccountAction({ agent, via, status: 'error', error: msg(e) });
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
      this.deps.log(`authenticate failed: ${msg(e)}`);
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
    this.pool.dispose();
    // Trashed entries are cleaned up when their time comes
    for (const [id, t] of this.trash) { clearTimeout(t.timer); await this.deps.store.remove(id); }
    this.trash.clear();
    await this.deps.store.dispose();
  }
}
