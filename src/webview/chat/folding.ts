import type { AgentBlock, AgentTurn, TextBlock, ToolCallBlock, ToolKind } from '@shared/transcript';

// ACP has no final/commentary distinction: only the trailing text stays outside the process fold.
// If another action arrives, that text becomes process history on the next render.
export function splitCodexBlocks(blocks: AgentBlock[]) {
  const permissions = blocks.filter(b => b.type === 'permission');
  const content = blocks.filter(b => b.type !== 'permission');
  let end = content.length;
  while (end > 0 && content[end - 1]?.type === 'text') end--;
  return { process: content.slice(0, end), reply: content.slice(end) as TextBlock[], permissions };
}

export function toolVerb(block: ToolCallBlock): string {
  switch (block.status) {
    case 'pending':
    case 'in_progress': return `正在${block.verb}`;
    case 'completed': return `已${block.verb}`;
    case 'failed': return `${block.verb}失败`;
    case 'cancelled': return `已取消${block.verb}`;
  }
}

export interface FoldActivity {
  kind: ToolKind | 'compaction';
  label: string;
  target?: string;
  mono?: boolean;
}

export function foldActivity(turn: AgentTurn): FoldActivity {
  if (turn.blocks.some(b => b.type === 'permission')) return { kind: 'other', label: '等待批准' };
  // Concurrent calls can finish out of order; a newer completed call must not hide an active one.
  for (let i = turn.blocks.length - 1; i >= 0; i--) {
    const b = turn.blocks[i]!;
    if (b.type === 'tool_call' && (b.status === 'pending' || b.status === 'in_progress')) {
      return { kind: b.kind, label: toolVerb(b), target: b.target, mono: b.targetMono };
    }
    if (b.type === 'compaction' && b.status === 'in_progress') return { kind: 'compaction', label: '正在压缩上下文' };
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
    ? { kind: 'other', label: '正在回复' }
    : { kind: 'think', label: '正在思考' };
}

export function elapsedLabel(turn: AgentTurn): string {
  // Thought durations omit tool execution and waiting, so they cannot substitute for turn timing.
  if (turn.startedAt === undefined || turn.endedAt === undefined) return '已完成';
  const seconds = Math.max(0, Math.round((turn.endedAt - turn.startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `用时 ${minutes ? `${minutes}分钟${rest ? ` ${rest}秒` : ''}` : `${rest}秒`}`;
}
