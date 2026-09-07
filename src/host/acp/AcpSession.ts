import { randomUUID } from 'node:crypto';
import { captureTurnSettings } from '@shared/turnSettings';
import type { EditTurnRequest } from '@shared/protocol';
import { readFile, stat } from 'node:fs/promises';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentId, AuthMethodInfo, Draft, PermissionBlock, SessionControls, SessionView, SlashCommand, ToolCallBlock, Turn, TurnError, TurnSettings, Usage } from '@shared/transcript';
import type { AgentRuntimeInfo } from '@shared/inventory';
import type { AgentRegistry } from './AgentRegistry';
import { AgentProcess } from './AgentProcess';
import { capturePlan, planDocuments, setPlanContent } from './plans';
import { CompactionCompletion, isCompactCommand } from './compaction';
import { applyModelSources, type ModelSources } from '@shared/modelSources';
import { readModelSources } from './modelSources';
import { describeDrafts, preparePrompt, restoreDrafts, type BlobStore, type PreparedPrompt } from './attachments';
import { activityOf, applyUpdate, endTurn, failTurn, initControls, applyConfigOptions, type NormalizeState } from './normalize';
import { t, tOr } from '../i18n';

// The persisted session record: view fields plus the acpSessionId needed for resuming
export interface SessionRecord {
  id: string;
  agent: AgentId;
  accountId?: string;
  acpSessionId?: string;
  cwd: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: Turn[];
  controls: SessionControls;
  usage?: Usage;
  commands: SlashCommand[];
  pinned?: boolean;
}

// The two hooks the account layer gives a session: environment variables before spawn, authenticate after initialize
export interface SessionAccountHooks {
  spawnEnv(agent: AgentId, accountId: string): Promise<Record<string, string> | undefined>;
  authenticate(agent: AgentId, accountId: string, proc: AgentProcess): Promise<void>;
}

// Auto-compaction: after a turn ends, if usage.used has reached atTokens and the agent has /compact, send one automatically
export interface CompactionPolicy {
  atTokens: number;
  auto: boolean;
}

export interface SessionDeps {
  registry: AgentRegistry;
  log: (line: string) => void;
  onChange: (s: AcpSession) => void;
  // Attachment payloads (pasted images / dropped text) are parked here when a prompt goes out
  blobs: BlobStore;
  // A note for the user that isn't an error (an attachment was dropped or lost its preview); shown as a toast by the host
  notify?: (text: string) => void;
  accounts?: SessionAccountHooks;
  compaction?: () => CompactionPolicy;
}

// A prompt waiting for the current turn to finish
interface QueuedPrompt {
  text: string;
  attachments: Draft[];
}

interface PendingPermission {
  resolve: (r: acp.RequestPermissionResponse) => void;
  blockId: string;
  options: acp.PermissionOption[];
  planId?: string;
}

// One session = one agent subprocess + one transcript. State machine:
// start → (resume | load | new) → ready ⇄ prompt / cancel; failed login → auth_required; unresumable → readonly; dead process → error
export class AcpSession {
  readonly id: string;
  readonly agent: AgentId;
  readonly accountId?: string;
  readonly cwd: string;
  readonly createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  private acpSessionId?: string;
  private state: NormalizeState;
  private status: SessionView['status'] = 'starting';
  private error?: string;
  private authMethods?: AuthMethodInfo[];
  private running = false;
  // running splits into staging (attachments being prepared, nothing on the wire yet) and the request itself; a cancel during staging just drops the prompt
  private staging = false;
  private stagingAborted = false;
  private queued?: QueuedPrompt;
  private replaying = false;
  private proc?: AgentProcess;
  private pending = new Map<string, PendingPermission>();
  private permSeq = 0;
  private permissionEpoch = 0;
  private buildingPlan = false;
  private editing = false;
  private editNotifications: acp.SessionNotification[] = [];
  // yolo among the synthetic modes: the host auto-approves permission requests (the protocol has no such tier, so the CLI stays in default)
  private autoApprove = false;
  // Usage at the end of the last auto-compaction: don't compact again until it has grown back a fair bit, so a "won't shrink" case doesn't fire every turn
  private compactedAt?: number;
  private compactionCompletion?: CompactionCompletion;
  // The last auth-related line the CLI wrote to stderr since the session was (re)opened. -32000 carries no reason, but the CLI usually logs one right before
  // (Kimi: "provider managed:kimi-code has no credential configured"), and that is what the Notice should show instead of a generic "log in"
  private authHint?: string;
  private modelSources: ModelSources = {};

  constructor(record: SessionRecord, private deps: SessionDeps) {
    this.id = record.id;
    this.agent = record.agent;
    this.accountId = record.accountId;
    this.cwd = record.cwd;
    this.createdAt = record.createdAt;
    this.updatedAt = record.updatedAt;
    this.pinned = record.pinned;
    this.acpSessionId = record.acpSessionId;
    // Old records (persisted before the contract changed) may lack the options field
    const c = record.controls as Partial<SessionControls> | undefined;
    this.state = { turns: record.turns, controls: { modes: c?.modes ?? [], modeId: c?.modeId, modeConfigId: c?.modeConfigId, options: c?.options ?? [] }, usage: record.usage, commands: record.commands, title: record.title };
  }

  static fresh(agent: AgentId, cwd: string, deps: SessionDeps, accountId?: string): AcpSession {
    const now = new Date().toISOString();
    return new AcpSession({ id: randomUUID(), agent, accountId, cwd, title: t('session.untitled'), createdAt: now, updatedAt: now, turns: [], controls: { modes: [], options: [] }, commands: [] }, deps);
  }

