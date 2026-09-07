import { basename } from 'node:path';
import type * as acp from '@agentclientprotocol/sdk';
import type { MsgKey } from '@shared/i18n';
import { t } from '../i18n';
import type {
  AgentBlock, AgentTurn, CompactionBlock, CompactionStatus, ConfigControl, DiffLine, PlanPriority, PlanStatus, SessionControls, SessionOption, SlashCommand, ToolCallBlock, ToolContent, ToolKind, Turn, TurnError, Usage,
} from '@shared/transcript';

// Normalize ACP session/update into transcript blocks. Pure functions + in-place mutation of the Turn array; AcpSession pushes to the webview

export interface NormalizeState {
  turns: Turn[];
  controls: SessionControls;
  usage?: Usage;
  commands: SlashCommand[];
  title?: string;
  // Start time of a thought block; durationSec is computed when it ends
  thoughtStartedAt?: number;
}

export function emptyState(): NormalizeState {
  return { turns: [], controls: { modes: [], options: [] }, commands: [] };
}

// The current assistant turn; open one if there is none
function currentAgentTurn(s: NormalizeState): AgentTurn {
  const last = s.turns[s.turns.length - 1];
  if (last?.role === 'agent') return last;
  const t: AgentTurn = { role: 'agent', blocks: [] };
  s.turns.push(t);
  return t;
}

function lastBlock(t: AgentTurn): AgentBlock | undefined {
  return t.blocks[t.blocks.length - 1];
}

// Seal off the streaming body / thought when the block changes
function sealStreaming(s: NormalizeState, t: AgentTurn, except?: AgentBlock['type']) {
  for (const b of t.blocks) {
    if (b.type === except) continue;
    if (b.type === 'thought' && b.streaming) {
      b.streaming = false;
      const from = b.startedAt ?? s.thoughtStartedAt;
      if (from) b.durationSec = Math.max(1, Math.round((Date.now() - from) / 1000));
      s.thoughtStartedAt = undefined;
    }
    if (b.type === 'text' && b.streaming) b.streaming = false;
  }
}

function textOf(c: acp.ContentBlock): string {
  if (c.type === 'text') return c.text;
  if (c.type === 'resource_link') return c.uri;
  if (c.type === 'resource') return 'text' in c.resource ? c.resource.text : c.resource.uri;
  return `[${c.type}]`;
}

// One update comes in, mutate state. Returns whether there is a UI-visible change
export function applyUpdate(s: NormalizeState, u: acp.SessionUpdate): boolean {
  switch (u.sessionUpdate) {
    case 'user_message_chunk': {
      // Appears only during load / resume replay; consecutive chunks merge into the same entry
      const last = s.turns[s.turns.length - 1];
      const text = textOf(u.content);
      if (last?.role === 'user' && (last as { _open?: boolean })._open) last.text += text;
      else s.turns.push(Object.assign({ role: 'user' as const, text }, { _open: true }));
      return true;
    }
    case 'agent_message_chunk': {
      closeUserTurn(s);
      const t = currentAgentTurn(s);
      const last = lastBlock(t);
      if (last?.type === 'text' && last.streaming) last.markdown += textOf(u.content);
      else { sealStreaming(s, t); t.blocks.push({ type: 'text', markdown: textOf(u.content), streaming: true }); }
      return true;
    }
    case 'agent_thought_chunk': {
      closeUserTurn(s);
      const t = currentAgentTurn(s);
      const last = lastBlock(t);
      if (last?.type === 'thought' && last.streaming) last.text += textOf(u.content);
      else { sealStreaming(s, t); s.thoughtStartedAt = Date.now(); t.blocks.push({ type: 'thought', text: textOf(u.content), startedAt: s.thoughtStartedAt, streaming: true }); }
      return true;
    }
    case 'tool_call': {
      closeUserTurn(s);
      const t = currentAgentTurn(s);
      sealStreaming(s, t);
      const existing = findTool(s, u.toolCallId);
      if (existing) mergeTool(existing, u);
      else t.blocks.push(toolBlock(u));
      return true;
    }
    case 'tool_call_update': {
      const existing = findTool(s, u.toolCallId);
      if (existing) mergeTool(existing, u);
      else { const t = currentAgentTurn(s); sealStreaming(s, t); t.blocks.push(toolBlock({ toolCallId: u.toolCallId, title: u.title ?? '', kind: u.kind ?? undefined, status: u.status ?? undefined, content: u.content ?? undefined, locations: u.locations ?? undefined, rawInput: u.rawInput })); }
      return true;
    }
    case 'plan': {
      closeUserTurn(s);
      const t = currentAgentTurn(s);
      const entries = u.entries.map(e => ({ title: e.content, status: e.status as PlanStatus, priority: e.priority as PlanPriority }));
      const plan = t.blocks.find(b => b.type === 'plan');
      if (plan) plan.entries = entries;
      else { sealStreaming(s, t); t.blocks.push({ type: 'plan', entries }); }
      return true;
    }
    case 'plan_update':
    case 'plan_removed':
      return false;
    case 'usage_update':
      s.usage = { used: u.used, size: u.size, cost: u.cost?.amount ?? undefined };
      return true;
    case 'available_commands_update':
      s.commands = u.availableCommands.map(c => ({ name: c.name, description: c.description }));
      return true;
    case 'current_mode_update':
      s.controls.modeId = u.currentModeId;
      return true;
    case 'config_option_update':
      applyConfigOptions(s.controls, u.configOptions);
      return true;
    case 'session_info_update':
      if (u.title) s.title = u.title;
      return true;
    case 'compaction_update': {
      closeUserTurn(s);
      const t = currentAgentTurn(s);
      const status = compactionStatus(u.status);
      const existing = findCompaction(s, u.compactionId);
      if (existing) existing.status = status;
      else { sealStreaming(s, t); t.blocks.push({ type: 'compaction', id: u.compactionId, status }); }
      return true;
    }
    case 'compaction_summary_chunk':
      return false;
    default:
      return false;
  }
}

