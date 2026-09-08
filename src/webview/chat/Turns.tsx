import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronRight, Compass, Copy, Hand, MessageCircleQuestion, Pencil, TriangleAlert, X } from 'lucide-react';
import { IconButton } from '../ui/Button';
import type { AgentBlock, AgentTurn, CompactionBlock, PermissionBlock, ToolCallBlock, ToolKind, UserTurn } from '@shared/transcript';
import { useAppearance, type Appearance } from '../appearance';
import { t } from '../i18n';
import { Row, RowLabel, RowTarget } from '../ui/Row';
import { Disclosure } from '../ui/Disclosure';
import { Orb } from '../effects/Orb';
import { cn } from '../ui/cn';
import { TOOL_ICON } from './icons';
import { Thought } from './Thought';
import { Plan } from './Plan';
import { ReadGroup, ToolCall } from './ToolCall';
import { groupReadCalls } from './toolDetails';
import { Prose } from './Prose';
import { Permission } from './Permission';
import { QuestionRecord } from './Questions';
import { PlanDocument } from './PlanDocument';
import { TurnAttachments } from './Attachments';
import { elapsedLabel, splitCodexBlocks } from './folding';
import { ProcessHistory } from './ProcessHistory';
import { compactionForDisplay } from './compactionDisplay';

// User message: color block / right-aligned bubble / plain text; ones Acpira sends automatically (/compact) render as a note line, not a bubble.
// Attachments (image thumbnails / file pills) sit above the text inside the same bubble.
// Hover actions occupy the existing reply gap, without adding height; clicking the card opens its inline editor.
// Sticking within the exchange is the caller's job (`HistoryMessage` wraps it), so the editor can take the card's place without a layout jump
export function UserMessage({ turn, index, blobUrl, onEdit }: { turn: UserTurn; index: number; blobUrl?: (blob: string) => string; onEdit?: () => void }) {
  const { userMessage } = useAppearance();
  if (turn.auto) {
    return (
      <div className="enter px-pad" style={{ '--i': index } as CSSProperties}>
        <Row className="text-fg-3"><span>{t('turns.autoCompact')}</span></Row>
      </div>
    );
  }
  return (
    <div className={cn('user-message-frame relative flex w-full min-w-0 flex-col', userMessage === 'bubble' && 'self-end max-w-[88%]')}>
      <div
        onClick={onEdit ? e => {
          // Preserve text selection and attachment preview controls inside the card.
          if ((e.target as HTMLElement).closest('button, a, [role="dialog"]') || window.getSelection()?.toString()) return;
          onEdit();
        } : undefined}
        className={cn(
          'user-message relative flex w-full shrink-0 flex-col gap-gap text-1 text-fg-1 [overflow-wrap:anywhere]',
          userMessage !== 'plain' && 'user-message-card rounded-lg px-pad py-gap',
          onEdit && 'user-message-editable cursor-pointer',
          userMessage === 'plain' && 'bg-bg-0 py-gap font-medium',
        )}
      >
        {turn.attachments?.length ? <TurnAttachments attachments={turn.attachments} blobUrl={blobUrl} /> : null}
        {turn.text && <div className="scroll-thin min-h-0 overflow-y-auto whitespace-pre-wrap">{turn.text}</div>}
      </div>
      <UserMessageActions text={turn.text} onEdit={onEdit} />
    </div>
  );
}

function UserMessageActions({ text, onEdit }: { text: string; onEdit?: () => void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = setTimeout(() => setCopyState('idle'), 1500);
    return () => clearTimeout(timer);
  }, [copyState, text]);
  if (!text && !onEdit) return null;
  const copyLabel = t(copyState === 'copied' ? 'history.copied' : copyState === 'failed' ? 'history.copyFailed' : 'history.copy');
  return <Row dense className="message-actions" trailing={<>
    {text && <IconButton size="sm" title={copyLabel} aria-label={copyLabel} onClick={() => {
      void navigator.clipboard.writeText(text).then(() => setCopyState('copied'), () => setCopyState('failed'));
    }}>{copyState === 'copied' ? <Check /> : copyState === 'failed' ? <TriangleAlert /> : <Copy />}</IconButton>}
    {onEdit && <IconButton size="sm" title={t('history.edit')} aria-label={t('history.edit')} onClick={onEdit}><Pencil /></IconButton>}
    <span role="status" className="sr-only">{copyState !== 'idle' ? copyLabel : ''}</span>
  </>}>{null}</Row>;
}