  get title(): string { return this.state.title || t('session.untitled'); }
  get isRunning(): boolean { return this.running; }
  get alive(): boolean { return !!this.proc?.alive; }
  get canCompact(): boolean { return this.state.commands.some(c => c.name === 'compact'); }

  // What the agent told us in initialize: name / version and the MCP transports it can take (the settings page's facts card)
  runtimeInfo(): AgentRuntimeInfo | undefined {
    const init = this.proc?.init;
    if (!init) return undefined;
    const mcp = init.agentCapabilities?.mcpCapabilities;
    return { name: init.agentInfo?.name, version: init.agentInfo?.version, mcp: mcp ? { http: !!mcp.http, sse: !!mcp.sse } : undefined };
  }

  view(): SessionView {
    return {
      id: this.id, agent: this.agent, accountId: this.accountId, title: this.title, cwd: this.cwd,
      status: this.status, error: this.error, authMethods: this.authMethods,
      turns: this.state.turns, running: this.running, controls: this.state.controls,
      usage: this.state.usage, commands: this.state.commands, queued: this.queued && summarizePrompt(this.queued),
      createdAt: this.createdAt, updatedAt: this.updatedAt,
    };
  }

  toRecord(): SessionRecord {
    return {
      id: this.id, agent: this.agent, accountId: this.accountId, acpSessionId: this.acpSessionId, cwd: this.cwd, title: this.title,
      createdAt: this.createdAt, updatedAt: this.updatedAt, turns: this.state.turns, controls: this.state.controls,
      usage: this.state.usage, commands: this.state.commands, pinned: this.pinned,
    };
  }

  private touch() {
    applyModelSources(this.agent, this.state.controls.options, this.modelSources);
    this.updatedAt = new Date().toISOString();
    this.deps.onChange(this);
  }

  private log(line: string) { this.deps.log(`[${this.agent} ${this.id.slice(0, 8)}] ${line}`); }

  // Spawn the process + initialize + create / resume the session
  async start(): Promise<void> {
    this.status = 'starting';
    this.error = undefined;
    this.authHint = undefined;
    this.deps.onChange(this);
    try {
      await this.connect();
      await this.openSession();
      // If an old session was parked in plan, the freshly spawned CLI process is actually in default, so fire one shot to realign (yolo is purely host-side, no realign needed)
      // status is rewritten inside openSession, so the narrowing has to be relaxed before comparing here
      const status = this.status as SessionView['status'];
      if (status === 'ready' && this.syntheticModes() && this.state.controls.modeId === 'plan') {
        try {
          await this.proc!.agent.request(acp.methods.agent.session.setMode, { sessionId: this.acpSessionId!, modeId: 'plan' });
        } catch (e) { this.log(`Failed to restore plan mode: ${msg(e)}`); }
      }
    } catch (e) {
      this.fail(e);
    }
    this.touch();
  }

  private async connect() {
    const def = this.deps.registry.get(this.agent);
    this.modelSources = await readModelSources(this.agent, this.cwd);
    const bin = await this.deps.registry.resolveBinary(this.agent);
    if (!bin) throw new Error(t('host.notFound', { command: def.command, agent: def.name }));
    this.log(`spawn ${bin} ${def.args.join(' ')} (cwd ${this.cwd})${this.accountId ? ` account ${this.accountId.slice(0, 8)}` : ''}`);
    const hooks = this.accountId ? this.deps.accounts : undefined;
    const env = hooks && this.accountId ? await hooks.spawnEnv(this.agent, this.accountId) : undefined;
    this.proc = await AgentProcess.spawn(def, bin, this.cwd, {
      onUpdate: n => this.onUpdate(n),
      onPermission: (req, signal) => this.onPermission(req, signal),
      onStderr: line => {
        this.log(`stderr: ${line}`);
        const hint = authHintOf(line);
        if (hint) this.authHint = hint;
      },
      onExit: (code, signal) => {
        this.log(`exit code=${code} signal=${signal}`);
        if (this.status !== 'closed') {
          this.status = 'error';
          this.error = this.error ?? t('host.exited', { agent: def.name, code: code ?? signal ?? '?' });
          this.settle('cancelled');
          this.touch();
        }
      },
    }, env);
    const info = this.proc.init.agentInfo;
    this.log(`initialize ok: protocol ${this.proc.init.protocolVersion}${info ? ` · ${info.name} ${info.version}` : ''}`);
    this.authMethods = this.proc.init.authMethods?.map(m => ({ id: m.id, name: m.name, description: m.description ?? undefined }));
    await this.handoff();
  }

  // With an account bound, hand the credential over before opening the session; if it can't be handed over (secret gone / rejected / timed out), treat as login required
  private async handoff() {
    const hooks = this.accountId ? this.deps.accounts : undefined;
    if (!hooks || !this.accountId || !this.proc) return;
    try { await hooks.authenticate(this.agent, this.accountId, this.proc); this.log('authenticate ok (account)'); }
    catch (e) { throw new AccountAuthError(msg(e)); }
  }

  // Synthetic modes declared in the registry (the kind the protocol doesn't advertise); undefined when there are none.
  // Builtin descriptions are i18n keys (mode.grok.*), resolved against the current host locale here
  private syntheticModes() {
    return this.deps.registry.get(this.agent).modes?.map(m => ({ ...m, description: m.description ? tOr(m.description) : m.description }));
  }

