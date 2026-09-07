import type { ReactNode } from 'react';
import { Check, ChevronsDown, ChevronsUp, ListTodo } from 'lucide-react';
import type { PlanBlock, PlanEntry, PlanStatus } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { Disclosure } from '../ui/Disclosure';
import { Row } from '../ui/Row';
import { cn } from '../ui/cn';

// Plan: one row plus the expanded entries; entries are Rows too, with a status dot in the lead slot.
// This is the copy that stays in the transcript; the live one is the PlanBar above the composer
export function Plan({ block }: { block: PlanBlock }) {
  const { toolLine } = useAppearance();
  const done = block.entries.filter(e => e.status === 'completed').length;
  const lead = toolLine === 'text' ? undefined : <ListTodo className="size-icon" strokeWidth={1.5} />;
  return (
    <Disclosure lead={lead} indent={false} body={<PlanEntries entries={block.entries} />}>
      <span>{t('plan.title')}</span>
      <span className="text-fg-3 tabular-nums">{done} / {block.entries.length}</span>
    </Disclosure>
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
