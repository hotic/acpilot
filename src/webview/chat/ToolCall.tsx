import { Check, ChevronRight, FileText, Globe, X } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ToolCallBlock } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { Disclosure } from '../ui/Disclosure';
import { Row, RowLabel, RowTarget } from '../ui/Row';
import { cn } from '../ui/cn';
import { IconButton } from '../ui/Button';
import { Collapse } from '../ui/Collapse';
import { t } from '../i18n';
import { TOOL_ICON } from './icons';
import { CodeSurface, DiffBlock } from './CodeBlock';
import { TerminalOutput } from './Terminal';
import { toolVerb } from './folding';
import { fileReference, isFileListing, isLineCount, toolFiles } from './toolDetails';
import { useToolSeconds } from './useToolSeconds';

export const OpenToolFileContext = createContext<((path: string, line?: number) => void) | undefined>(undefined);

// One tool call = one expandable row, command execution included (Codex-style: the command sits on the row, the output is a card below).
// Three modes: text only / with icon / icon + meta. No Orb while running: icon mode uses the same static icon as the completed state, with the verb shimmering.
// Bodies (diff / output / list) are not indented — they align with the row's left edge, like Codex
export function ToolCall({ block, grouped = false }: { block: ToolCallBlock; grouped?: boolean }) {
  const { toolLine } = useAppearance();
  const running = block.status === 'in_progress' || block.status === 'pending';
  const execute = block.kind === 'execute';
  const seconds = useToolSeconds(block);
  const files = toolFiles(block);
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

  const label = <>
    <RowLabel className={cn('tabular-nums', running && 'shimmer')}>
      {seconds !== undefined && block.status === 'in_progress' ? t('tool.runningSeconds', { s: seconds })
        : seconds !== undefined && seconds > 0 && block.status === 'completed' ? t('tool.completedSeconds', { s: seconds })
          : toolVerb(block)}
    </RowLabel>
    {block.target && !(block.kind === 'read' && files.length) && <RowTarget mono={block.targetMono}>{block.target}</RowTarget>}
  </>;
  // Search hits open on demand; read references remain visible inside the process.
  if (files.length && block.kind === 'search') return (
    <Disclosure lead={lead} trailing={trailing} indent={false}
      body={<ResultList items={files} kind={block.kind} detail={block} />}>
      {label}
    </Disclosure>
  );
  // A count-only read response has no content to inspect beyond its references.
  if (files.length) return (
    <div className="flex flex-col">
      <Row lead={lead} trailing={trailing}>{label}</Row>
      <ResultList items={files} kind={block.kind} detail={block} />
    </div>
  );
  // A history row without details has no second disclosure to open.
  if (grouped && !block.content) return <Row lead={lead} trailing={trailing}>{label}</Row>;

  // Opening a process fold reveals action rows; outputs only expand on an explicit click.
  return (
    <Disclosure lead={lead} trailing={trailing} indent={false} defaultOpen={!grouped && execute && running} body={<ToolBody block={block} />}>
      {label}
    </Disclosure>
  );
}

// Several ACP read calls form one visible list, retaining each call's full output.
export function ReadGroup({ blocks }: { blocks: ToolCallBlock[] }) {
  const { toolLine } = useAppearance();
  const first = blocks[0]!;
  return <div className="read-group flex flex-col">
    <Row lead={toolLine === 'text' ? undefined : <FileText className="size-icon" strokeWidth={1.5} />}>
      <RowLabel>{toolVerb(first)}</RowLabel>
    </Row>
    <div className={cn('flex flex-col', toolLine !== 'text' && 'timeline')}>
      {blocks.map(block => <ResultList key={block.id} items={toolFiles(block)} kind="read" rail={false} detail={block} />)}
    </div>
  </div>;
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
function ResultList({ items, kind, rail = true, detail }: { items: string[]; kind: ToolCallBlock['kind']; rail?: boolean; detail?: ToolCallBlock }) {
  const { toolLine } = useAppearance();
  const Icon = kind === 'fetch' ? Globe : FileText;
  return (
    <div className={cn('flex flex-col', rail && toolLine !== 'text' && 'timeline')}>
      {items.map((it, index) => {
        const { main, aside } = splitHit(it);
        const lead = toolLine === 'text' ? undefined : <Icon className="size-icon" strokeWidth={1.5} />;
        const target = <RowTarget mono={kind !== 'fetch'} className="text-fg-2">{main}</RowTarget>;
        if (kind === 'read' || kind === 'search') {
          // ACP output belongs to the call; expose it once on its first file row.
          const body = index === 0 && detail?.content && detail.content.type !== 'list' && !isLineCount(detail) && !isFileListing(detail)
            ? <ToolBody block={detail} /> : undefined;
          return <FileResultRow key={it} hit={it} lead={lead} aside={aside} body={body}>{target}</FileResultRow>;
        }
        return (
          <Row key={it} dense lead={lead} trailing={aside} title={it}>
            {target}
          </Row>
        );
      })}
    </div>
  );
}

// File navigation and output disclosure are separate buttons, including keyboard focus.
function FileResultRow({ hit, lead, aside, body, children }: { hit: string; lead: ReactNode; aside?: string; body?: ReactNode; children: ReactNode }) {
  const openFile = useContext(OpenToolFileContext);
  const [open, setOpen] = useState(false);
  const file = fileReference(hit);
  return <div className="flex min-w-0 flex-col">
    <Row dense lead={lead} title={hit} trailing={<>
      {aside}
      {body && <IconButton size="sm" title={t('tool.toggleOutput')} aria-label={t('tool.toggleOutput')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight className={cn('transition-transform', open && 'rotate-90')} strokeWidth={1.5} />
      </IconButton>}
    </>}>
      {openFile ? <button type="button" title={hit} className="flex min-w-0 max-w-full cursor-pointer text-left hover:underline focus-visible:underline"
        onClick={() => openFile(file.path, file.line)}>{children}</button> : children}
    </Row>
    {body && <Collapse open={open} className="disclosure-body"><div className="pt-1 pb-1.5">{body}</div></Collapse>}
  </div>;
}

function splitHit(hit: string): { main: string; aside?: string } {
  const line = /^(.+?):(\d+(?:[–-]\d+)?)(?::\d+)?$/.exec(hit);
  if (line) return { main: line[1]!.split(/[\\/]/).pop()!, aside: `:${line[2]}` };
  if (/^(?:\.{0,2}\/|[A-Za-z]:[\\/])/.test(hit)) return { main: hit.split(/[\\/]/).pop()! };
  try {
    const u = new URL(hit);
    return { main: u.pathname === '/' ? u.host : `${u.host}${u.pathname}`, aside: u.host };
  } catch { return { main: hit }; }
}