type OnPermission = (blockId: string, optionId: string) => void;

// Agent message: consecutive "lines" (thought / plan / tool, commands included) are grouped together; prose / permission cards each stand alone as blocks.
// The top-level activity owns the only Orb; detailed rows show their own verbs with static icons.
export function AgentMessage({ turn, index, running, onPermission, compacting }: { turn: AgentTurn; index: number; running: boolean; onPermission: OnPermission; compacting?: boolean }) {
  if (compacting) turn = compactionForDisplay(turn, running);
  const plans = turn.blocks.filter(b => b.type === 'plan_document');
  // Keep pending approvals in the activity input even when their controls live
  // on the plan card; removing them makes the process heading report thinking.
  const content = { ...turn, blocks: turn.blocks.filter(b => b.type !== 'plan_document') };
  return <div className="agent-message flex min-w-0 flex-col gap-gap">
    <AgentContent turn={content} index={index} running={running} onPermission={onPermission} />
    {plans.map(plan => <PlanDocument key={plan.id} block={plan}
      permission={turn.blocks.find((b): b is PermissionBlock => b.type === 'permission' && b.planId === plan.id)} onChoose={onPermission} />)}
  </div>;
}

function AgentContent({ turn, index, running, onPermission }: { turn: AgentTurn; index: number; running: boolean; onPermission: OnPermission }) {
  const { fold } = useAppearance();
  if (fold === 'codex') return <CodexMessage turn={turn} running={running} onPermission={onPermission} />;
  // Plan approvals live on the plan card and the open question card above the composer; neither takes a slot in the message
  const groups = groupBlocks(turn.blocks.filter(b => (b.type !== 'permission' || !b.planId) && (b.type !== 'question' || !!b.outcome)));
  let i = index;
  return (
    <div className="flex flex-col gap-gap">
      {running && <Activity turn={turn} />}
      {groups.map((g, gi) => (
        <div key={g.kind === 'block' && 'id' in g.block && g.block.id ? g.block.id : `g${gi}`} className="enter" style={{ '--i': Math.min(i++, 12) } as CSSProperties}>
          {g.kind === 'lines'
            ? <Lines blocks={g.blocks} fold={fold} running={running} />
            : <Block block={g.block} onPermission={onPermission} />}
        </div>
      ))}
      {!running && outcomeOf(turn) && (
        <div className="enter" style={{ '--i': Math.min(i++, 12) } as CSSProperties}>
          <Outcome turn={turn} />
        </div>
      )}
    </div>
  );
}

// How the turn ended, when that is worth a line: it stopped short (error / refusal / a limit / stopped by hand), or it ended normally with nothing to show.
// Nothing for a normal end with content, nor for turns persisted before `stop` existed
function outcomeOf(turn: AgentTurn): string | undefined {
  switch (turn.stop) {
    case 'error': return t('turns.stop.error');
    case 'refusal': return t('turns.stop.refusal');
    case 'max_tokens': return t('turns.stop.maxTokens');
    case 'max_turn_requests': return t('turns.stop.maxTurns');
    case 'cancelled': return t('turns.stop.cancelled');
    default: return turn.stop === 'end_turn' && turn.blocks.length === 0 ? t('turns.stop.empty') : undefined;
  }
}