function compactionStatus(v: string): CompactionStatus {
  return v === 'completed' || v === 'failed' || v === 'cancelled' ? v : 'in_progress';
}

function findCompaction(s: NormalizeState, id: string): CompactionBlock | undefined {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const t = s.turns[i];
    if (t?.role !== 'agent') continue;
    const b = t.blocks.find(b => b.type === 'compaction' && b.id === id);
    if (b) return b as CompactionBlock;
  }
  return undefined;
}

function closeUserTurn(s: NormalizeState) {
  const last = s.turns[s.turns.length - 1] as (Turn & { _open?: boolean }) | undefined;
  if (last?.role === 'user') delete last._open;
}

// Turn ended: seal all streaming blocks, record how it ended; tools still running are marked per stopReason
export function endTurn(s: NormalizeState, stopReason: acp.StopReason) {
  const t = s.turns[s.turns.length - 1];
  if (t?.role !== 'agent') return;
  sealStreaming(s, t);
  // Replay-only turns have no live start time; never invent a duration for them.
  if (t.startedAt !== undefined) t.endedAt ??= Date.now();
  t.activity = undefined;
  t.stop = stopReason;
  for (const b of t.blocks) {
    if (b.type === 'tool_call' && (b.status === 'in_progress' || b.status === 'pending')) b.status = stopReason === 'cancelled' ? 'cancelled' : 'failed';
  }
}

// session/prompt itself failed: wrap up like a cancellation (nothing more is coming) and keep the error on the turn so the UI can show it
export function failTurn(s: NormalizeState, error: TurnError) {
  endTurn(s, 'cancelled');
  const t = s.turns[s.turns.length - 1];
  if (t?.role !== 'agent') return;
  t.stop = 'error';
  t.error = error;
}

// Build the controls from the session/new / resume response
export function initControls(controls: SessionControls, modes?: acp.SessionModeState | null, configOptions?: acp.SessionConfigOption[] | null) {
  controls.modes = (modes?.availableModes ?? []).map(m => ({ id: m.id, name: m.name, description: m.description ?? undefined }));
  controls.modeId = modes?.currentModeId;
  if (configOptions) applyConfigOptions(controls, configOptions);
}

// configOptions: a select with category=mode is treated purely as modes — it fills in when modes is empty, and is a duplicate when modes is already present (Kimi sends both);
// in neither case does it enter the control list. The remaining selects are ordered model → thought_level → model_config → others, preserving the agent's order within each class. boolean type is not shown for now
const CATEGORY_ORDER = ['model', 'thought_level', 'model_config'];

