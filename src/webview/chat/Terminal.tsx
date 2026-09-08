import { useEffect, useRef } from 'react';
import type { ToolCallBlock } from '@shared/transcript';

// Command output (Codex-style "Shell" card): the command itself lives on the tool row above; this is only the output area,
// sticking to the bottom while running and stopping once the user scrolls up inside it. Shows at most --term-lines lines
export function TerminalOutput({ block }: { block: ToolCallBlock }) {
  const text = outputOf(block);
  const follow = block.status === 'in_progress' || block.status === 'pending';
  const ref = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text, follow]);
  if (!text) return null;
  return (
    <pre
      ref={ref}
      onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
      className="term-follow m-0 max-h-term overflow-y-auto rounded-lg border border-conversation-line bg-code px-pad py-2 font-mono text-mono text-fg-2 whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {text}
    </pre>
  );
}

function outputOf(b: ToolCallBlock): string {
  const c = b.content;
  if (!c) return '';
  if (c.type === 'text') return c.text.replace(/\s+$/, '');
  if (c.type === 'list') return c.items.join('\n');
  return c.lines.map(l => l.text).join('\n');
}
