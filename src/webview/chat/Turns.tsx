import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronRight, Compass, FoldVertical, Layers, X } from 'lucide-react';
import type { AgentBlock, AgentTurn, CompactionBlock, ToolCallBlock, ToolKind, UserTurn } from '@shared/transcript';
import { useAppearance, useLab, type Lab } from '../appearance';
import { Row, RowTarget } from '../ui/Row';
import { Disclosure } from '../ui/Disclosure';
import { Orb } from '../effects/Orb';
import { cn } from '../ui/cn';
import { TOOL_ICON } from './icons';
import { Thought } from './Thought';
import { Plan } from './Plan';
import { ToolCall } from './ToolCall';
import { Prose } from './Prose';
import { Permission } from './Permission';

// User message: color block / right-aligned bubble / plain text; ones ACPilot sends automatically (/compact) render as a note line, not a bubble
export function UserMessage({ turn, index }: { turn: UserTurn; index: number }) {
  const { userMessage } = useAppearance();
  if (turn.auto) {
    return (
      <div className="enter" style={{ '--i': index } as CSSProperties}>
        <Row className="text-fg-3"><span>上下文到阈值，自动发送</span><RowTarget mono className="text-fg-2">{turn.text}</RowTarget></Row>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'enter text-1 text-fg-1 whitespace-pre-wrap [overflow-wrap:anywhere]',
        userMessage === 'bubble' && 'self-end max-w-[88%] rounded-lg bg-chip px-3 py-[9px]',
        userMessage === 'block' && 'rounded-lg bg-chip px-3 py-[9px]',
        userMessage === 'plain' && 'font-medium',
      )}
      style={{ '--i': index } as CSSProperties}
    >
      {turn.text}
    </div>
  );
}

type OnPermission = (blockId: string, optionId: string) => void;

// Agent message: consecutive "lines" (thought / plan / tool) are grouped together; prose / cards / terminal blocks each stand alone as blocks.
// The activity line only fills a "gap": the turn is running and this message has no in-progress tool line, streaming thought, or streaming text yet
export function AgentMessage({ turn, index, running, onPermission }: { turn: AgentTurn; index: number; running: boolean; onPermission: OnPermission }) {
  const { fold } = useLab();
  // The codex mode folds terminal blocks into the line group too; other modes keep terminal blocks as standalone blocks
  const codex = fold === 'codex';
  const groups = groupBlocks(turn.blocks, codex);
  let i = index;
  // While the codex mode is running, the head row of the last line group is the working label and carries the activity state, so no separate activity line is added
  const lastLines = groups[groups.length - 1]?.kind === 'lines';
  const showActivity = running && !!turn.activity && !turn.blocks.some(isBusy) && !(codex && lastLines);
  return (
    <div className="flex flex-col gap-gap">
      {groups.map((g, gi) => (
        <div key={gi} className="enter" style={{ '--i': Math.min(i++, 12) } as CSSProperties}>
          {g.kind === 'lines'
            ? codex
              ? <CodexFold blocks={g.blocks} working={running && gi === groups.length - 1} activity={turn.activity?.label} />
              : <Lines blocks={g.blocks} fold={fold} />
            : <Block block={g.block} onPermission={onPermission} />}
        </div>
      ))}
      {showActivity && (
        <div className="enter" style={{ '--i': i++ } as CSSProperties}>
          <Activity label={turn.activity!.label} />
        </div>
      )}
    </div>
  );
}

function isBusy(b: AgentBlock): boolean {
  if (b.type === 'tool_call') return b.status === 'in_progress' || b.status === 'pending';
  if (b.type === 'thought' || b.type === 'text') return !!b.streaming;
  return false;
}

// What's happening: Orb + verb on a single non-clickable row. It's the only one of its kind in the message, no alignment concerns, so the Orb is placed unconditionally
function Activity({ label }: { label: string }) {
  return (
    <Row lead={<Orb kind="think" />} className="font-medium">
      <span>{label.split(' ')[0]}</span>
      <RowTarget mono className="font-normal">{label.split(' ').slice(1).join(' ')}</RowTarget>
    </Row>
  );
}

