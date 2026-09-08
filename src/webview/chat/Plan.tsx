import { useState, type ReactNode } from 'react';
import { Check, ChevronRight, ChevronsDown, ChevronsUp, ListTodo } from 'lucide-react';
import type { PlanBlock, PlanEntry, PlanStatus } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { Card } from '../ui/Card';
import { Collapse } from '../ui/Collapse';
import { Row, RowLabel, RowTarget } from '../ui/Row';
import { cn } from '../ui/cn';

// Plan card, Cursor-style: a tonal card whose header row carries the entry being worked on plus done / total,
// with the full entry list collapsing underneath. Collapsed by default so a long plan doesn't flood the transcript.
// Shared by the transcript copy (Plan) and the live one pinned above the composer (PlanBar).
export function PlanCard({ entries, live }: { entries: PlanEntry[]; live?: boolean }) {
  const { toolLine } = useAppearance();
  const [open, setOpen] = useState(false);
  const done = entries.filter(e => e.status === 'completed').length;
  const current = entries.find(e => e.status === 'in_progress') ?? entries.find(e => e.status === 'pending');
  const lead = toolLine === 'text' ? undefined : <ListTodo className="size-icon" strokeWidth={1.5} />;
  return (
    <Card className={cn('group flex flex-col px-pad py-1', open && 'pb-2')} data-open={open || undefined}>
      <Row
        as="button" interactive aria-expanded={open} onClick={() => setOpen(o => !o)}
        lead={lead}
        trailing={<>
          <span>{done} / {entries.length}</span>
          <ChevronRight className="size-3 transition-transform group-data-[open]:rotate-90" strokeWidth={1.75} />
        </>}
      >
        <RowLabel className={cn(live && current && 'shimmer')}>{t('plan.title')}</RowLabel>
        {current && <RowTarget>{current.title}</RowTarget>}
      </Row>
      <Collapse open={open}>
        <div className="pt-1">
          <PlanEntries entries={entries} />
        </div>
      </Collapse>
    </Card>
  );
}

// The transcript copy of a plan: same card as the live PlanBar, kept in history after the turn ends.
// A little vertical air so the card doesn't cling to the tool rows around it.
export function Plan({ block }: { block: PlanBlock }) {
  return (
    <div className="py-1">
      <PlanCard entries={block.entries} />
    </div>
  );
}

// The entry list shared by the transcript block and the PlanBar: status dot in the lead slot, the title dimming once done, a faint priority glyph on the right for high / low
export function PlanEntries({ entries }: { entries: PlanEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((e, i) => (
        <Row key={`${i}:${e.title}`} as="div" dense lead={<PlanDot status={e.status} />} trailing={priorityGlyph(e.priority)}>
          <span className={cn(e.status === 'completed' ? 'text-fg-2' : 'text-fg-1', e.status === 'in_progress' && 'text-fg-strong')}>{e.title}</span>
        </Row>
      ))}
    </ol>
  );
}

// Medium is the default and gets no mark
function priorityGlyph(priority: PlanEntry['priority']): ReactNode | undefined {
  if (priority === 'high') return <ChevronsUp className="size-3" strokeWidth={1.75} aria-label={t('plan.priority.high')} />;
  if (priority === 'low') return <ChevronsDown className="size-3" strokeWidth={1.75} aria-label={t('plan.priority.low')} />;
  return undefined;
}

export function PlanDot({ status }: { status: PlanStatus }) {
  if (status === 'completed') return <span className="flex size-3 items-center justify-center rounded-full bg-fg-3 text-bg-0"><Check className="size-2" strokeWidth={3} /></span>;
  if (status === 'in_progress') return <span className="flex size-3 items-center justify-center rounded-full border-[1.5px] border-accent"><span className="size-1.5 rounded-full bg-accent" /></span>;
  return <span className="size-3 rounded-full border-[1.5px] border-fg-3" />;
}
