import { randomUUID } from 'node:crypto';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentId, AuthMethodInfo, Draft, PermissionBlock, SessionControls, SessionView, SlashCommand, ToolCallBlock, Turn, TurnError, Usage } from '@shared/transcript';
import type { AgentRegistry } from './AgentRegistry';
import { AgentProcess } from './AgentProcess';
import { activityOf, applyUpdate, endTurn, failTurn, initControls, applyConfigOptions, type NormalizeState } from './normalize';

import { describeDrafts, preparePrompt, type BlobStore, type PreparedPrompt } from './attachments';

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
  // yolo among the synthetic modes: the host auto-approves permission requests (the protocol has no such tier, so the CLI stays in default)
  private autoApprove = false;
  // Usage at the end of the last auto-compaction: don't compact again until it has grown back a fair bit, so a "won't shrink" case doesn't fire every turn
  private compactedAt?: number;
  // The last auth-related line the CLI wrote to stderr since the session was (re)opened. -32000 carries no reason, but the CLI usually logs one right before
  // (Kimi: "provider managed:kimi-code has no credential configured"), and that is what the Notice should show instead of a generic "log in"
  private authHint?: string;

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
    return new AcpSession({ id: randomUUID(), agent, accountId, cwd, title: '新会话', createdAt: now, updatedAt: now, turns: [], controls: { modes: [], options: [] }, commands: [] }, deps);
  }

  get title(): string { return this.state.title || '新会话'; }
  get isRunning(): boolean { return this.running; }
  get alive(): boolean { return !!this.proc?.alive; }
  get canCompact(): boolean { return this.state.commands.some(c => c.name === 'compact'); }

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
        } catch (e) { this.log(`恢复 plan 模式失败：${msg(e)}`); }
      }
    } catch (e) {
      this.fail(e);
    }
    this.touch();
  }

  private async connect() {
    const def = this.deps.registry.get(this.agent);
    const bin = await this.deps.registry.resolveBinary(this.agent);
    if (!bin) throw new Error(`找不到 ${def.command}，请先安装 ${def.name} CLI`);
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
          this.error = this.error ?? `${def.name} 进程退出（${code ?? signal ?? '?'}）`;
          this.settle('cancelled');
          this.touch();
        }
      },
    }, env);
    const info = this.proc.init.agentInfo;
    this.log(`initialize ok: protocol ${this.proc.init.protocolVersion}${info ? ` · ${info.name} ${info.version}` : ''}`);
    this.authMethods = this.proc.init.authMethods?.map(m => ({ id: m.id, name: m.name, description: m.description ?? undefined }));
    // With an account bound, hand the credential over before opening the session; if it can't be handed over (secret gone / rejected), treat as login required
    if (hooks && this.accountId) {
      try { await hooks.authenticate(this.agent, this.accountId, this.proc); this.log('authenticate ok (account)'); }
      catch (e) { throw new AccountAuthError(msg(e)); }
    }
  }

  // Synthetic modes declared in the registry (the kind the protocol doesn't advertise); undefined when there are none
  private syntheticModes() {
    return this.deps.registry.get(this.agent).modes;
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
        } catch (e) { this.log(`session/resume 失败：${msg(e)}`); if (isAuth(e)) throw e; gone = isSessionGone(e); }
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
        } catch (e) { this.replaying = false; this.log(`session/load 失败：${msg(e)}`); if (isAuth(e)) throw e; gone = isSessionGone(e); }
      }
      if (!gone) {
        this.status = 'readonly';
        this.error = '这个 agent 恢复不了老会话，只能看历史';
        return;
      }
      this.log('对面没这条会话了，开新的顶上');
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
      this.log(`需要登录${this.error ? `：${this.error}` : ''}`);
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
    if (!id) throw new Error('agent 没有给出登录方式');
    await this.proc.agent.request(acp.methods.agent.authenticate, { methodId: id });
  }

  // Retry establishing the session (after login / after an error)
  async retry(): Promise<void> {
    if (this.proc?.alive && this.status === 'auth_required') {
      this.status = 'starting';
      this.error = undefined;
      this.authHint = undefined;
      this.deps.onChange(this);
      try { await this.openSession(); } catch (e) { this.fail(e); }
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
  async prompt(text: string, attachments: Draft[] = [], auto = false): Promise<void> {
    if (this.status !== 'ready') return;
    if (!text.trim() && attachments.length === 0) return;
    if (this.running) { this.queued = { text, attachments }; this.touch(); return; }
    this.running = true;
    this.staging = true;
    this.stagingAborted = false;
    this.touch();
    let prepared: PreparedPrompt | undefined, stagingError: string | undefined;
    try { prepared = await preparePrompt(this.id, text, attachments, this.deps.blobs); }
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
      this.log(`附件处理失败：${stagingError}`);
      if (text.trim()) {
        this.deps.notify?.(`附件处理失败（${stagingError ?? '未知原因'}），只发送了文字`);
        prepared = { blocks: [{ type: 'text', text }], attachments: [], problems: [] };
      } else {
        this.deps.notify?.(`附件处理失败（${stagingError ?? '未知原因'}），这条没发出去`);
        this.running = false;
        this.touch();
        this.flushQueued();
        return;
      }
    }
    for (const p of prepared.problems) { this.log(p); this.deps.notify?.(p); }
    if (attachments.length) this.log(`attachments: ${prepared.blocks.slice(text ? 1 : 0).map(b => b.type).join(' ')}`);
    this.state.turns.push(auto ? { role: 'user', text, auto: true } : { role: 'user', text, ...(prepared.attachments.length ? { attachments: prepared.attachments } : {}) });
    if (!auto && (!this.state.title || this.state.title === '新会话')) this.state.title = summarizePrompt({ text, attachments }).slice(0, 40);
    this.state.turns.push({ role: 'agent', blocks: [], activity: activityOf(this.state.turns) });
    this.touch();
    let stop: acp.StopReason = 'cancelled';
    try {
      const r = await this.proc!.agent.request(acp.methods.agent.session.prompt, { sessionId: this.acpSessionId!, prompt: prepared.blocks });
      this.log(`prompt done: ${r.stopReason}`);
      stop = r.stopReason;
      this.settle(stop);
    } catch (e) {
      // The error stays on the turn (the webview shows it as a card, history keeps the row); the session itself is still usable, so status stays ready —
      // except when the peer says the credential is gone, which is the Notice's business
      this.log(`prompt 失败：${msg(e)}`);
      this.settle('cancelled', turnErrorOf(e));
      if (isAuth(e)) this.status = 'auth_required';
    }
    // A hand-typed /compact counts as a compaction too; likewise record the usage right after it
    if (auto || text.trim() === '/compact') this.compactedAt = this.state.usage?.used ?? 0;
    this.touch();
    if (this.flushQueued()) return;
    if (!auto && stop === 'end_turn' && this.shouldAutoCompact()) {
      this.log(`usage ${this.state.usage?.used} ≥ 阈值，自动 /compact`);
      void this.compact(true);
    }
  }

  // Send the prompt queued during the last turn, if any; nobody awaits it, so its failures end up in the log
  private flushQueued(): boolean {
    const next = this.queued;
    if (!next) return false;
    this.queued = undefined;
    this.prompt(next.text, next.attachments).catch(e => this.log(`queued prompt 失败：${msg(e)}`));
    return true;
  }

  // Compact the context: simply send /compact to the agent (ACP has no dedicated compaction request; it relies on the agent's own slash command)
  async compact(auto = false): Promise<void> {
    if (!this.canCompact) { if (!auto) throw new Error('这个 agent 没有 /compact'); return; }
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
    if (error) failTurn(this.state, error); else endTurn(this.state, stop);
    for (const p of this.pending.values()) p.resolve({ outcome: { outcome: 'cancelled' } });
    this.pending.clear();
    this.removePermissionBlocks();
    this.running = false;
  }

  // Send the last user turn again after its agent turn stopped short (error / refusal / limits): both turns leave the transcript
  async retryTurn(): Promise<void> {
    if (this.running || this.status !== 'ready') return;
    const turns = this.state.turns;
    const agent = turns[turns.length - 1], user = turns[turns.length - 2];
    if (agent?.role !== 'agent' || user?.role !== 'user' || user.auto) return;
    if (!agent.stop || agent.stop === 'end_turn' || agent.stop === 'cancelled') return;
    turns.splice(-2, 2);
    await this.prompt(user.text);
  }

  async cancel(): Promise<void> {
    if (!this.running || !this.proc) return;
    this.log('cancel');
    // Nothing is on the wire yet: just make sure the prompt being staged never goes out
    if (this.staging) { this.stagingAborted = true; return; }
    for (const p of this.pending.values()) p.resolve({ outcome: { outcome: 'cancelled' } });
    this.pending.clear();
    this.removePermissionBlocks();
    await this.proc.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.acpSessionId! });
  }

  async setMode(id: string): Promise<void> {
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
    for (const p of this.pending.values()) p.resolve({ outcome: { outcome: 'selected', optionId: bestAllow(p.options) } });
    this.pending.clear();
    this.removePermissionBlocks();
  }

  // Switching any select-type configOption (model / reasoning level / …); the response is the full configOptions set
  async setConfig(configId: string, value: string): Promise<void> {
    const c = this.state.controls;
    if (!this.proc || this.status !== 'ready' || !c.options.some(o => o.id === configId)) return;
    const r = await this.proc.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: this.acpSessionId!, configId, value });
    applyConfigOptions(c, r.configOptions);
    this.touch();
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
    this.pending.delete(blockId);
    this.removePermissionBlocks(blockId);
    p.resolve({ outcome: { outcome: 'selected', optionId } });
    this.touch();
  }

  dispose() {
    this.status = 'closed';
    for (const p of this.pending.values()) p.resolve({ outcome: { outcome: 'cancelled' } });
    this.pending.clear();
    this.proc?.kill();
    this.proc = undefined;
  }

  private onUpdate(n: acp.SessionNotification) {
    if (n.sessionId !== this.acpSessionId && this.acpSessionId) return;
    const u = n.update;
    // yolo is host-side state: a current_mode_update pushed by the CLI (e.g. the shot that pulled it back from plan to default) must not drag the UI back
    if (this.autoApprove && u.sessionUpdate === 'current_mode_update') u.currentModeId = 'yolo';
    if (this.replaying && ['user_message_chunk', 'agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan'].includes(u.sessionUpdate)) return;
    // A user_message_chunk echoed by the agent mid-turn is the one we just sent; it's already in turns
    if (this.running && u.sessionUpdate === 'user_message_chunk') return;
    if (!applyUpdate(this.state, u)) return;
    const last = this.state.turns[this.state.turns.length - 1];
    if (this.running && last?.role === 'agent') last.activity = activityOf(this.state.turns);
    this.touch();
  }

  // Permission request → insert a card into the current assistant turn and wait for the webview's answer; if the agent cancels, withdraw the card
  private onPermission(req: acp.RequestPermissionRequest, signal: AbortSignal): Promise<acp.RequestPermissionResponse> {
    applyUpdate(this.state, { sessionUpdate: 'tool_call_update', ...req.toolCall });
    // yolo: approve directly without showing a card, preferring allow_always so the same tool doesn't keep coming back
    if (this.autoApprove) return Promise.resolve({ outcome: { outcome: 'selected', optionId: bestAllow(req.options) } });
    const blockId = `perm-${++this.permSeq}`;
    const raw = req.toolCall.rawInput as Record<string, unknown> | undefined;
    const last = this.state.turns[this.state.turns.length - 1];
    // The verb / command on the card is taken from the corresponding tool row; the permission request itself often carries only a title
    const tool = last?.role === 'agent' ? last.blocks.find((b): b is ToolCallBlock => b.type === 'tool_call' && b.id === req.toolCall.toolCallId) : undefined;
    const block: PermissionBlock = {
      type: 'permission', id: blockId,
      title: tool ? `需要批准 · ${tool.verb}${tool.kind !== 'execute' && tool.target ? ` ${tool.target}` : ''}` : req.toolCall.title ? `需要批准 · ${req.toolCall.title}` : '需要批准',
      command: typeof raw?.command === 'string' ? raw.command : typeof raw?.cmd === 'string' ? raw.cmd : tool?.kind === 'execute' ? tool.target : undefined,
      description: typeof raw?.description === 'string' ? raw.description : undefined,
      options: req.options.map(o => ({ id: o.optionId, label: o.name, kind: o.kind })),
    };
    if (last?.role === 'agent') { last.blocks.push(block); last.activity = activityOf(this.state.turns); }
    this.touch();
    return new Promise(resolve => {
      this.pending.set(blockId, { resolve, blockId, options: req.options });
      signal.addEventListener('abort', () => {
        if (!this.pending.delete(blockId)) return;
        this.removePermissionBlocks(blockId);
        resolve({ outcome: { outcome: 'cancelled' } });
        this.touch();
      }, { once: true });
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
  if (!o) throw new Error('权限请求没有选项');
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