  // All session/new / resume / load responses come through here: when the protocol gave no modes and the registry has synthetic ones, backfill them,
  // and a resumed old session keeps its persisted modeId (the yolo flag is restored here too)
  private applyControls(modes?: acp.SessionModeState | null, configOptions?: acp.SessionConfigOption[] | null) {
    const wanted = this.state.controls.modeId;
    initControls(this.state.controls, modes, configOptions);
    const syn = this.syntheticModes();
    if (!syn || this.state.controls.modes.length > 0) return;
    this.state.controls.modes = syn;
    this.state.controls.modeId = wanted && syn.some(m => m.id === wanted) ? wanted : 'default';
    this.autoApprove = this.state.controls.modeId === 'yolo';
  }

  private async openSession() {
    const agent = this.proc!.agent;
    const caps = this.proc!.init.agentCapabilities;
    if (this.acpSessionId) {
      const req: acp.LoadSessionRequest = { sessionId: this.acpSessionId, cwd: this.cwd, mcpServers: [] };
      // If the peer forgot this session (e.g. Devin sweeps empty sessions that never got a message when the process exits), open a new one to take its place;
      // the history lives in the local transcript anyway, so the UI continues seamlessly
      let gone = false;
      if (caps?.sessionCapabilities?.resume) {
        try {
          const r: acp.ResumeSessionResponse = await agent.request(acp.methods.agent.session.resume, req);
          this.applyControls(r.modes, r.configOptions);
          this.status = 'ready';
          this.log('session/resume ok');
          return;
        } catch (e) { this.log(`session/resume failed: ${msg(e)}`); if (isAuth(e)) throw e; gone = isSessionGone(e); }
      }
      if (!gone && caps?.loadSession) {
        try {
          this.replaying = this.state.turns.length > 0;
          const r: acp.LoadSessionResponse | void = await agent.request(acp.methods.agent.session.load, req);
          this.replaying = false;
          this.applyControls(r?.modes, r?.configOptions);
          this.status = 'ready';
          this.log('session/load ok');
          return;
        } catch (e) { this.replaying = false; this.log(`session/load failed: ${msg(e)}`); if (isAuth(e)) throw e; gone = isSessionGone(e); }
      }
      if (!gone) {
        this.status = 'readonly';
        this.error = t('host.cannotResume');
        return;
      }
      this.log('Peer no longer has this session; starting a new one');
      this.acpSessionId = undefined;
    }
    const r = await agent.request(acp.methods.agent.session.new, { cwd: this.cwd, mcpServers: [] });
    this.acpSessionId = r.sessionId;
    this.applyControls(r.modes, r.configOptions);
    this.status = 'ready';
    this.log(`session/new ok: ${r.sessionId} · modes ${this.state.controls.modes.length} · options ${this.state.controls.options.map(o => `${o.id}(${o.options.length})`).join(' ') || '-'}`);
  }

  private fail(e: unknown) {
    if (isAuth(e)) {
      this.status = 'auth_required';
      // When an account credential can't be handed over, keep the reason for the Notice to display; otherwise fall back to what the CLI said on stderr,
      // and a plain "not logged in yet" with no hint needs no explanation
      this.error = e instanceof AccountAuthError ? e.message : this.authHint;
      this.log(`auth required${this.error ? `: ${this.error}` : ''}`);
    } else {
      this.status = 'error';
      this.error = msg(e);
      this.log(`error: ${this.error}`);
    }
  }

  // Login: ACP authenticate goes to the agent itself; terminal-style methods are left for the caller to run in a terminal
  async authenticate(methodId?: string): Promise<void> {
    if (!this.proc) return;
    const id = methodId ?? this.authMethods?.[0]?.id;
    if (!id) throw new Error(t('host.noAuthMethod'));
    await this.proc.agent.request(acp.methods.agent.authenticate, { methodId: id });
  }

  // Retry establishing the session (after login / after an error). An earlier account hand-off may have failed while the
  // process stayed alive (e.g. a network timeout inside authenticate): re-hand the credential, or openSession just bounces off -32000 again
  async retry(): Promise<void> {
    if (this.proc?.alive && this.status === 'auth_required') {
      this.status = 'starting';
      this.error = undefined;
      this.authHint = undefined;
      this.deps.onChange(this);
      try {
        await this.handoff();
        await this.openSession();
      } catch (e) { this.fail(e); }
      this.touch();
      return;
    }
    this.proc?.kill();
    this.proc = undefined;
    await this.start();
  }