export function applyConfigOptions(controls: SessionControls, options: acp.SessionConfigOption[]) {
  const mode = options.find(o => o.type === 'select' && o.category === 'mode');
  if (mode && mode.type === 'select' && (controls.modes.length === 0 || controls.modeConfigId === mode.id)) {
    controls.modes = flattenSelect(mode.options);
    controls.modeId = mode.currentValue;
    controls.modeConfigId = mode.id;
  }
  const rank = (c: ConfigControl) => { const i = CATEGORY_ORDER.indexOf(c.category ?? ''); return i < 0 ? CATEGORY_ORDER.length : i; };
  controls.options = options
    .filter(o => o.type === 'select' && o.category !== 'mode')
    .map((o): ConfigControl => ({
      id: o.id, name: o.name, category: o.category ?? undefined,
      options: o.type === 'select' ? flattenSelect(o.options) : [],
      value: o.type === 'select' ? o.currentValue : undefined,
    }))
    .sort((a, b) => rank(a) - rank(b));
}

function flattenSelect(opts: acp.SessionConfigSelectOptions): SessionOption[] {
  const out: SessionOption[] = [];
  for (const o of opts) {
    if ('group' in o) for (const x of o.options) out.push({ id: x.value, name: x.name, description: x.description ?? o.name, group: { id: o.group, name: o.name } });
    else out.push({ id: o.value, name: o.name, description: o.description ?? undefined });
  }
  return out;
}

function findTool(s: NormalizeState, id: string): ToolCallBlock | undefined {
  for (let i = s.turns.length - 1; i >= 0; i--) {
    const t = s.turns[i];
    if (t?.role !== 'agent') continue;
    const b = t.blocks.find(b => b.type === 'tool_call' && b.id === id);
    if (b) return b as ToolCallBlock;
  }
  return undefined;
}

const VERB_KEY: Record<ToolKind, MsgKey> = {
  read: 'verb.read', edit: 'verb.edit', delete: 'verb.delete', move: 'verb.move', search: 'verb.search',
  execute: 'verb.execute', think: 'verb.think', fetch: 'verb.fetch', switch_mode: 'verb.switch_mode', other: 'verb.other',
};
const verbOf = (kind: ToolKind): string => t(VERB_KEY[kind]);

function toolBlock(tc: acp.ToolCall): ToolCallBlock {
  const b: ToolCallBlock = { type: 'tool_call', id: tc.toolCallId, kind: tc.kind ?? 'other', verb: verbOf(tc.kind ?? 'other'), status: tc.status ?? 'pending' };
  mergeTool(b, tc);
  return b;
}

// Fields of tool_call and tool_call_update are all optional; overwrite only the ones provided
function mergeTool(b: ToolCallBlock, u: acp.ToolCall | acp.ToolCallUpdate) {
  if (u.kind) { b.kind = u.kind; b.verb = verbOf(u.kind); }
  if (u.status) b.status = u.status;
  // A target inferred from the title is only a fallback while there is no target yet; don't overwrite what rawInput / locations provided
  const target = pickTarget(u, b.kind);
  if (target && (!target.fromTitle || !b.target)) { b.target = target.text; b.targetMono = target.mono; }
  if (u.content?.length) {
    const c = toolContent(u.content);
    if (c) b.content = c;
    if (c?.type === 'diff') b.diffStat = { add: c.lines.filter(l => l.kind === 'add').length, del: c.lines.filter(l => l.kind === 'del').length };
  }
  if (!b.content && u.rawOutput !== undefined && u.rawOutput !== null) {
    const text = typeof u.rawOutput === 'string' ? u.rawOutput : JSON.stringify(u.rawOutput, null, 2);
    if (text.trim()) b.content = { type: 'text', text: text.slice(0, 20_000) };
  }
}

// What the row shows: execute shows the command; with locations, the file name; otherwise the title
function pickTarget(u: acp.ToolCall | acp.ToolCallUpdate, kind: ToolKind): { text: string; mono: boolean; fromTitle?: boolean } | undefined {
  const raw = u.rawInput as Record<string, unknown> | undefined;
  if (kind === 'execute') {
    const cmd = typeof raw?.command === 'string' ? raw.command : typeof raw?.cmd === 'string' ? raw.cmd : undefined;
    if (cmd) return { text: cmd, mono: true };
  }
  if (kind === 'search') {
    const q = typeof raw?.pattern === 'string' ? raw.pattern : typeof raw?.query === 'string' ? raw.query : undefined;
    if (q) return { text: q, mono: true };
  }
  const loc = u.locations?.[0]?.path;
  if (loc) return { text: basename(loc), mono: false };
  if (u.title) return { text: stripVerb(u.title), mono: false, fromTitle: true };
  return undefined;
}