const LINE_TYPES = new Set(['thought', 'plan', 'tool_call', 'compaction']);
type Group = { kind: 'lines'; blocks: AgentBlock[] } | { kind: 'block'; block: AgentBlock };

function groupBlocks(blocks: AgentBlock[], withExecute: boolean): Group[] {
  const out: Group[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    const isLine = LINE_TYPES.has(b.type) && (withExecute || !(b.type === 'tool_call' && b.kind === 'execute'));
    if (isLine) {
      if (last?.kind === 'lines') last.blocks.push(b);
      else out.push({ kind: 'lines', blocks: [b] });
    } else out.push({ kind: 'block', block: b });
  }
  return out;
}

// A group of lines: "none" lays them flat; "cursor" folds runs of finished read-only actions (read / search / fetch, ≥ 2) into one expandable row
function Lines({ blocks, fold }: { blocks: AgentBlock[]; fold: Lab['fold'] }) {
  const items = fold === 'cursor' ? foldReadOnly(blocks) : blocks.map(b => ({ kind: 'one' as const, block: b }));
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((it, i) => it.kind === 'one'
        ? <LineBlock key={i} block={it.block} />
        : <CursorFold key={it.blocks[0]!.id} blocks={it.blocks} />)}
    </div>
  );
}

type LineItem = { kind: 'one'; block: AgentBlock } | { kind: 'fold'; blocks: ToolCallBlock[] };

const READ_ONLY: ReadonlySet<ToolKind> = new Set<ToolKind>(['read', 'search', 'fetch']);

function isFoldableRead(b: AgentBlock): b is ToolCallBlock {
  return b.type === 'tool_call' && READ_ONLY.has(b.kind) && b.status !== 'in_progress' && b.status !== 'pending';
}

function foldReadOnly(blocks: AgentBlock[]): LineItem[] {
  const out: LineItem[] = [];
  let run: ToolCallBlock[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ kind: 'fold', blocks: run });
    else for (const b of run) out.push({ kind: 'one', block: b });
    run = [];
  };
  for (const b of blocks) {
    if (isFoldableRead(b)) run.push(b);
    else { flush(); out.push({ kind: 'one', block: b }); }
  }
  flush();
  return out;
}

// Disclosure shared by fold rows: lead-slot rules match other rows (toolLine=text has no slot), the trailing chevron rotates 90° when open;
// the body isn't indented — expanded rows align vertically with the head row, and open/close alone marks the hierarchy
function FoldRow({ icon, children, body, open, onToggle }: { icon: ReactNode; children: ReactNode; body: ReactNode; open?: boolean; onToggle?: (open: boolean) => void }) {
  const { toolLine } = useAppearance();
  const { timeline } = useLab();
  return (
    <Disclosure
      lead={toolLine === 'text' ? undefined : icon}
      indent={false}
      open={open}
      onToggle={onToggle}
      trailing={<ChevronRight className="size-3 transition-transform group-data-[open]:rotate-90" strokeWidth={1.75} />}
      body={<div className={cn('flex flex-col gap-0.5', timeline && toolLine !== 'text' && 'timeline')}>{body}</div>}
    >
      {children}
    </Disclosure>
  );
}

// Cursor mode: all read → "read N files", all search → "searched N times", mixed → "explored N places"
function CursorFold({ blocks }: { blocks: ToolCallBlock[] }) {
  const kinds = new Set(blocks.map(b => b.kind));
  const only = kinds.size === 1 ? blocks[0]!.kind : undefined;
  const files = new Set(blocks.map(b => b.target).filter(Boolean)).size || blocks.length;
  const label = only === 'read' ? `读取 ${files} 个文件` : only === 'search' ? `搜索 ${blocks.length} 次` : `探索了 ${blocks.length} 处`;
  const Icon = only ? TOOL_ICON[only] : Compass;
  return (
    <FoldRow icon={<Icon className="size-icon" strokeWidth={1.5} />} body={blocks.map(b => <ToolCall key={b.id} block={b} />)}>
      <span>{label}</span>
    </FoldRow>
  );
}

