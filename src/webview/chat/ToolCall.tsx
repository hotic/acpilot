import { Check, X } from 'lucide-react';
import type { ToolCallBlock } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { Disclosure } from '../ui/Disclosure';
import { RowTarget } from '../ui/Row';
import { TOOL_ICON } from './icons';
import { CodeSurface, DiffBlock } from './CodeBlock';
import { TerminalBlock } from './Terminal';

// One tool call = one expandable row (command execution is the exception — a whole terminal block). Three modes: text only / with icon / icon + meta.
// No Orb while running: icon mode uses the same static icon as the completed state, with the verb shimmering
export function ToolCall({ block }: { block: ToolCallBlock }) {
  const { toolLine } = useAppearance();
  if (block.kind === 'execute') return <TerminalBlock block={block} />;
  const running = block.status === 'in_progress' || block.status === 'pending';
  const Icon = TOOL_ICON[block.kind];

  const lead = toolLine === 'text' ? undefined : <Icon className="size-icon" strokeWidth={1.5} />;

  const trailing = toolLine === 'rich'
    ? <>
        {block.diffStat
          ? <span><span className="text-ok">+{block.diffStat.add}</span> <span className="text-danger">−{block.diffStat.del}</span></span>
          : block.meta && <span>{block.meta}</span>}
        {block.status === 'completed' && <Check className="size-3 text-ok" strokeWidth={2} />}
        {block.status === 'failed' && <X className="size-3 text-danger" strokeWidth={2} />}
      </>
    : undefined;

  return (
    <Disclosure lead={lead} trailing={trailing} body={<ToolBody block={block} />}>
      <span className={running ? 'shimmer' : undefined}>{block.verb}</span>
      {block.target && <RowTarget mono={block.targetMono}>{block.target}</RowTarget>}
    </Disclosure>
  );
}

function ToolBody({ block }: { block: ToolCallBlock }) {
  const c = block.content;
  if (!c) return null;
  if (c.type === 'diff') return <DiffBlock lines={c.lines} />;
  if (c.type === 'list') return (
    <ul className="font-mono text-mono text-fg-2">
      {c.items.map(it => <li key={it}><span className="text-fg-3">› </span>{it}</li>)}
    </ul>
  );
  return <CodeSurface className="text-fg-2 whitespace-pre">{c.text}</CodeSurface>;
}