// An agent's title is often like "Read file foo.ts"; we supply the verb ourselves, so strip the English verb to avoid duplication
function stripVerb(title: string): string {
  return title.replace(/^(read(ing)?|edit(ing)?|write|writing|search(ing)?|run(ning)?|execute|executing|fetch(ing)?|delete|deleting|move|moving|list(ing)?)\s+(file|files|directory|command)?\s*/i, '').replace(/^`|`$/g, '').trim() || title;
}

function toolContent(items: acp.ToolCallContent[]): ToolContent | undefined {
  const diff = items.find(c => c.type === 'diff');
  if (diff && diff.type === 'diff') return { type: 'diff', lines: diffLines(diff.oldText ?? '', diff.newText) };
  const texts = items.filter(c => c.type === 'content').map(c => c.type === 'content' ? textOf(c.content) : '').filter(Boolean);
  if (texts.length) return { type: 'text', text: texts.join('\n').slice(0, 20_000) };
  const term = items.find(c => c.type === 'terminal');
  if (term && term.type === 'terminal') return { type: 'text', text: t('host.terminalNotWired', { id: term.terminalId }) };
  return undefined;
}

// Line-level diff: LCS finds the common lines; the rest are marked add / del; beyond 800 combined lines only stats are given, no LCS
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText ? oldText.split('\n') : [];
  const b = newText.split('\n');
  if (a.length + b.length > 800) {
    return [
      { kind: 'hunk', text: t('host.hunk', { a: a.length, b: b.length }) },
      ...a.slice(0, 40).map(t => ({ kind: 'del' as const, text: `-${t}` })),
      ...b.slice(0, 40).map(t => ({ kind: 'add' as const, text: `+${t}` })),
    ];
  }
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: 'ctx', text: ` ${a[i]}` }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ kind: 'del', text: `-${a[i]}` }); i++; }
    else { out.push({ kind: 'add', text: `+${b[j]}` }); j++; }
  }
  while (i < m) out.push({ kind: 'del', text: `-${a[i++]}` });
  while (j < n) out.push({ kind: 'add', text: `+${b[j++]}` });
  return collapseContext(out);
}

// Keep only 3 lines of context around changes; the middle is collapsed into a hunk line
function collapseContext(lines: DiffLine[], keep = 3): DiffLine[] {
  const out: DiffLine[] = [];
  let run: DiffLine[] = [];
  const flush = (atEnd: boolean) => {
    if (run.length <= keep * 2 || (out.length === 0 && run.length <= keep) || (atEnd && run.length <= keep)) out.push(...run);
    else {
      const head = out.length === 0 ? [] : run.slice(0, keep);
      const tail = atEnd ? [] : run.slice(-keep);
      out.push(...head, { kind: 'hunk', text: t('host.unchanged', { n: run.length - head.length - tail.length }) }, ...tail);
    }
    run = [];
  };
  for (const l of lines) {
    if (l.kind === 'ctx') run.push(l);
    else { flush(false); out.push(l); }
  }
  flush(true);
  return out;
}

// What's happening right now: feeds the Activity line of Turns
export function activityOf(turns: Turn[]): AgentTurn['activity'] {
  const turn = turns[turns.length - 1];
  if (turn?.role !== 'agent') return { kind: 'think', label: t('host.thinking') };
  for (let i = turn.blocks.length - 1; i >= 0; i--) {
    const b = turn.blocks[i]!;
    if (b.type === 'tool_call' && (b.status === 'in_progress' || b.status === 'pending')) return { kind: b.kind, label: t('host.doing', { verb: b.verb, target: b.target ?? '' }).trim() };
    if (b.type === 'permission') return { kind: 'other', label: t('host.awaitingApproval') };
  }
  const last = turn.blocks[turn.blocks.length - 1];
  if (last?.type === 'thought' && last.streaming) return { kind: 'think', label: t('host.thinking') };
  if (last?.type === 'text' && last.streaming) return { kind: 'other', label: t('host.replying') };
  return { kind: 'think', label: t('host.thinking') };
}
