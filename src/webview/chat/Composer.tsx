import { useCallback, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Shrink } from 'lucide-react';
import type { ConfigControl, Draft, SessionControls, Turn, Usage } from '@shared/transcript';
import type { FileHit } from '@shared/protocol';
import type { HiddenMap } from '@shared/settings';
import { findVariant, groupModels, modelBrand, variantLabel, visibleOptions, type ModelFamily, type ModelVariant } from '@shared/models';
import { useAppearance } from '../appearance';
import { cn } from '../ui/cn';
import { Chip, IconButton } from '../ui/Button';
import { RadioPills, SwitchRow } from '../ui/Field';
import { Menu, MenuList, Popover, type MenuItem } from '../ui/Popover';
import { WorkingBeam } from '../effects/WorkingBeam';
import { SendButton } from '../effects/SendButton';
import { DraftChips } from './Attachments';
import { collectDrafts, hasPayload } from './drafts';
import { MentionList, mentionAt, useMentionHits } from './Mention';
import { ModelMark } from './ModelMark';
import { modeIcon } from './modeIcons';
import { estimateUsage, type UsageSegment } from './usageBreakdown';

export interface ComposerProps {
  running: boolean;
  // Entire composer disabled while the session isn't ready (connecting / login required / read-only)
  disabled?: boolean;
  theme: 'dark' | 'light';
  controls: SessionControls;
  turns: Turn[];
  // Option families hidden for the current agent (settings page): configOption id → family names
  hidden?: HiddenMap[string];
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
  onCompact: () => void;
}

// Only offer search once the option count passes this threshold; short lists are scannable at a glance
const SEARCH_FROM = 12;

// Composer has three layers: attachment chips (when any), the input area, and a toolbar row below.
// The row's left side ("mode · reasoning level …") lists whatever the agent's ACP session provides, minus the model family;
// the right side holds "context ring · model · send" — the model sits where Cursor / Devin put it, next to the send button.
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
  // Model options (the ones that decompose into families) leave the left row and join the right, next to the send button
  const isModel = (c: ConfigControl) => {
    const shown = visibleOptions(c.options, p.hidden?.[c.id], c.value);
    return groupModels(shown).length < shown.length;
  };
  const modelControls = p.controls.options.filter(isModel);
  const leftControls = p.controls.options.filter(c => !isModel(c));
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
      {/* The row is a container: below the sm tier (a 380 sidebar leaves ~324 here) the mode chip collapses to icon + caret so the option chips keep their room —
          the same move Cursor makes in a narrow sidebar; the editor panel is wide enough for the names */}
      <div className="@container flex items-center gap-1 px-2 pt-1 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          {/* Mode is the one solid chip and never truncates; single-line rows with a glyph each, the description rides along as a tooltip */}
          {p.controls.modes.length > 0 && (
            <Menu
              side="top"
              width="sm"
              items={p.controls.modes.map(m => {
                const Icon = modeIcon(m);
                return { id: m.id, label: m.name, hint: m.description, icon: <Icon strokeWidth={1.75} />, checked: m.id === p.controls.modeId };
              })}
              onSelect={p.onSetMode}
              onOpenChange={onOpenChange}
            >
              {({ open, toggle, ref }) => {
                const Icon = mode ? modeIcon(mode) : undefined;
                return (
                  <Chip
                    ref={ref} variant="solid" className="shrink-0" narrow="icon" data-open={open || undefined} onClick={toggle}
                    title={mode ? [mode.name, mode.description].filter(Boolean).join(' · ') : '模式'} icon={Icon && <Icon strokeWidth={1.75} />}
                  >
                    {mode?.name ?? '模式'}
                  </Chip>
                );
              }}
            </Menu>
          )}
          {leftControls.map(c => (
            <OptionControl key={c.id} control={c} hidden={p.hidden?.[c.id]} onSelect={v => p.onSetConfig(c.id, v)} onOpenChange={onOpenChange} />
          ))}
        </div>
        {p.usage && <ContextRing usage={p.usage} turns={p.turns} canCompact={!!p.canCompact && !dim} onCompact={p.onCompact} onOpenChange={onOpenChange} />}
        {modelControls.map(c => (
          <OptionControl key={c.id} control={c} hidden={p.hidden?.[c.id]} onSelect={v => p.onSetConfig(c.id, v)} onOpenChange={onOpenChange} />
        ))}
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
  onSelect: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}

// A single configOption, minus the families hidden in the settings: names that decompose into a "family × params" structure (Devin's 210 models)
// get the model panel, otherwise one flat menu
function OptionControl({ control, hidden, ...rest }: OptionMenuProps & { hidden?: string[] }) {
  const shown = useMemo(() => ({ ...control, options: visibleOptions(control.options, hidden, control.value) }), [control, hidden]);
  const families = useMemo(() => groupModels(shown.options), [shown.options]);
  return families.length < shown.options.length ? <ModelControl {...rest} control={shown} families={families} /> : <OptionMenu {...rest} control={shown} />;
}

