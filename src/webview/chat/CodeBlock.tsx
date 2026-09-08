import type { ReactNode } from 'react';
import type { DiffLine } from '@shared/transcript';
import { cn } from '../ui/cn';

// Code surface: all monospace content (code blocks / tool output / diffs) shares this one surface,
// outlined with the conversation ring so it reads as a card next to the composer and bubbles
export function CodeSurface({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <pre className={cn('m-0 overflow-auto rounded-lg border border-conversation-line bg-code font-mono text-mono text-fg-1', padded && 'px-pad py-[calc(var(--pad)-2px)]', className)}>
      {children}
    </pre>
  );
}

// Lightweight token coloring for tool output that is not Markdown; streamdown handles fenced blocks in Prose
const TOKEN = /(\/\/.*$)|('[^']*')|\b(const|let|export|async|function|return|for|of|if|await|import|from|new|type|interface)\b|\b([A-Z][A-Za-z0-9]*)\b|\b([a-z_][A-Za-z0-9_]*)(?=\()/gm;
const CLASS = ['text-[var(--tk-c)]', 'text-[var(--tk-s)]', 'text-[var(--tk-k)]', 'text-[var(--tk-t)]', 'text-[var(--tk-f)]'];

export function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of code.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(code.slice(last, idx));
    const g = m.slice(1).findIndex(Boolean);
    out.push(<span key={i++} className={CLASS[g]}>{m[0]}</span>);
    last = idx + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function CodeBlock({ code }: { code: string }) {
  return <CodeSurface><code>{highlight(code)}</code></CodeSurface>;
}

const DIFF_CLASS: Record<DiffLine['kind'], string> = {
  hunk: 'text-fg-3',
  add: 'bg-[var(--diff-add)] text-fg-1',
  del: 'bg-[var(--diff-del)] text-fg-2',
  ctx: 'text-fg-2',
};

export function DiffBlock({ lines }: { lines: DiffLine[] }) {
  return (
    <CodeSurface padded={false} className="py-1.5">
      {lines.map((l, i) => (
        <span key={i} className={cn('block whitespace-pre px-pad', DIFF_CLASS[l.kind])}>{l.text}</span>
      ))}
    </CodeSurface>
  );
}
