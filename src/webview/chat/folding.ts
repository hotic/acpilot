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
  return t(FOLD_KEY[block.status], { verb: block.verb });
}

export interface FoldActivity {
  kind: ToolKind | 'compaction';
  label: string;
  target?: string;
  mono?: boolean;
}

export function foldActivity(turn: AgentTurn): FoldActivity {
  if (turn.blocks.some(b => b.type === 'permission')) return { kind: 'other', label: t('host.awaitingApproval') };
  // Concurrent calls can finish out of order; a newer completed call must not hide an active one.
  for (let i = turn.blocks.length - 1; i >= 0; i--) {
    const b = turn.blocks[i]!;
    if (b.type === 'tool_call' && (b.status === 'pending' || b.status === 'in_progress')) {
      return { kind: b.kind, label: toolVerb(b), target: b.target, mono: b.targetMono };
    }
    if (b.type === 'compaction' && b.status === 'in_progress') return { kind: 'compaction', label: t('turns.compacting') };
  }
  const activity = turn.activity;
  if (activity) {
    const space = activity.label.indexOf(' ');
    return {
      kind: activity.kind,
      label: space < 0 ? activity.label : activity.label.slice(0, space),
      target: space < 0 ? undefined : activity.label.slice(space + 1),
    };
  }
  const last = turn.blocks[turn.blocks.length - 1];
  return last?.type === 'text' && last.streaming
    ? { kind: 'other', label: t('host.replying') }
    : { kind: 'think', label: t('host.thinking') };
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