// Codex mode: the whole run of lines sits under one head row. While running, the head row is the activity text (shimmer) with the body expanded; when the turn ends
// the head row switches to "took <duration> · <action summary>" and auto-collapses, then can be reopened manually. Consecutive turns share the same structure, just open vs. closed.
// Duration: the transcript has no per-turn start/end timestamps, so we sum the durationSec of the thoughts in this run; if there are none, the duration part is omitted.
// Summary: action kinds deduplicated, in order of appearance, worded in the completed form; Thinking is excluded from the summary
const ACTION_LABEL: Partial<Record<ToolKind, string>> = {
  edit: '编辑了文件',
  read: '读取了文件',
  search: '搜索了代码',
  execute: '运行了命令',
  fetch: '抓取了网页',
};

function CodexFold({ blocks, working, activity }: { blocks: AgentBlock[]; working: boolean; activity?: string }) {
  const [open, setOpen] = useState(working);
  useEffect(() => { if (!working) setOpen(false); }, [working]);
  const secs = blocks.reduce((n, b) => n + (b.type === 'thought' ? b.durationSec ?? 0 : 0), 0);
  const actions: string[] = [];
  for (const b of blocks) {
    const l = b.type === 'tool_call' ? ACTION_LABEL[b.kind] : undefined;
    if (l && !actions.includes(l)) actions.push(l);
  }
  const parts = [...(secs > 0 ? [`用时 ${fmtSecs(secs)}`] : []), ...actions];
  return (
    <FoldRow icon={<Layers className="size-icon" strokeWidth={1.5} />} open={open} onToggle={setOpen} body={blocks.map((b, i) => <LineBlock key={i} block={b} />)}>
      {working
        ? <span className="shimmer">{activity ?? '正在工作'}</span>
        : <span>{parts.length ? parts.join(' · ') : '已完成'}</span>}
    </FoldRow>
  );
}

function fmtSecs(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function LineBlock({ block }: { block: AgentBlock }) {
  if (block.type === 'thought') return <Thought block={block} />;
  if (block.type === 'plan') return <Plan block={block} />;
  if (block.type === 'tool_call') return <ToolCall block={block} />;
  if (block.type === 'compaction') return <Compaction block={block} />;
  return null;
}

// Context compaction: a status line — shimmer while running, a check on success, a cross on failure; the lead is a static icon in icon mode
function Compaction({ block }: { block: CompactionBlock }) {
  const { toolLine } = useAppearance();
  const running = block.status === 'in_progress';
  const lead = toolLine === 'text' ? undefined : <FoldVertical className="size-icon" strokeWidth={1.5} />;
  const trailing = toolLine === 'rich'
    ? <>
        {block.status === 'completed' && <Check className="size-3 text-ok" strokeWidth={2} />}
        {block.status === 'failed' && <X className="size-3 text-danger" strokeWidth={2} />}
      </>
    : undefined;
  const label = running ? '正在压缩上下文' : block.status === 'completed' ? '已压缩上下文' : block.status === 'failed' ? '压缩上下文失败' : '压缩上下文已取消';
  return (
    <Row lead={lead} trailing={trailing}>
      <span className={running ? 'shimmer' : undefined}>{label}</span>
    </Row>
  );
}

function Block({ block, onPermission }: { block: AgentBlock; onPermission: OnPermission }) {
  if (block.type === 'text') return <Prose block={block} />;
  if (block.type === 'permission') return <Permission block={block} onChoose={id => onPermission(block.id, id)} />;
  return <LineBlock block={block} />;
}