// One chip for the whole model choice, "family + params" with the params faint (as in Cursor's toolbar and Devin's own composer). It opens one panel:
// the searchable family list with the current family's params as a small form underneath — Devin's detail pane, laid out vertically because
// a 380 sidebar has no room beside the list. Picking a family closes the panel; changing params keeps it open.
// Switching families tries to keep the current params; if there's no matching tier it falls back to the family's first tier
function ModelControl({ control: c, families, onSelect, onOpenChange }: OptionMenuProps & { families: ModelFamily[] }) {
  const cur = families.find(f => f.variants.some(v => v.id === c.value));
  const curVar = cur?.variants.find(v => v.id === c.value);
  // Params are worth showing when the family offers a choice, or its only variant carries a flag (a lone "Composer 2.5 Fast")
  const meta = cur && curVar && (cur.variants.length > 1 || curVar.effort || curVar.fast || curVar.long) ? variantLabel(curVar, cur) : undefined;
  return (
    <Popover
      side="top" align="end" width="md" role="menu" onOpenChange={onOpenChange}
      content={close => <ModelPanel families={families} cur={cur} curVar={curVar} onSelect={onSelect} close={close} />}
    >
      {({ open, toggle, ref }) => (
        <Chip ref={ref} data-open={open || undefined} onClick={toggle} narrow="text" title={c.name} meta={meta} icon={<ModelMark family={cur?.name ?? c.name} />}>
          {cur?.name ?? c.options.find(o => o.id === c.value)?.name ?? c.name}
        </Chip>
      )}
    </Popover>
  );
}

interface ModelPanelProps {
  families: ModelFamily[];
  cur?: ModelFamily;
  curVar?: ModelVariant;
  onSelect: (value: string) => void;
  close: () => void;
}

function ModelPanel({ families, cur, curVar, onSelect, close }: ModelPanelProps) {
  const items = families.map((f): MenuItem => ({ id: f.name, label: f.name, icon: <ModelMark family={f.name} />, checked: f === cur }));
  const pickFamily = (name: string) => {
    const f = families.find(x => x.name === name);
    if (f) onSelect(((curVar && findVariant(f, curVar.effort, curVar.fast, curVar.long)) ?? f.variants[0]!).id);
    close();
  };
  return (
    <MenuList
      items={items}
      searchable={families.length >= SEARCH_FROM}
      onSelect={pickFamily}
      footer={cur && curVar && cur.variants.length > 1 ? <ModelParams family={cur} variant={curVar} onSelect={onSelect} /> : undefined}
    />
  );
}

// Params of the current family as a small form under the list: reasoning levels as radio pills (every level visible, one click), Fast / 1M as switches.
// A family whose only levels are Standard / Thinking gets a Thinking switch instead of two pills (what Cursor does). Every change applies immediately;
// a flag whose combination the agent doesn't offer is disabled rather than hidden, so the shape of the form doesn't jump between variants
function ModelParams({ family: f, variant: v, onSelect }: { family: ModelFamily; variant: ModelVariant; onSelect: (id: string) => void }) {
  const at = (effort: string, fast: boolean, long: boolean) => f.variants.find(x => x.effort === effort && x.fast === fast && x.long === long);
  const thinkingSwitch = f.efforts.length === 2 && f.efforts.includes('') && f.efforts.includes('Thinking');
  // Level changes keep Fast / 1M when that tier has them, otherwise drop them (findVariant's fallback order)
  const pickEffort = (e: string) => { const hit = findVariant(f, e, v.fast, v.long); if (hit) onSelect(hit.id); };
  const flip = (key: 'fast' | 'long') => { const hit = at(v.effort, key === 'fast' ? !v.fast : v.fast, key === 'long' ? !v.long : v.long); if (hit) onSelect(hit.id); };
  return (
    <div className="mt-1 flex flex-col border-t border-line pt-1">
      {f.efforts.length > 1 && !thinkingSwitch && (
        <>
          <div className="px-2 pb-0.5 text-3 text-fg-3">推理强度</div>
          <RadioPills label="推理强度" options={f.efforts.map(e => ({ value: e, label: e || 'Standard' }))} value={v.effort} onChange={pickEffort} />
        </>
      )}
      {thinkingSwitch && (
        <SwitchRow label="Thinking" checked={v.effort === 'Thinking'} disabled={!findVariant(f, v.effort === 'Thinking' ? '' : 'Thinking', v.fast, v.long)} onChange={on => pickEffort(on ? 'Thinking' : '')} />
      )}
      {f.hasFast && <SwitchRow label="Fast" checked={v.fast} disabled={!at(v.effort, !v.fast, v.long)} onChange={() => flip('fast')} />}
      {f.hasLong && <SwitchRow label="1M" checked={v.long} disabled={!at(v.effort, v.fast, !v.long)} onChange={() => flip('long')} />}
    </div>
  );
}

