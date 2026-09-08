import { useCallback, useEffect, useRef } from 'react';
import type { ToolCallBlock } from '@shared/transcript';
import { useScrollFade } from '../ui/useScrollFade';

// Command output (Codex-style "Shell" card): the command itself lives on the tool row above; this is only the output area,
// sticking to the bottom while running and stopping once the user scrolls up inside it. Shows at most --term-lines lines
export function TerminalOutput({ block }: { block: ToolCallBlock }) {
  const text = outputOf(block);
  const follow = block.status === 'in_progress' || block.status === 'pending';
  const ref = useRef<HTMLPreElement>(null);
  const fade = useScrollFade<HTMLPreElement>();
  const setRef = useCallback((element: HTMLPreElement | null) => {
    ref.current = element;
    return fade(element);
  }, [fade]);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text, follow]);
  if (!text) return null;
  return (
    <div className="rounded-lg border border-conversation-line bg-code">
      <pre
        ref={setRef}
        onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
        className="term-follow scroll-fade m-0 max-h-term overflow-y-auto rounded-lg px-pad py-2 font-mono text-mono text-fg-2 whitespace-pre-wrap [overflow-wrap:anywhere]"
      >
        {text}
      </pre>
    </div>
  );
}

function outputOf(b: ToolCallBlock): string {
  const c = b.content;
  if (!c) return '';
  if (c.type === 'text') return c.text.replace(/\s+$/, '');
  if (c.type === 'list') return c.items.join('\n');
  return c.lines.map(l => l.text).join('\n');
}
