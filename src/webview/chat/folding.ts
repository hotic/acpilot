import type { AgentBlock, AgentTurn, TextBlock, ToolCallBlock, ToolKind } from '@shared/transcript';
import type { MsgKey } from '@shared/i18n';
import { t } from '../i18n';

// ACP has no final/commentary distinction: only the trailing text stays outside the process fold.
// If another action arrives, that text becomes process history on the next render.
export function splitCodexBlocks(blocks: AgentBlock[]) {
  const permissions = blocks.filter(b => b.type === 'permission');
  const content = blocks.filter(b => b.type !== 'permission');
  let end = content.length;
  while (end > 0 && content[end - 1]?.type === 'text') end--;
  return { process: content.slice(0, end), reply: content.slice(end) as TextBlock[], permissions };
}

const FOLD_KEY: Record<ToolCallBlock['status'], MsgKey> = {
  pending: 'fold.pending',
  in_progress: 'fold.pending',
  completed: 'fold.done',
  failed: 'fold.failed',
  cancelled: 'fold.cancelled',
};

export function toolVerb(block: ToolCallBlock): string {
  // Stored verbs use the host locale at creation time; render from semantic kind.
  return t(FOLD_KEY[block.status], { verb: t(`verb.${block.kind}`) });
}

export interface FoldActivity {
  kind: ToolKind | 'compaction';
  label: string;
  target?: string;
  mono?: boolean;
  active?: boolean;
}

export function foldActivity(turn: AgentTurn): FoldActivity {
  if (turn.blocks.some(b => b.type === 'permission')) return { kind: 'other', label: t('host.awaitingApproval') };
  // Concurrent calls can finish out of order; a newer completed call must not hide an active one.
  for (let i = turn.blocks.length - 1; i >= 0; i--) {
    const b = turn.blocks[i]!;
    if (b.type === 'tool_call' && (b.status === 'pending' || b.status === 'in_progress')) {
      return { kind: b.kind, label: toolVerb(b), target: b.target, mono: b.targetMono, active: true };
    }
    if (b.type === 'compaction' && b.status === 'in_progress') return { kind: 'compaction', label: t('turns.compacting') };
  }
  // Read current transcript state before a cached, already-localized activity label.
  // Completed tools stay visible between notifications without claiming they still run.
  for (let i = turn.blocks.length - 1; i >= 0; i--) {
    const b = turn.blocks[i]!;
    if (b.type === 'text' && b.streaming) return { kind: 'other', label: t('host.replying'), active: true };
    if (b.type === 'thought' && b.streaming) return { kind: 'think', label: t('host.thinking'), active: true };
    if (b.type === 'tool_call') return { kind: b.kind, label: toolVerb(b), target: b.target, mono: b.targetMono };
  }
  return { kind: 'other', label: t('host.working'), active: true };
}

export function elapsedLabel(turn: AgentTurn): string {
  // Thought durations omit tool execution and waiting, so they cannot substitute for turn timing.
  if (turn.startedAt === undefined || turn.endedAt === undefined) return t('turns.done');
  const seconds = Math.max(0, Math.round((turn.endedAt - turn.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  const dur = minutes
    ? (rest ? t('turns.elapsed.ms', { m: minutes, s: rest }) : t('turns.elapsed.m', { m: minutes }))
    : t('turns.elapsed.s', { s: rest });
  return t('turns.elapsed', { t: dur });
}