// Flat configOption menu; long lists are searchable. Vendor marks only appear when at least one option names a known brand
// (Grok's monolithic model list) — a thought_level menu of "Low / High" stays text-only instead of earning letter tiles
function OptionMenu({ control: c, onSelect, onOpenChange }: OptionMenuProps) {
  const branded = c.options.some(o => modelBrand(o.name));
  const items = c.options.map((o): MenuItem => ({ id: o.id, label: o.name, description: o.description, icon: branded ? <ModelMark family={o.name} /> : undefined, checked: o.id === c.value }));
  const curName = c.options.find(o => o.id === c.value)?.name;
  const curIcon = branded && curName && modelBrand(curName) ? <ModelMark family={curName} /> : undefined;
  return (
    <Menu side="top" width="md" items={items} searchable={c.options.length >= SEARCH_FROM} onSelect={onSelect} onOpenChange={onOpenChange}>
      {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} onClick={toggle} narrow="text" title={c.name} icon={curIcon}>{curName ?? c.name}</Chip>}
    </Menu>
  );
}

// Context usage: a --icon-sized ring inside a --ctl-square button; opens to show the breakdown, and agents with /compact can be compacted manually here
function ContextRing({ usage, turns, canCompact, onCompact, onOpenChange }: { usage: Usage; turns: Turn[]; canCompact: boolean; onCompact: () => void; onOpenChange: (open: boolean) => void }) {
  const pct = Math.min(1, usage.used / usage.size);
  const segments = useMemo(() => estimateUsage(turns, usage), [turns, usage]);
  const r = 6, c = 2 * Math.PI * r;
  return (
    <Popover side="top" align="end" width="lg" onOpenChange={onOpenChange} content={close => <UsagePanel usage={usage} pct={pct} segments={segments} onCompact={canCompact ? () => { onCompact(); close(); } : undefined} />}>
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

// Breakdown panel (modeled on Cursor's context usage): title row with the compact button, one summary line (percent left, "~used / size" right), a thin stacked bar,
// then legend rows — square swatch, label, right-aligned count. Clicking a segment or row selects it, dims the others, and expands the row with a line of explanation.
// The breakdown is a local estimate, so the total carries a "~" and the counts are read as approximate
function UsagePanel({ usage, pct, segments, onCompact }: { usage: Usage; pct: number; segments: UsageSegment[]; onCompact?: () => void }) {
  const [sel, setSel] = useState<UsageSegment['id']>();
  const toggle = (id: UsageSegment['id']) => setSel(s => (s === id ? undefined : id));
  return (
    <div className="flex flex-col gap-1 p-1 tabular-nums">
      <div className="flex h-ctl items-center justify-between pl-2">
        <span className="text-2 font-medium text-fg-1">上下文</span>
        {onCompact && (
          <IconButton title="压缩上下文" aria-label="压缩上下文" onClick={onCompact}>
            <Shrink strokeWidth={1.75} />
          </IconButton>
        )}
      </div>
      <div className="flex items-baseline justify-between px-2 text-3">
        <span className="text-fg-2">已用 {Math.round(pct * 100)}%</span>
        <span className="text-fg-3">~{fmtTokens(usage.used)} / {fmtTokens(usage.size)}{usage.cost !== undefined ? ` · $${usage.cost.toFixed(2)}` : ''}</span>
      </div>
      <div className="mx-2 mb-1 flex h-1.5 overflow-hidden rounded-full bg-active">
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
                'flex min-h-row w-full items-center gap-2 rounded-md px-2 text-left text-3 transition-colors hover:bg-hover focus-visible:bg-hover',
                sel && sel !== s.id && 'opacity-50',
              )}
            >
              {/* Swatch sits in the standard lead slot so the hint below can indent to the label with pl-indent */}
              <span className="flex w-lead shrink-0 justify-center"><span className={cn('size-2.5 rounded-xs', SEG_COLOR[s.id])} /></span>
              <span className="flex-1 text-fg-1">{s.label}</span>
              <span className="text-fg-2">{fmtTokens(s.tokens)}</span>
            </button>
            {sel === s.id && <div className="ml-2 pl-indent pr-2 pb-1 text-3 text-fg-3">{s.hint}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function fmtTokens(n: number) {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`;
}