// One faint row closing the message: a warning glyph for the short stops, none for "stopped" / "no reply"; the error's own words ride along as the target
function Outcome({ turn }: { turn: AgentTurn }) {
  const { toolLine } = useAppearance();
  const warn = turn.stop !== 'cancelled' && turn.stop !== 'end_turn';
  const lead = toolLine === 'text' || !warn ? undefined : <TriangleAlert className="size-icon" strokeWidth={1.5} />;
  return (
    <Row lead={lead} className="text-fg-3">
      <RowLabel>{outcomeOf(turn)}</RowLabel>
      {turn.stop === 'error' && turn.error?.message && <RowTarget className="text-fg-3">{turn.error.message}</RowTarget>}
    </Row>
  );
}

// Turn-level activity is independent of the latest tool and the fold's expansion state.
// A pending user decision suspends the animation until the turn can continue.
function liveActivity(turn: AgentTurn) {
  if (turn.blocks.some(b => b.type === 'permission')) {
    return { label: t('host.awaitingApproval'), active: false, lead: <Hand className="size-icon" strokeWidth={1.5} /> };
  }
  if (turn.blocks.some(b => b.type === 'question' && !b.outcome)) {
    return { label: t('host.awaitingAnswers'), active: false, lead: <MessageCircleQuestion className="size-icon" strokeWidth={1.5} /> };
  }
  return { label: t('host.working'), active: true, lead: <Orb kind="think" /> };
}

function Activity({ turn }: { turn: AgentTurn }) {
  const activity = liveActivity(turn);
  return (
    <Row lead={activity.lead} className="font-medium">
      <RowLabel className={activity.active ? 'shimmer' : undefined}>{activity.label}</RowLabel>
    </Row>
  );
}

const LINE_TYPES = new Set(['thought', 'plan', 'tool_call', 'compaction']);
type Group = { kind: 'lines'; blocks: AgentBlock[] } | { kind: 'block'; block: AgentBlock };

function groupBlocks(blocks: AgentBlock[]): Group[] {
  const out: Group[] = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (LINE_TYPES.has(b.type)) {
      if (last?.kind === 'lines') last.blocks.push(b);
      else out.push({ kind: 'lines', blocks: [b] });
    } else out.push({ kind: 'block', block: b });
  }
  return out;
}