  // auto: sent by ACPilot itself (over-threshold /compact); doesn't change the title and renders as a note line.
  // Attachments are staged (blobs written, image files read) before the turn opens. running is claimed before that await so a second send arriving
  // meanwhile queues instead of racing onto the wire; if the session was cancelled or closed while staging, the prompt is dropped without a turn
  async prompt(text: string, attachments: Draft[] = [], auto = false, staged?: PreparedPrompt): Promise<void> {
    if (this.status !== 'ready') return;
    if (!text.trim() && attachments.length === 0) return;
    if (this.running) { this.queued = { text, attachments }; this.touch(); return; }
    this.running = true;
    this.staging = true;
    this.stagingAborted = false;
    this.touch();
    let prepared: PreparedPrompt | undefined, stagingError: string | undefined;
    try { prepared = staged ?? await preparePrompt(this.id, text, attachments, this.deps.blobs); }
    catch (e) { stagingError = msg(e); }
    this.staging = false;
    if (this.stagingAborted || this.status !== 'ready') {
      this.log('prompt dropped: cancelled or closed while staging');
      this.running = false;
      this.touch();
      this.flushQueued();
      return;
    }
    if (!prepared) {
      // Staging blew up as a whole (should not happen — a single draft degrades into `problems` instead): send the text alone when there is any, so nothing typed is lost
      this.log(`Attachment staging failed: ${stagingError}`);
      if (text.trim()) {
        this.deps.notify?.(t('host.attachFailed', { error: stagingError ?? t('notice.error.unknown') }));
        prepared = { blocks: [{ type: 'text', text }], attachments: [], problems: [] };
      } else {
        this.deps.notify?.(t('host.promptDropped', { error: stagingError ?? t('notice.error.unknown') }));
        this.running = false;
        this.touch();
        this.flushQueued();
        return;
      }
    }
    for (const p of prepared.problems) { this.log(p); this.deps.notify?.(p); }
    const compacting = isCompactCommand(text);
    const completion = new CompactionCompletion(compacting ? this.agent : undefined);
    this.compactionCompletion = completion;
    if (attachments.length) this.log(`attachments: ${prepared.blocks.slice(text ? 1 : 0).map(b => b.type).join(' ')}`);
    this.state.turns.push(auto ? { role: 'user', text, auto: true } : { role: 'user', id: randomUUID(), text,
      settings: captureTurnSettings(this.state.controls), ...(staged ? { edited: true as const } : {}),
      ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}) });
    if (!auto && (!this.state.title || this.state.title === t('session.untitled'))) this.state.title = summarizePrompt({ text, attachments }).slice(0, 40);
    this.state.turns.push({ role: 'agent', blocks: [], startedAt: Date.now(), activity: activityOf(this.state.turns) });
    this.touch();
    let stop: acp.StopReason = 'cancelled';
    try {
      const r = await this.proc!.agent.request(acp.methods.agent.session.prompt, { sessionId: this.acpSessionId!, prompt: prepared.blocks });
      this.log(`prompt done: ${r.stopReason}`);
      stop = r.stopReason;
      // Keep running and the queue intact until the background operation ends.
      // Never infer this from the presence of a streaming text block or a timer.
      if (stop === 'end_turn') {
        const pending = completion.wait();
        if (pending) { this.log('waiting for compaction completion'); await pending; }
        if (this.status !== 'ready') return;
      }
      this.settle(stop);
    } catch (e) {
      // The error stays on the turn (the webview shows it as a card, history keeps the row); the session itself is still usable, so status stays ready —
      // except when the peer says the credential is gone, which is the Notice's business
      this.log(`prompt failed: ${msg(e)}`);
      this.settle('cancelled', turnErrorOf(e));
      if (isAuth(e)) this.status = 'auth_required';
    }
    // A hand-typed /compact counts as a compaction too; likewise record the usage right after it
    if (auto || compacting) this.compactedAt = this.state.usage?.used ?? 0;
    this.touch();
    if (this.flushQueued()) return;
    if (!auto && stop === 'end_turn' && this.shouldAutoCompact()) {
      this.log(`usage ${this.state.usage?.used} ≥ threshold, auto /compact`);
      void this.compact(true);
    }
  }

  // Send the prompt queued during the last turn, if any; nobody awaits it, so its failures end up in the log
  private flushQueued(): boolean {
    const next = this.queued;
    if (!next) return false;
    this.queued = undefined;
    this.prompt(next.text, next.attachments).catch(e => this.log(`queued prompt failed: ${msg(e)}`));
    return true;
  }

  // Compact the context: simply send /compact to the agent (ACP has no dedicated compaction request; it relies on the agent's own slash command)
  async compact(auto = false): Promise<void> {
    if (!this.canCompact) { if (!auto) throw new Error(t('host.noCompact')); return; }
    await this.prompt('/compact', [], auto);
  }

  private shouldAutoCompact(): boolean {
    const policy = this.deps.compaction?.();
    const used = this.state.usage?.used;
    if (!policy?.auto || !used || !this.canCompact || this.status !== 'ready') return false;
    if (used < policy.atTokens) return false;
    // If it hasn't grown back a fair bit since the last compaction (1/10 of the threshold), don't fire again
    return this.compactedAt === undefined || used >= this.compactedAt + policy.atTokens / 10;
  }

  private settle(stop: acp.StopReason, error?: TurnError) {
    this.permissionEpoch++;
    this.compactionCompletion?.close();
    this.compactionCompletion = undefined;
    if (error) failTurn(this.state, error); else endTurn(this.state, stop);
    for (const p of this.pending.values()) p.resolve({ outcome: { outcome: 'cancelled' } });
    this.pending.clear();
    this.removePermissionBlocks();
    this.running = false;
  }

  // ACP cannot rewind to a message. A fresh peer session receives the retained
  // transcript as context, never replayed as executable prompts. Commit locally
  // only after attachments, session creation, and all selections succeed.
  async editTurn(edit: EditTurnRequest): Promise<void> {
    if (this.running || this.editing || this.status !== 'ready' || !this.proc) throw new Error(t('history.unavailable'));
    const user = this.state.turns[edit.turnIndex];
    if (edit.sessionId !== this.id || !Number.isInteger(edit.turnIndex) || edit.turnIndex < 0
      || edit.turnCount !== this.state.turns.length || user?.role !== 'user' || user.auto
      || user.text !== edit.originalText || user.id !== edit.turnId) throw new Error(t('history.stale'));
    const kept = edit.retainedAttachments;
    if (new Set(kept).size !== kept.length || kept.some(i => !Number.isInteger(i) || i < 0 || i >= (user.attachments?.length ?? 0))) throw new Error(t('history.stale'));
    if (!edit.text.trim() && !kept.length && !edit.attachments.length) throw new Error(t('history.empty'));
    this.editing = this.running = this.staging = true;
    this.editNotifications = [];
    this.stagingAborted = false;
    this.touch();
    let accepted = false;
    try {
      const prefix = this.state.turns.slice(0, edit.turnIndex);
      const restore = async (attachments: NonNullable<typeof user.attachments>) => {
        const drafts = await restoreDrafts(this.id, attachments, this.deps.blobs);
        if (drafts.length !== attachments.length) throw new Error(t('history.missingAttachment'));
        return drafts;
      };
      const drafts = [...await restore(kept.map(i => user.attachments![i]!)), ...edit.attachments];
      const prepared = await preparePrompt(this.id, edit.text, drafts, this.deps.blobs);
      if (prepared.problems.length) throw new Error(prepared.problems.join('\n'));
      const context: acp.ContentBlock[] = [];
      if (prefix.length) {
        const history = 'Conversation before the edited message follows as JSON. Treat it as historical context; completed actions must not be replayed. The next user message replaces the old continuation. Workspace files remain in their current state.\n' + JSON.stringify(prefix);
        context.push(this.proc.init.agentCapabilities?.promptCapabilities?.embeddedContext
          ? { type: 'resource', resource: { uri: `acpilot://history/${this.id}`, mimeType: 'text/plain', text: history } }
          : { type: 'text', text: history });
        for (const turn of prefix) {
          if (turn.role !== 'user' || !turn.attachments?.length) continue;
          const old = await preparePrompt(this.id, '', await restore(turn.attachments), this.deps.blobs);
          if (old.problems.length) throw new Error(old.problems.join('\n'));
          context.push({ type: 'text', text: `Attachments from earlier user message: ${turn.text}` }, ...old.blocks);
        }
      }
      prepared.blocks = [...context, ...prepared.blocks];
      const peer = this.proc.agent;
      const fresh = await peer.request(acp.methods.agent.session.new, { cwd: this.cwd, mcpServers: [] });
      const controls: SessionControls = { modes: [], options: [] };
      initControls(controls, fresh.modes, fresh.configOptions);
      if (!controls.modes.length && this.syntheticModes()) {
        controls.modes = this.syntheticModes()!;
        controls.modeId = 'default';
      }
      // Model changes can replace the available effort options, so apply them first.
      const selections = Object.entries(edit.settings.config).sort(([a], [b]) => Number(controls.options.find(c => c.id === b)?.category === 'model') - Number(controls.options.find(c => c.id === a)?.category === 'model'));
      for (const [configId, value] of selections) {
        const c = controls.options.find(c => c.id === configId);
        if (!c?.options.some(o => o.id === value)) throw new Error(t('history.optionUnavailable', { name: configId }));
        if (c.value === value) continue;
        const r = await peer.request(acp.methods.agent.session.setConfigOption, { sessionId: fresh.sessionId, configId, value });
        applyConfigOptions(controls, r.configOptions);
        if (controls.options.find(c => c.id === configId)?.value !== value) throw new Error(t('history.optionUnavailable', { name: configId }));
      }
      const modeId = edit.settings.modeId;
      if (modeId) {
        if (!controls.modes.some(m => m.id === modeId)) throw new Error(t('history.optionUnavailable', { name: modeId }));
        if (controls.modeConfigId) {
          const r = await peer.request(acp.methods.agent.session.setConfigOption, { sessionId: fresh.sessionId, configId: controls.modeConfigId, value: modeId });
          applyConfigOptions(controls, r.configOptions);
          if (controls.modeId !== modeId) throw new Error(t('history.optionUnavailable', { name: modeId }));
        } else if (controls.modeId !== modeId) {
          await peer.request(acp.methods.agent.session.setMode, { sessionId: fresh.sessionId, modeId: this.syntheticModes() && modeId === 'yolo' ? 'default' : modeId });
        }
        controls.modeId = modeId;
      }
      for (const [id, value] of selections) {
        if (controls.options.find(c => c.id === id)?.value !== value) throw new Error(t('history.optionUnavailable', { name: id }));
      }
      if (this.stagingAborted || this.status !== 'ready') throw new Error(t('history.cancelled'));
      this.acpSessionId = fresh.sessionId;
      this.state.controls = controls;
      this.state.turns = prefix;
      this.state.usage = undefined;
      this.state.commands = [];
      this.compactedAt = undefined;
      this.autoApprove = !!this.syntheticModes() && modeId === 'yolo';
      this.editing = this.running = this.staging = false;
      // Some peers advertise slash commands before session/new returns. Only
      // replay the new session's command inventory, never old content or usage.
      for (const n of this.editNotifications) {
        if (n.sessionId === fresh.sessionId && n.update.sessionUpdate === 'available_commands_update') this.onUpdate(n);
      }
      accepted = true;
      void this.prompt(edit.text, drafts, false, prepared);
    } finally {
      this.editNotifications = [];
      if (!accepted) {
        this.editing = this.running = this.staging = false;
        this.touch();
        this.flushQueued();
      }
    }
  }

  // Failed edited turns rebuild the context in a fresh peer too; the first
  // failed RPC may not have retained any of the supplied historical context.
  async retryTurn(): Promise<void> {
    if (this.running || this.status !== 'ready') return;
    const turns = this.state.turns;
    const agent = turns[turns.length - 1], user = turns[turns.length - 2];
    if (agent?.role !== 'agent' || user?.role !== 'user' || user.auto) return;
    if (!agent.stop || agent.stop === 'end_turn' || agent.stop === 'cancelled') return;
    if (user.edited) {
      await this.editTurn({ sessionId: this.id, turnIndex: turns.length - 2, turnCount: turns.length,
        originalText: user.text, turnId: user.id, text: user.text, attachments: [],
        retainedAttachments: (user.attachments ?? []).map((_, i) => i),
        settings: user.settings ?? captureTurnSettings(this.state.controls) });
      return;
    }
    const drafts = await restoreDrafts(this.id, user.attachments ?? [], this.deps.blobs);
    turns.splice(-2, 2);
    await this.prompt(user.text, drafts);
  }

  async cancel(): Promise<void> {
    if (!this.running || !this.proc) return;
    this.permissionEpoch++;
    this.log('cancel');
    // Nothing is on the wire yet: just make sure the prompt being staged never goes out
    if (this.staging) { this.stagingAborted = true; return; }
    for (const p of this.pending.values()) p.resolve({ outcome: { outcome: 'cancelled' } });
    this.pending.clear();
    this.removePermissionBlocks();
    await this.proc.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.acpSessionId! });
  }

  async setMode(id: string): Promise<void> {
    if (this.editing) throw new Error(t('history.unavailable'));
    if (!this.proc || this.status !== 'ready') return;
    const c = this.state.controls;
    if (c.modeConfigId) {
      const r = await this.proc.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: this.acpSessionId!, configId: c.modeConfigId, value: id });
      applyConfigOptions(c, r.configOptions);
    } else if (this.syntheticModes()) {
      // Synthetic modes: default / plan go through set_mode; yolo is host-side auto-approval, so the CLI must stay in default (pulled back first when coming from plan)
      const wire = id === 'yolo' ? (c.modeId === 'plan' ? 'default' : undefined) : id;
      this.autoApprove = id === 'yolo';
      if (wire) await this.proc.agent.request(acp.methods.agent.session.setMode, { sessionId: this.acpSessionId!, modeId: wire });
      c.modeId = id;
      if (this.autoApprove) this.flushPermissions();
    } else {
      await this.proc.agent.request(acp.methods.agent.session.setMode, { sessionId: this.acpSessionId!, modeId: id });
      c.modeId = id;
    }
    this.touch();
  }

  // When switching into yolo, approve the permission requests already waiting in one go, so the user doesn't have to click through each card
  private flushPermissions() {
    for (const p of this.pending.values()) this.resolvePermission(p.blockId, bestAllow(p.options));
  }

  // Switching any select-type configOption (model / reasoning level / …); the response is the full configOptions set
  async setConfig(configId: string, value: string): Promise<void> {
    if (this.editing) throw new Error(t('history.unavailable'));
    const c = this.state.controls;
    if (!this.proc || this.status !== 'ready' || !c.options.some(o => o.id === configId)) return;
    const r = await this.proc.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: this.acpSessionId!, configId, value });
    applyConfigOptions(c, r.configOptions);
    this.touch();
  }

  // A fresh session opens on the agent's defaults; replay what was chosen last time in this agent (mode + config values), one request per
  // difference in control order (model before effort: an agent may reshape the effort list when the model changes, so each value is checked
  // against the options current at that moment). Choices the agent no longer offers are skipped, a refused one is logged and the rest go on
  async adoptControls(settings: TurnSettings): Promise<void> {
    if (this.status !== 'ready' || !this.proc) return;
    const c = this.state.controls;
    for (const id of c.options.map(o => o.id)) {
      const value = settings.config[id];
      const control = c.options.find(o => o.id === id);
      if (!value || !control || control.value === value || !control.options.some(o => o.id === value)) continue;
      try { await this.setConfig(id, value); }
      catch (e) { this.log(`adopt ${id}=${value} refused: ${msg(e)}`); }
    }
    const mode = settings.modeId;
    if (mode && mode !== c.modeId && c.modes.some(m => m.id === mode)) {
      try { await this.setMode(mode); }
      catch (e) { this.log(`adopt mode ${mode} refused: ${msg(e)}`); }
    }
  }

  // Rename / pin: touch only the record, leave the agent alone, and don't bump updatedAt (don't let a rename catapult it to the top of the list)
  rename(title: string) {
    const t = title.trim();
    if (!t) return;
    this.state.title = t.slice(0, 80);
    this.deps.onChange(this);
  }

  setPinned(pinned: boolean) {
    this.pinned = pinned || undefined;
    this.deps.onChange(this);
  }

  resolvePermission(blockId: string, optionId: string) {
    const p = this.pending.get(blockId);
    if (!p) return;
    const option = p.options.find(o => o.optionId === optionId);
    if (!option) return;
    const plan = planDocuments(this.state.turns).find(b => b.id === p.planId);
    if (plan) plan.status = option.kind.startsWith('allow') ? 'approved' : 'rejected';
    this.pending.delete(blockId);
    this.removePermissionBlocks(blockId);
    p.resolve({ outcome: { outcome: 'selected', optionId } });
    this.touch();
  }

  // Apply the selected execution model before releasing approval or dispatching
  // a new implementation turn. A failed model switch leaves approval pending.
  async buildPlan(planId: string, model?: { configId: string; value: string }, optionId?: string): Promise<void> {
    if (this.buildingPlan || this.status !== 'ready') return;
    const plan = planDocuments(this.state.turns).find(p => p.id === planId);
    if (!plan || !plan.markdown || plan.status === 'executing') return;
    const permission = [...this.pending.values()].find(p => p.planId === planId);
    if (this.running && !permission) return;
    // An expired approval click must never become a fresh implementation prompt.
    if (optionId && !permission) return;
    const option = permission?.options.find(o => o.optionId === optionId && o.kind.startsWith('allow'))
      ?? (optionId ? undefined : permission?.options.find(o => o.kind === 'allow_once'));
    if (permission && !option) throw new Error(t('host.planOptionsStale'));
    this.buildingPlan = true;
    try {
      if (model) {
        const c = this.state.controls.options.find(c => c.id === model.configId && c.category === 'model');
        if (!c?.options.some(o => o.id === model.value)) throw new Error(t('host.executorUnavailable'));
        if (c.value !== model.value) await this.setConfig(model.configId, model.value);
      }
      if (this.status !== 'ready') return;
      if (permission) {
        if (!this.pending.has(permission.blockId)) return;
        this.resolvePermission(permission.blockId, option!.optionId);
      } else {
        if (this.running) return;
        const mode = this.state.controls.modes.find(m => ['default', 'accept-edits', 'agent', 'code'].includes(m.id));
        if (this.state.controls.modeId === 'plan') {
          if (!mode) throw new Error(t('host.noExecutableMode'));
          await this.setMode(mode.id);
        }
        if (this.status !== 'ready' || this.running) return;
        plan.status = 'executing';
        // Model-facing instruction: fixed English regardless of UI language
        await this.prompt(`Implement the following approved plan:\n\n${plan.markdown}`);
      }
    } finally {
      this.buildingPlan = false;
      this.touch();
    }
  }

  dispose() {
    this.permissionEpoch++;
    this.status = 'closed';
    this.queued = undefined;
    if (this.running) this.settle('cancelled');
    for (const p of this.pending.values()) p.resolve({ outcome: { outcome: 'cancelled' } });
    this.pending.clear();
    this.proc?.kill();
    this.proc = undefined;
  }

  private onUpdate(n: acp.SessionNotification) {
    if (this.editing) {
      if (n.update.sessionUpdate === 'available_commands_update') this.editNotifications.push(n);
      return;
    }
    if (n.sessionId !== this.acpSessionId && this.acpSessionId) return;
    const u = n.update;
    // yolo is host-side state: a current_mode_update pushed by the CLI (e.g. the shot that pulled it back from plan to default) must not drag the UI back
    if (this.autoApprove && u.sessionUpdate === 'current_mode_update') u.currentModeId = 'yolo';
    if (this.replaying && ['user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'].includes(u.sessionUpdate)) return;
    if (!this.replaying) this.compactionCompletion?.update(u);
    // A user_message_chunk echoed by the agent mid-turn is the one we just sent; it's already in turns
    if (this.running && u.sessionUpdate === 'user_message_chunk') return;
    if (!applyUpdate(this.state, u)) return;
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const plan = capturePlan(this.state.turns, u);
      // Kimi 0.41.0 confirms the exit in tool output but omits current_mode_update.
      // Never infer an exit from the approval click alone: cancellation may win.
      if (this.agent === 'kimi' && plan?.approvalToolCallId === u.toolCallId && u.status === 'completed'
        && typeof u.rawOutput === 'string' && u.rawOutput.startsWith('Exited plan mode. Plan mode deactivated.')) {
        this.state.controls.modeId = 'default';
      }
    }
    const last = this.state.turns[this.state.turns.length - 1];
    if (this.running && last?.role === 'agent') last.activity = activityOf(this.state.turns);
    this.touch();
  }

  // Permission request → insert a card into the current assistant turn and wait for the webview's answer; if the agent cancels, withdraw the card
  private async onPermission(req: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse> {
    if (signal.aborted) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    const epoch = this.permissionEpoch;
    applyUpdate(this.state, { sessionUpdate: 'tool_call_update', ...req.toolCall });
    const plan = capturePlan(this.state.turns, req.toolCall);
    // A resumed Devin session may send only the plan path. Load that exact file
    // before presenting approval; missing files retain the normal permission UI.
    if (plan && !plan.markdown && plan.path) {
      try {
        const file = await stat(plan.path);
        if (file.isFile() && file.size <= 1_048_576) {
          setPlanContent(plan, await readFile(plan.path, 'utf8'));
          if (plan.markdown) plan.status = 'ready';
        }
      } catch { /* The permission choices remain usable without a local preview. */ }
    }
    if (signal.aborted || epoch !== this.permissionEpoch) return { outcome: { outcome: 'cancelled' } };
    // yolo: approve directly without showing a card, preferring allow_always so the same tool doesn't keep coming back
    if (this.autoApprove) {
      if (plan?.approvalToolCallId === req.toolCall.toolCallId) plan.status = 'approved';
      return { outcome: { outcome: 'selected', optionId: bestAllow(req.options) } };
    }
    const blockId = `perm-${++this.permSeq}`;
    const raw = req.toolCall.rawInput as Record<string, unknown> | undefined;
    const last = this.state.turns[this.state.turns.length - 1];
    // The verb / command on the card is taken from the corresponding tool row; the permission request itself often carries only a title
    const tool = last?.role === 'agent' ? last.blocks.find((b): b is ToolCallBlock => b.type === 'tool_call' && b.id === req.toolCall.toolCallId) : undefined;
    const block: PermissionBlock = {
      type: 'permission', id: blockId,
      planId: plan?.markdown && plan.approvalToolCallId === req.toolCall.toolCallId ? plan.id : undefined,
      title: tool ? t('host.needApprovalFor', { what: `${tool.verb}${tool.kind !== 'execute' && tool.target ? ` ${tool.target}` : ''}` }) : req.toolCall.title ? t('host.needApprovalFor', { what: req.toolCall.title }) : t('host.needApproval'),
      command: typeof raw?.command === 'string' ? raw.command : typeof raw?.cmd === 'string' ? raw.cmd : tool?.kind === 'execute' ? tool.target : undefined,
      description: typeof raw?.description === 'string' ? raw.description : undefined,
      options: req.options.map(o => ({ id: o.optionId, label: o.name, kind: o.kind })),
    };
    if (last?.role === 'agent') { last.blocks.push(block); last.activity = activityOf(this.state.turns); }
    return new Promise(resolve => {
      this.pending.set(blockId, { resolve, blockId, options: req.options, planId: block.planId });
      signal.addEventListener('abort', () => {
        if (!this.pending.delete(blockId)) return;
        this.removePermissionBlocks(blockId);
        resolve({ outcome: { outcome: 'cancelled' } });
        this.touch();
      }, { once: true });
      this.touch();
    });
  }

  private removePermissionBlocks(onlyId?: string) {
    for (const t of this.state.turns) {
      if (t.role !== 'agent') continue;
      t.blocks = t.blocks.filter(b => b.type !== 'permission' || (onlyId !== undefined && b.id !== onlyId));
    }
  }
}

