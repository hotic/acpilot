import { Check, FileText, Globe, X } from 'lucide-react';
import type { ToolCallBlock } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { Disclosure } from '../ui/Disclosure';
import { Row, RowTarget } from '../ui/Row';
import { cn } from '../ui/cn';
import { TOOL_ICON } from './icons';
import { CodeSurface, DiffBlock } from './CodeBlock';
import { TerminalOutput } from './Terminal';

// One tool call = one expandable row, command execution included (Codex-style: the command sits on the row, the output is a card below).
// Three modes: text only / with icon / icon + meta. No Orb while running: icon mode uses the same static icon as the completed state, with the verb shimmering.
// Bodies (diff / output / list) are not indented — they align with the row's left edge, like Codex
export function ToolCall({ block }: { block: ToolCallBlock }) {
  const { toolLine } = useAppearance();
  const running = block.status === 'in_progress' || block.status === 'pending';
  const execute = block.kind === 'execute';
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

  // A running command opens by default so the output can be watched live
  return (
    <Disclosure lead={lead} trailing={trailing} indent={false} defaultOpen={execute && running} body={<ToolBody block={block} />}>
      <span className={running ? 'shimmer' : undefined}>{block.verb}</span>
      {block.target && <RowTarget mono={block.targetMono}>{block.target}</RowTarget>}
    </Disclosure>
  );
}

function ToolBody({ block }: { block: ToolCallBlock }) {
  const c = block.content;
  if (!c) return null;
  if (block.kind === 'execute') return <TerminalOutput block={block} />;
  if (c.type === 'diff') return <DiffBlock lines={c.lines} />;
  if (c.type === 'list') return <ResultList items={c.items} kind={block.kind} />;
  return <CodeSurface className="text-fg-2 whitespace-pre">{c.text}</CodeSurface>;
}

// Search / fetch hits as a list of dense rows (Kimi-style): lead icon in the same column as the tool rows with a dashed timeline rail
// threading through them, the hit itself on the left, and a faint right-aligned suffix — the line number for `path:line`, the host for URLs
function ResultList({ items, kind }: { items: string[]; kind: ToolCallBlock['kind'] }) {
  const { toolLine } = useAppearance();
  const Icon = kind === 'fetch' ? Globe : FileText;
  return (
    <div className={cn('flex flex-col', toolLine !== 'text' && 'timeline')}>
      {items.map(it => {
        const { main, aside } = splitHit(it);
        return (
          <Row key={it} dense lead={toolLine === 'text' ? undefined : <Icon className="size-icon" strokeWidth={1.5} />} trailing={aside}>
            <RowTarget mono={kind !== 'fetch'} className="text-fg-2">{main}</RowTarget>
          </Row>
        );
      })}
    </div>
  );
}

function splitHit(hit: string): { main: string; aside?: string } {
  const line = /^(.+?):(\d+)(?::\d+)?$/.exec(hit);
  if (line) return { main: line[1]!, aside: `:${line[2]}` };
  try {
    const u = new URL(hit);
    return { main: u.pathname === '/' ? u.host : `${u.host}${u.pathname}`, aside: u.host };
  } catch { return { main: hit }; }
}