// A group of lines in cursor mode: runs of finished read-only actions (read / search / fetch, ≥ 2) fold into one expandable row, everything else stays flat
function Lines({ blocks, fold, running }: { blocks: AgentBlock[]; fold: Appearance['fold']; running: boolean }) {
  const items = fold === 'cursor' ? foldReadOnly(blocks) : blocks.map(b => ({ kind: 'one' as const, block: b }));
  return (
    <div className="process-lines flex flex-col gap-0.5">
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
  const [innerOpen, setInnerOpen] = useState(false);
  const expanded = open ?? innerOpen;
  return (
    <Disclosure
      lead={toolLine === 'text' ? undefined : icon}
      indent={false}
      open={expanded}
      onToggle={next => { setInnerOpen(next); onToggle?.(next); }}
      trailing={<ChevronRight className="size-3 transition-transform group-data-[open]:rotate-90" strokeWidth={1.75} />}
      body={<ProcessHistory>{body}</ProcessHistory>}
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
  const label = only === 'read' ? t('turns.readFiles', { n: files }) : only === 'search' ? t('turns.searched', { n: blocks.length }) : t('turns.explored', { n: blocks.length });
  const Icon = only ? TOOL_ICON[only] : Compass;
  return (
    <FoldRow icon={<Icon className="size-icon" strokeWidth={1.5} />} body={<ProcessBlocks blocks={blocks} />}>
      <span>{label}</span>
    </FoldRow>
  );
}

// One fold per turn. New chunks update its heading and history without resetting the manual toggle.
// Permission cards stay outside; the latest reply remains visible while it streams.
function CodexMessage({ turn, running, onPermission }: { turn: AgentTurn; running: boolean; onPermission: OnPermission }) {
  // Thoughts keep their normal disclosure. A turn without tools needs no enclosing process fold.
  if (!turn.blocks.some(block => block.type === 'tool_call')) {
    return (
      <div className="flex flex-col gap-gap">
        {running && <Activity turn={turn} />}
        {turn.blocks.map((block, i) => <Block key={'id' in block ? block.id : i} block={block} onPermission={onPermission} />)}
        {!running && outcomeOf(turn) && <Outcome turn={turn} />}
      </div>
    );
  }
  const { process, reply, permissions, questions } = splitCodexBlocks(turn.blocks);
  return (
    <div className="flex flex-col gap-gap">
      {(process.length > 0 || (running && reply.length === 0)) && <CodexFold turn={turn} blocks={process} running={running} />}
      {questions.map(block => <QuestionRecord key={block.id} block={block} />)}
      {reply.map((block, i) => <Prose key={i} block={block} />)}
      {permissions.filter(block => !block.planId).map(block => <Permission key={block.id} block={block} onChoose={id => onPermission(block.id, id)} />)}
      {!running && outcomeOf(turn) && <Outcome turn={turn} />}
    </div>
  );
}

function CodexFold({ turn, blocks, running }: { turn: AgentTurn; blocks: AgentBlock[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const activity = liveActivity(turn);
  const CompletionIcon = turn.stop === 'cancelled' ? X : outcomeOf(turn) ? TriangleAlert : Check;
  const lead = running ? activity.lead : <CompletionIcon className="size-icon" strokeWidth={1.5} />;
  const label = running ? activity.label : outcomeOf(turn) ?? t('turns.done');
  const elapsed = !running && turn.startedAt !== undefined && turn.endedAt !== undefined ? elapsedLabel(turn) : undefined;
  const heading = <>
    <RowLabel className={running && activity.active ? 'shimmer' : undefined}>{label}</RowLabel>
    {elapsed && <span className="min-w-0 truncate text-fg-3" title={elapsed}>{elapsed}</span>}
  </>;
  if (blocks.length === 0) return <Row lead={lead}>{heading}</Row>;
  return (
    <Disclosure
      lead={lead} indent={false} open={open} onToggle={setOpen}
      title={label}
      body={<ProcessHistory><ProcessBlocks blocks={blocks} /></ProcessHistory>}
    >
      {heading}
      <ChevronRight className={cn('size-3 shrink-0 self-center transition-transform', open && 'rotate-90')} strokeWidth={1.75} />
    </Disclosure>
  );
}

// Process details retain static icons; only the currently running verb shimmers.
function ProcessBlocks({ blocks }: { blocks: AgentBlock[] }) {
  return groupReadCalls(blocks).map((item, i) => Array.isArray(item)
    ? <ReadGroup key={item[0]!.id} blocks={item} />
    : item.type === 'tool_call' ? <ToolCall key={item.id} block={item} grouped />
    : item.type === 'text' ? <Prose key={i} block={item} />
    : <LineBlock key={'id' in item ? item.id : i} block={item} />);
}

function LineBlock({ block }: { block: AgentBlock }) {
  if (block.type === 'thought') return <Thought block={block} />;
  if (block.type === 'plan') return <Plan block={block} />;
  if (block.type === 'tool_call') return <ToolCall block={block} />;
  if (block.type === 'compaction') return <Compaction block={block} />;
  return null;
}

// Context compaction is a localized status aligned with ordinary reply text.
function Compaction({ block }: { block: CompactionBlock }) {
  const running = block.status === 'in_progress';
  const label = running ? t('turns.compacting') : block.status === 'completed' ? t('turns.compacted') : block.status === 'failed' ? t('turns.compactFailed') : t('turns.compactCancelled');
  return (
    <Row className="text-fg-3">
      <span className={running ? 'shimmer' : undefined}>{label}</span>
    </Row>
  );
}

function Block({ block, onPermission }: { block: AgentBlock; onPermission: OnPermission }) {
  if (block.type === 'text') return <Prose block={block} />;
  if (block.type === 'permission') return block.planId ? null : <Permission block={block} onChoose={id => onPermission(block.id, id)} />;
  // The open card is pinned above the composer by the shell; only a resolved one has a place in the message
  if (block.type === 'question') return block.outcome ? <QuestionRecord block={block} /> : null;
  return <LineBlock block={block} />;
}