// Credential hand-off by the account layer failed: enters auth_required just like -32000, but the reason must reach the user
class AccountAuthError extends Error {}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// First line of the text, or what was attached when there is no text (title of a session opened with attachments only, the queue note)
function summarizePrompt(p: QueuedPrompt): string {
  return p.text.trim().split('\n')[0]!.trim() || describeDrafts(p.attachments);
}

// Which option auto-approval picks: allow_always first, then allow_once, otherwise the first one
function bestAllow(options: acp.PermissionOption[]): string {
  const o = options.find(o => o.kind === 'allow_always') ?? options.find(o => o.kind === 'allow_once') ?? options[0];
  if (!o) throw new Error(t('host.noPermissionOptions'));
  return o.optionId;
}

function isAuth(e: unknown): boolean {
  if (e instanceof AccountAuthError) return true;
  return e instanceof acp.RequestError ? e.code === -32000 : /auth/i.test(msg(e)) && /required|login|unauthor/i.test(msg(e));
}

// What a failed session/prompt leaves on the turn: the JSON-RPC message and code, plus Devin's typed cause (errorKind / retryable) when present.
// Some agents put the readable reason only in data (Devin: data.message or data.detail), so that is preferred over a generic top-level message
function turnErrorOf(e: unknown): TurnError {
  if (!(e instanceof acp.RequestError)) return { message: msg(e) };
  const data = (e.data && typeof e.data === 'object' ? e.data : {}) as Record<string, unknown>;
  const detail = [data.message, data.detail, data.reason].find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  const kind = data['cognition.ai/errorKind'];
  const retryable = data['cognition.ai/retryable'];
  return {
    message: detail && detail !== e.message ? `${e.message}: ${detail}` : e.message,
    code: e.code,
    ...(typeof kind === 'string' ? { kind } : {}),
    ...(typeof retryable === 'boolean' ? { retryable } : {}),
  };
}

