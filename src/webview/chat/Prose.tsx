import type { ReactNode } from 'react';
import type { TextBlock } from '@shared/transcript';
import { CodeBlock } from './CodeBlock';

// Minimal Markdown: paragraphs / fenced code / inline code. The whole file gets replaced once streamdown is integrated; the interface stays the same
export function Prose({ block }: { block: TextBlock }) {
  const parts = splitFences(block.markdown);
  return (
    <div className="flex flex-col gap-gap text-1 text-fg-1">
      {parts.map((p, i) =>
        p.type === 'code'
          ? <CodeBlock key={i} code={p.text} lang={p.lang} />
          : <p key={i} className="m-0 whitespace-pre-wrap break-words">
              {inline(p.text)}
              {block.streaming && i === parts.length - 1 && <span className="caret" />}
            </p>,
      )}
    </div>
  );
}

type Part = { type: 'text'; text: string } | { type: 'code'; text: string; lang?: string };

function splitFences(md: string): Part[] {
  const out: Part[] = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let last = 0;
  for (const m of md.matchAll(re)) {
    const idx = m.index ?? 0;
    const before = md.slice(last, idx).trim();
    if (before) out.push({ type: 'text', text: before });
    out.push({ type: 'code', lang: m[1] || undefined, text: (m[2] ?? '').replace(/\n$/, '') });
    last = idx + m[0].length;
  }
  const rest = md.slice(last).trim();
  if (rest) out.push({ type: 'text', text: rest });
  return out;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`)/g).map((seg, i) =>
    seg.startsWith('`') ? <code key={i}>{seg.slice(1, -1)}</code> : seg,
  );
}
