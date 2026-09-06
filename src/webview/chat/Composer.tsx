import { useCallback, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { ChevronLeft, Plus, Shrink } from 'lucide-react';
import type { AccountInfo, AgentInfo, ConfigControl, Draft, PinMap, SessionControls, Turn, Usage } from '@shared/transcript';
import type { AddAccountVia, FileHit } from '@shared/protocol';
import { findVariant, groupModels, variantLabel, type ModelFamily } from '@shared/models';
import { useAppearance } from '../appearance';
import { cn } from '../ui/cn';
import { Button, Chip, IconButton } from '../ui/Button';
import { Menu, MenuFooter, MenuList, Popover, type MenuItem } from '../ui/Popover';
import { WorkingBeam } from '../effects/WorkingBeam';
import { SendButton } from '../effects/SendButton';
import { AgentMark } from './AgentMark';
import { DraftChips } from './Attachments';
import { collectDrafts, hasPayload } from './drafts';
import { MentionList, mentionAt, useMentionHits } from './Mention';
import { estimateUsage, type UsageSegment } from './usageBreakdown';

export interface ComposerProps {
  running: boolean;
  // Entire composer disabled while the session isn't ready (connecting / login required / read-only)
  disabled?: boolean;
  theme: 'dark' | 'light';
  agent: AgentInfo;
  agents: AgentInfo[];
  accounts?: AccountInfo[];
  accountId?: string;
  controls: SessionControls;
  turns: Turn[];
  // Options pinned for the current agent: configOption id → value
  pins?: PinMap[string];
  usage?: Usage;
  canCompact?: boolean;
  // Workspace root: dropped and mentioned files are labeled relative to it
  cwd: string;
  onSend: (text: string, attachments: Draft[]) => void;
  onSearchFiles: (query: string) => Promise<FileHit[]>;
  // Something couldn't be attached; the shell shows it as a toast
  onNotice: (text: string) => void;
  onStop: () => void;
  onSetMode: (id: string) => void;
  onSetConfig: (configId: string, value: string) => void;
  onPinOption: (configId: string, value: string, pinned: boolean) => void;
  onSelectAgent: (id: AgentInfo['id']) => void;
  onSelectAccount: (id: string) => void;
  onAddAccount: (agent: AgentInfo['id'], via: AddAccountVia) => void;
  onRemoveAccount: (id: string) => void;
  onCompact: () => void;
}

// Only offer pinning / search once the option count passes these thresholds; short lists are scannable at a glance
const PIN_FROM = 8;
const SEARCH_FROM = 12;

// Composer has three layers: attachment chips (when any), the input area, and a toolbar row below.
// The row's left side ("mode · model · reasoning level …") lists whatever the agent's ACP session provides; the right side holds "context ring · agent · send".
// Attachments come from pasting / dropping (images, OS files, Explorer items) or from an @ mention that searches the workspace
export function Composer(p: ComposerProps) {
  const { composer } = useAppearance();
  const [text, setText] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const flush = composer === 'flush';
  // The beam lights up while the composer is focused (focus-within semantics), not while it's working.
  // Overlays portal to the shell root, so opening a menu blurs the composer; "a menu is open" therefore also counts as focused
  const [focused, setFocused] = useState(false);
  const [openMenus, setOpenMenus] = useState(0);
  const onOpenChange = useCallback((open: boolean) => setOpenMenus(n => n + (open ? 1 : -1)), []);
  const beamActive = focused || openMenus > 0;
  const mode = p.controls.modes.find(m => m.id === p.controls.modeId);
  const dim = p.running || p.disabled;
  const account = p.accounts?.find(a => a.id === p.accountId);
  // Files are read asynchronously after a paste / drop; sending is held until every read has landed, so a message never leaves without its attachments
  const [reading, setReading] = useState(0);
  const canSend = !p.disabled && reading === 0 && (text.trim().length > 0 || drafts.length > 0);
  const send = () => {
    if (!canSend) return;
    p.onSend(text, drafts);
    setText('');
    setDrafts([]);
    setDismissed(undefined);
  };

  // Drop zone: the whole field lights up while something attachable hovers over it. Enter / leave are counted rather than trusting relatedTarget,
  // which is null for drags coming from outside the window
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const addFrom = async (dt: DataTransfer) => {
    setReading(n => n + 1);
    try {
      const { drafts: more, refused } = await collectDrafts(dt, p.cwd);
      if (more.length) setDrafts(d => [...d, ...more.filter(m => m.kind !== 'file' || !d.some(x => x.kind === 'file' && x.uri === m.uri))]);
      if (refused.length) p.onNotice(refused.join('；'));
    } catch (e) {
      p.onNotice(`读取附件失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(n => n - 1);
    }
  };
  const takes = (dt: DataTransfer | null) => !p.disabled && hasPayload(dt);
  const onDragEnter = (e: DragEvent) => { if (!takes(e.dataTransfer)) return; e.preventDefault(); dragDepth.current++; setDragging(true); };
  const onDragOver = (e: DragEvent) => { if (takes(e.dataTransfer)) e.preventDefault(); };
  const onDragLeave = (e: DragEvent) => { if (!takes(e.dataTransfer)) return; if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } };
  // Plain text drags are left to the textarea's native handling; only attachable payloads are taken over
  const onDrop = (e: DragEvent) => {
    dragDepth.current = 0;
    setDragging(false);
    if (!takes(e.dataTransfer)) return;
    e.preventDefault();
    void addFrom(e.dataTransfer);
  };
  // Likewise plain text pastes fall through; only pastes carrying files are taken over
  const onPaste = (e: ClipboardEvent) => {
    if (!hasPayload(e.clipboardData) || !e.clipboardData.files.length) return;
    e.preventDefault();
    void addFrom(e.clipboardData);
  };

  // @ mention: the span under the caret drives the file list (only with a collapsed selection); Esc parks it for that @ until the caret leaves or the message is sent
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [collapsed, setCollapsed] = useState(true);
  const [dismissed, setDismissed] = useState<number>();
  const span = collapsed ? mentionAt(text, caret) : undefined;
  const mentionOpen = !!span && span.start !== dismissed && !p.disabled;
  const { hits, ready, active, setActive, move } = useMentionHits(mentionOpen ? span.query : undefined, p.onSearchFiles);
  const pick = (hit: FileHit) => {
    if (!span) return;
    const next = text.slice(0, span.start) + text.slice(caret);
    setText(next);
    setCaret(span.start);
    setDrafts(d => (d.some(x => x.kind === 'file' && x.uri === hit.uri) ? d : [...d, { kind: 'file', uri: hit.uri, name: hit.path }]));
    requestAnimationFrame(() => textarea.current?.setSelectionRange(span.start, span.start));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (mentionOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); return; }
      if (e.key === 'Escape') { e.preventDefault(); setDismissed(span!.start); return; }
      // Enter / Tab pick the active hit; while the hits for this query are still on their way, Enter waits instead of sending a half-typed @ (Shift+Enter still breaks the line)
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        if (!ready) { e.preventDefault(); return; }
        if (hits[active]) { e.preventDefault(); pick(hits[active]!); return; }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };
  const syncCaret = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart);
    setCollapsed(el.selectionStart === el.selectionEnd);
    if (dismissed !== undefined && !mentionAt(el.value, el.selectionStart)) setDismissed(undefined);
  };

  const field = (
    <div
      ref={fieldRef}
      data-busy={dim || undefined}
      data-drag={dragging || undefined}
      className={cn('composer-field flex flex-col', flush ? 'rounded-none' : 'rounded-lg')}
      onFocus={() => setFocused(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <DraftChips drafts={drafts} onRemove={i => setDrafts(d => d.filter((_, j) => j !== i))} />
      <textarea
        ref={textarea}
        rows={1}
        value={text}
        disabled={p.disabled}
        onChange={e => { setText(e.target.value); syncCaret(e.target); }}
        onKeyUp={e => syncCaret(e.currentTarget)}
        onClick={e => syncCaret(e.currentTarget)}
        onSelect={e => syncCaret(e.currentTarget)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={p.disabled ? '会话未就绪' : p.running ? '排队一条，等这轮结束再发' : '有什么要改的？@ 引用文件'}
        className={cn(
          'min-w-0 resize-none bg-transparent px-3 pt-2.5 pb-1 text-1 outline-none transition-colors',
          'max-h-[calc(8*var(--text-1-lh))] placeholder:text-fg-3',
          dim ? 'text-fg-3/60 placeholder:text-fg-3/60' : 'text-fg-strong',
        )}
      />
      {mentionOpen && <MentionList anchor={fieldRef} hits={hits} active={active} empty={span!.query.length > 0} onHover={setActive} onPick={pick} />}
      <div className="flex items-center gap-1 px-2 pt-1 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {p.controls.modes.length > 0 && (
            <Menu
              side="top"
              items={p.controls.modes.map(m => ({ id: m.id, label: m.name, description: m.description, checked: m.id === p.controls.modeId }))}
              onSelect={p.onSetMode}
              onOpenChange={onOpenChange}
            >
              {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} onClick={toggle} title="模式">{mode?.name ?? '模式'}</Chip>}
            </Menu>
          )}
          {p.controls.options.map(c => (
            <OptionControl key={c.id} control={c} pinned={p.pins?.[c.id] ?? []} onSelect={v => p.onSetConfig(c.id, v)} onPin={(v, on) => p.onPinOption(c.id, v, on)} onOpenChange={onOpenChange} />
          ))}
        </div>
        {p.usage && <ContextRing usage={p.usage} turns={p.turns} canCompact={!!p.canCompact && !dim} onCompact={p.onCompact} onOpenChange={onOpenChange} />}
        <Popover
          side="top" align="end" role="menu" onOpenChange={onOpenChange}
          content={close => (
            <AgentPanel
              agent={p.agent} agents={p.agents} accounts={p.accounts?.filter(a => a.agent === p.agent.id) ?? []} accountId={p.accountId} close={close}
              onSelectAgent={p.onSelectAgent} onSelectAccount={p.onSelectAccount} onAddAccount={p.onAddAccount} onRemoveAccount={p.onRemoveAccount}
            />
          )}
        >
          {({ open, toggle, ref }) => (
            <Chip
              ref={ref} data-open={open || undefined} onClick={toggle} className="shrink-0"
              title={account ? `${p.agent.name} · ${account.label}` : p.agent.name}
              icon={<AgentMark id={p.agent.id} name={p.agent.name} />}
            >
              {p.agent.name}
            </Chip>
          )}
        </Popover>
        <SendButton running={p.running} filled={canSend} theme={p.theme} onClick={p.running ? p.onStop : send} />
      </div>
    </div>
  );

  return (
    <div className={cn(flush ? 'pt-0' : 'px-page pb-page pt-2')}>
      <WorkingBeam active={beamActive} theme={p.theme}>{field}</WorkingBeam>
    </div>
  );
}

interface OptionMenuProps {
  control: ConfigControl;
  pinned: string[];
  onSelect: (value: string) => void;
  onPin: (value: string, pinned: boolean) => void;
  onOpenChange: (open: boolean) => void;
}

// A single configOption: names that decompose into a "family × params" structure (Devin's 210 models) become two Chips, otherwise one flat menu
function OptionControl(props: OptionMenuProps) {
  const families = useMemo(() => groupModels(props.control.options), [props.control.options]);
  return families.length < props.control.options.length ? <ModelChips {...props} families={families} /> : <OptionMenu {...props} />;
}

// The model Chip lists families (searchable / pinnable, pinning targets families); the params Chip lists that family's reasoning levels (radio) plus Fast / 1M (toggles) —
// modeled on Devin's own model panel, with the right-hand detail pane flattened into the second Chip's menu. Switching families tries to keep the current params; if there's no matching tier it falls back to the family's first tier
function ModelChips({ control: c, families, pinned, onSelect, onPin, onOpenChange }: OptionMenuProps & { families: ModelFamily[] }) {
  const cur = families.find(f => f.variants.some(v => v.id === c.value));
  const curVar = cur?.variants.find(v => v.id === c.value);
  const pinnable = families.length >= PIN_FROM;
  const isPinned = (f: ModelFamily) => f.variants.some(v => pinned.includes(v.id));
  const grouped = pinnable && families.some(isPinned);
  const toItem = (f: ModelFamily): MenuItem => ({
    id: f.name, label: f.name, checked: f === cur,
    meta: f === cur && curVar && f.variants.length > 1 ? variantLabel(curVar, f) : undefined,
    section: grouped ? (isPinned(f) ? '常用' : '全部') : undefined,
    pinned: isPinned(f),
    // Pinning a family pins the tier it's currently using (or its first tier if it isn't the current family); unpinning removes every pinned tier of it
    onPin: pinnable
      ? on => { if (on) onPin((f === cur ? curVar : undefined)?.id ?? f.variants[0]!.id, true); else for (const v of f.variants) if (pinned.includes(v.id)) onPin(v.id, false); }
      : undefined,
  });
  const items = grouped ? [...families.filter(isPinned), ...families.filter(f => !isPinned(f))].map(toItem) : families.map(toItem);
  const pickFamily = (name: string) => {
    const f = families.find(x => x.name === name);
    if (!f) return;
    onSelect(((curVar && findVariant(f, curVar.effort, curVar.fast, curVar.long)) ?? f.variants[0]!).id);
  };

  const params: MenuItem[] = [];
  if (cur && curVar) {
    const exact = (fast: boolean, long: boolean) => cur.variants.find(v => v.effort === curVar.effort && v.fast === fast && v.long === long);
    const both = cur.efforts.length > 1 && (cur.hasFast || cur.hasLong);
    if (cur.efforts.length > 1) for (const e of cur.efforts) params.push({ id: `e:${e}`, label: e || 'Standard', checked: e === curVar.effort, section: both ? '推理强度' : undefined });
    if (cur.hasFast) params.push({ id: 'fast', label: 'Fast', kind: 'checkbox', checked: curVar.fast, disabled: !exact(!curVar.fast, curVar.long), section: both ? '变体' : undefined });
    if (cur.hasLong) params.push({ id: 'long', label: '1M', kind: 'checkbox', checked: curVar.long, disabled: !exact(curVar.fast, !curVar.long), section: both ? '变体' : undefined });
  }
  const onParam = (id: string) => {
    if (!cur || !curVar) return;
    const v = id.startsWith('e:')
      ? findVariant(cur, id.slice(2), curVar.fast, curVar.long)
      : cur.variants.find(x => x.effort === curVar.effort && x.fast === (id === 'fast' ? !curVar.fast : curVar.fast) && x.long === (id === 'long' ? !curVar.long : curVar.long));
    if (v) onSelect(v.id);
  };

  return (
    <>
      <Menu
        side="top"
        items={items}
        searchable={families.length >= SEARCH_FROM}
        onSelect={pickFamily}
        onOpenChange={onOpenChange}
        footer={pinnable && !pinned.length ? () => <MenuFooter>悬停一项，点 pin 钉为常用</MenuFooter> : undefined}
      >
        {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} onClick={toggle} title={c.name}>{cur?.name ?? c.options.find(o => o.id === c.value)?.name ?? c.name}</Chip>}
      </Menu>
      {cur && curVar && params.length > 0 && (
        <Menu side="top" items={params} onSelect={onParam} onOpenChange={onOpenChange}>
          {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} onClick={toggle} title="推理强度 / 变体">{variantLabel(curVar, cur)}</Chip>}
        </Menu>
      )}
    </>
  );
}

// Flat configOption menu: long lists are searchable and pinnable; pinned entries go into the pinned section at the top, the rest under the all section
function OptionMenu({ control: c, pinned, onSelect, onPin, onOpenChange }: OptionMenuProps) {
  const pinnable = c.options.length >= PIN_FROM;
  const grouped = pinnable && pinned.length > 0;
  const toItem = (o: ConfigControl['options'][number]): MenuItem => {
    const isPinned = pinned.includes(o.id);
    return {
      id: o.id, label: o.name, description: o.description, checked: o.id === c.value,
      section: grouped ? (isPinned ? '常用' : '全部') : undefined,
      pinned: isPinned, onPin: pinnable ? on => onPin(o.id, on) : undefined,
    };
  };
  const items = grouped
    ? [...c.options.filter(o => pinned.includes(o.id)), ...c.options.filter(o => !pinned.includes(o.id))].map(toItem)
    : c.options.map(toItem);
  return (
    <Menu
      side="top"
      items={items}
      searchable={c.options.length >= SEARCH_FROM}
      onSelect={onSelect}
      onOpenChange={onOpenChange}
      footer={pinnable && !pinned.length ? () => <MenuFooter>悬停一项，点 pin 钉为常用</MenuFooter> : undefined}
    >
      {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} onClick={toggle} title={c.name}>{c.options.find(o => o.id === c.value)?.name ?? c.name}</Chip>}
    </Menu>
  );
}

interface AgentPanelProps {
  agent: AgentInfo;
  agents: AgentInfo[];
  // Accounts of the current agent only
  accounts: AccountInfo[];
  accountId?: string;
  close: () => void;
  onSelectAgent: (id: AgentInfo['id']) => void;
  onSelectAccount: (id: string) => void;
  onAddAccount: (agent: AgentInfo['id'], via: AddAccountVia) => void;
  onRemoveAccount: (id: string) => void;
}

// Agent menu (modeled on Devin): the options area lists agents only, one row each with vendor mark + name + check; ones not installed locally are greyed out.
// Agents that go through the account layer show the current account in the footer (click to enter the accounts page) plus a "＋" (import from local login if never imported, otherwise go sign in a new one in the terminal).
// Accounts page: one account per row (removable on hover); the footer becomes "back" and "＋"
function AgentPanel(p: AgentPanelProps) {
  const [view, setView] = useState<'agents' | 'accounts'>('agents');
  const current = p.accounts.find(a => a.id === p.accountId);
  const add = { label: '添加账号', icon: <Plus strokeWidth={1.75} />, onClick: () => { p.onAddAccount(p.agent.id, 'auto'); p.close(); } };

  if (view === 'accounts') {
    return (
      <MenuList
        items={p.accounts.map(a => ({ id: a.id, label: a.label, description: a.detail, checked: a.id === p.accountId, section: `${p.agent.name} 账号`, onRemove: () => p.onRemoveAccount(a.id) }))}
        empty="还没有账号，点「＋」添加"
        onSelect={id => { p.onSelectAccount(id); p.close(); }}
        footer={<MenuFooter onClick={() => setView('agents')} action={add}><ChevronLeft strokeWidth={1.75} />返回</MenuFooter>}
      />
    );
  }
  return (
    <MenuList
      items={p.agents.map(a => ({
        id: a.id, label: a.name, icon: <AgentMark id={a.id} name={a.name} />, checked: a.id === p.agent.id, disabled: a.available === false,
      }))}
      onSelect={id => { p.onSelectAgent(id); p.close(); }}
      footer={p.agent.accounts
        ? <MenuFooter onClick={() => setView('accounts')} action={add}>{current ? current.label : '未登录'}</MenuFooter>
        : undefined}
    />
  );
}

// Context usage: a --icon-sized ring inside a --ctl-square button; opens to show the breakdown, and agents with /compact can be compacted manually here
function ContextRing({ usage, turns, canCompact, onCompact, onOpenChange }: { usage: Usage; turns: Turn[]; canCompact: boolean; onCompact: () => void; onOpenChange: (open: boolean) => void }) {
  const pct = Math.min(1, usage.used / usage.size);
  const segments = useMemo(() => estimateUsage(turns, usage), [turns, usage]);
  const r = 6, c = 2 * Math.PI * r;
  return (
    <Popover side="top" align="end" onOpenChange={onOpenChange} content={close => <UsagePanel usage={usage} pct={pct} segments={segments} onCompact={canCompact ? () => { onCompact(); close(); } : undefined} />}>
      {({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          data-open={open || undefined}
          aria-label={`上下文已用 ${Math.round(pct * 100)}%`}
          className="inline-flex size-ctl shrink-0 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1 data-[open]:bg-active data-[open]:text-fg-1"
        >
          <svg className="size-icon -rotate-90" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r={r} stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
            <circle cx="8" cy="8" r={r} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} />
          </svg>
        </button>
      )}
    </Popover>
  );
}

// Segment colors and legend dots share one mapping: segment id → chart token
const SEG_COLOR: Record<UsageSegment['id'], string> = {
  user: 'bg-chart-user',
  agent: 'bg-chart-agent',
  tool: 'bg-chart-tool',
  thought: 'bg-chart-thought',
  system: 'bg-chart-system',
};

// Breakdown panel (modeled on Cursor): a small compact button on the right of the header row; a stacked bar + legend rows, clicking anywhere selects that segment,
// dims the others, and expands the selected row with a line of explanation. The breakdown is a local estimate, so all token counts are marked approximate
function UsagePanel({ usage, pct, segments, onCompact }: { usage: Usage; pct: number; segments: UsageSegment[]; onCompact?: () => void }) {
  const [sel, setSel] = useState<UsageSegment['id']>();
  const toggle = (id: UsageSegment['id']) => setSel(s => (s === id ? undefined : id));
  return (
    <div className="flex w-[240px] flex-col gap-2 p-2 tabular-nums">
      <div className="flex items-center justify-between">
        <span className="text-2 font-medium text-fg-1">上下文</span>
        <div className="flex items-center gap-1">
          <span className="text-2 text-fg-2">{Math.round(pct * 100)}%</span>
          {onCompact && (
            <IconButton title="压缩上下文" aria-label="压缩上下文" onClick={onCompact}>
              <Shrink strokeWidth={1.75} />
            </IconButton>
          )}
        </div>
      </div>
      <div className="flex h-2 overflow-hidden rounded-sm bg-active">
        {segments.map(s =>
          s.tokens > 0 && (
            <button
              key={s.id}
              type="button"
              aria-label={`${s.label} 约 ${fmtTokens(s.tokens)}`}
              onClick={() => toggle(s.id)}
              className={cn('h-full transition-opacity hover:brightness-125 focus-visible:brightness-125', SEG_COLOR[s.id], sel && sel !== s.id && 'opacity-30')}
              style={{ width: `${(s.tokens / usage.size) * 100}%` }}
            />
          ),
        )}
      </div>
      <div className="flex flex-col">
        {segments.map(s => (
          <div key={s.id}>
            <button
              type="button"
              onClick={() => toggle(s.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover',
                sel && sel !== s.id && 'opacity-50',
              )}
            >
              <span className={cn('size-2 shrink-0 rounded-full', SEG_COLOR[s.id])} />
              <span className="flex-1 text-3 text-fg-2">{s.label}</span>
              <span className="text-3 text-fg-3">约 {fmtTokens(s.tokens)}</span>
            </button>
            {sel === s.id && <div className="px-1 pb-1 pl-indent text-3 text-fg-3">{s.hint}</div>}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-3 text-fg-3">
        <span>已用 {fmtTokens(usage.used)}{usage.cost !== undefined ? ` · 费用 $${usage.cost.toFixed(2)}` : ''}</span>
        <span>上限 {fmtTokens(usage.size)}</span>
      </div>
    </div>
  );
}

function fmtTokens(n: number) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`;
}