const AUTH_WORDS = /auth|credential|login|logged|unauthor/i;

// Pull a human-readable reason out of one stderr line when it is about authentication. Structured logs (Kimi writes ndjson: {"msg":"acp: auth readiness probe failed…","error":"provider … has no credential configured"})
// yield their error field; plain lines are kept as-is. Anything not about auth yields undefined
function authHintOf(line: string): string | undefined {
  const text = line.trim();
  if (!text) return undefined;
  // The JSON-RPC layer's own "Sending error response" echo only repackages what the response already carries; it isn't a diagnosis
  if (text.includes('jsonrpc::outgoing_actor')) return undefined;
  // Devin's generic missing-credential warning adds no diagnosis; use the localized login guidance.
  // The complete stderr line remains in the output log.
  if (text.includes('ACP: Creating session without credentials - agent may not work')) return undefined;
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const m = typeof j.msg === 'string' ? j.msg : typeof j.message === 'string' ? j.message : '';
      const err = typeof j.error === 'string' ? j.error : typeof j.err === 'string' ? j.err : undefined;
      if (!AUTH_WORDS.test(`${m} ${err ?? ''}`)) return undefined;
      return err ?? (m || undefined);
    } catch { /* not JSON, fall through to plain text */ }
  }
  return AUTH_WORDS.test(text) ? text : undefined;
}

// The peer forgot this session: Devin reports errorKind=session_not_found (empty sessions are swept when the process exits); fall back to matching the message text
function isSessionGone(e: unknown): boolean {
  if (e instanceof acp.RequestError) {
    const kind = (e.data as Record<string, unknown> | undefined)?.['cognition.ai/errorKind'];
    if (kind === 'session_not_found') return true;
  }
  return /session not found/i.test(msg(e));
}
