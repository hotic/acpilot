import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import type { ToolCallBlock } from '@shared/transcript';
import { Collapse } from '../ui/Collapse';
import { cn } from '../ui/cn';

// Command execution = one whole terminal block: a command header on top (terminal icon in the lead slot, command text shimmering while running), an output area below that scrolls live, showing at most --term-lines lines.
// Click the header to collapse / expand the output
export function TerminalBlock({ block }: { block: ToolCallBlock }) {
  const running = block.status === 'in_progress' || block.status === 'pending';
  const output = outputOf(block);
  const [open, setOpen] = useState(true);
  const trailing = block.meta
    ?? (block.status === 'failed' ? '失败' : block.status === 'cancelled' ? '已取消' : undefined);
  return (
    <div className="flex flex-col overflow-hidden rounded-lg bg-code" data-status={block.status}>
      <button
        type="button"
        aria-expanded={output ? open : undefined}
        onClick={() => output && setOpen(o => !o)}
        className={cn(
          'flex items-start gap-gap px-pad py-[calc((var(--row)-var(--text-mono-lh))/2)] text-left transition-colors',
          output ? 'cursor-pointer hover:bg-hover' : 'cursor-default',
        )}
      >
        <span className="flex size-lead shrink-0 items-center justify-center self-start text-fg-3 [height:var(--text-mono-lh)]">
          <TerminalIcon className={cn('size-icon', block.status === 'failed' && 'text-danger')} strokeWidth={1.5} />
        </span>
        <span className={cn('min-w-0 flex-1 font-mono text-mono text-fg-1 whitespace-pre-wrap [overflow-wrap:anywhere] line-clamp-3', running && 'shimmer')}>{block.target ?? block.verb}</span>
        {trailing && <span className={cn('shrink-0 text-3 text-fg-3 tabular-nums [line-height:var(--text-mono-lh)]', block.status === 'failed' && 'text-danger')}>{trailing}</span>}
      </button>
      <Collapse open={!!output && open}>
        <Output text={output} follow={running} />
      </Collapse>
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

// Output area: sticks to the bottom while running, stops following once the user scrolls up inside the block; a 6% white divider separates it from the command header
function Output({ text, follow }: { text: string; follow: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && follow && pinned.current) el.scrollTop = el.scrollHeight;
  }, [text, follow]);
  return (
    <pre
      ref={ref}
      onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24; }}
      className="term-follow m-0 max-h-term overflow-y-auto border-t border-line px-pad py-2 font-mono text-mono text-fg-2 whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {text}
    </pre>
  );
}
