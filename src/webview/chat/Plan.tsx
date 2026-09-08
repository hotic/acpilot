import { useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronsDown, ChevronsUp, ListTodo } from 'lucide-react';
import type { PlanBlock, PlanEntry, PlanStatus } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { Card } from '../ui/Card';
import { Collapse } from '../ui/Collapse';
import { Disclosure } from '../ui/Disclosure';
import { Row, RowLabel } from '../ui/Row';
import { cn } from '../ui/cn';
import { useScrollFade } from '../ui/useScrollFade';

// Keep the current entry mounted while the surrounding rows expand. Sharing
// the same row avoids a disappearing summary and a shrinking first frame.
export function PlanCard({ entries, live }: { entries: PlanEntry[]; live?: boolean }) {
  const { toolLine } = useAppearance();
  const [open, setOpen] = useState(false);
  const fade = useScrollFade<HTMLDivElement>();
  const done = entries.filter(e => e.status === 'completed').length;
  const current = entries.find(e => e.status === 'in_progress') ?? entries.find(e => e.status === 'pending');
  const lead = toolLine === 'text' ? undefined : <ListTodo className="size-icon" strokeWidth={1.5} />;
  return (
    <Card className="plan-card flex min-w-0 flex-col px-pad" data-open={open || undefined}>
      <Row
        as="button" interactive dense aria-expanded={open} onClick={() => setOpen(o => !o)}
        lead={lead}
        trailing={<>
          <span>{done}/{entries.length}</span>
          <PlanCaret open={open} />
        </>}
      >
        <RowLabel className={cn(live && current && 'shimmer')}>{t('plan.todoTitle')}</RowLabel>
      </Row>
      <div ref={fade} className="plan-entry-viewport scroll-thin scroll-fade">
        <Collapse open={!open && !current}>
          <Row className="plan-entry-row" dense lead={toolLine === 'text' ? undefined : <PlanDot status="completed" />}>
            <span className="text-fg-2">{t('plan.completed', { n: entries.length })}</span>
          </Row>
        </Collapse>
        <PlanEntries entries={entries} expanded={open} current={current} showStatus={toolLine !== 'text'} />
      </div>
    </Card>
  );
}

// Historical plans are a single disclosure row. Expanded entries keep their
// natural height and participate in the conversation's normal scroll flow.
export function Plan({ block }: { block: PlanBlock }) {
  const { toolLine } = useAppearance();
  const [open, setOpen] = useState(false);
  const done = block.entries.filter(entry => entry.status === 'completed').length;
  return (
    <Disclosure
      open={open} onToggle={setOpen}
      lead={toolLine === 'text' ? undefined : <ListTodo className="size-icon" strokeWidth={1.5} />}
      body={<PlanEntries entries={block.entries} />}
    >
      <RowLabel>{t('plan.title')}</RowLabel>
      <span className="text-3 text-fg-3 tabular-nums">{done}/{block.entries.length}</span>
      <PlanCaret open={open} />
    </Disclosure>
  );
}

function PlanCaret({ open }: { open: boolean }) {
  return <ChevronDown className={cn('size-icon shrink-0 self-center transition-transform', open && 'rotate-180')} strokeWidth={1.5} />;
}

// The entry list shared by the transcript block and the PlanBar: status dot in the lead slot, the title dimming once done, a faint priority glyph on the right for high / low
export function PlanEntries({ entries, expanded, current, showStatus = true }: {
  entries: PlanEntry[];
  expanded?: boolean;
  current?: PlanEntry;
  showStatus?: boolean;
}) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => {
        const key = `${index}:${entry.title}`;
        const row = <PlanEntryRow key={key} entry={entry} showStatus={showStatus} />;
        // History keeps its natural layout. Only the live dock folds individual rows.
        return expanded === undefined ? row : (
          <Collapse key={key} open={expanded || entry === current}>{row}</Collapse>
        );
      })}
    </ol>
  );
}

function PlanEntryRow({ entry, showStatus }: { entry: PlanEntry; showStatus: boolean }) {
  return (
    <Row className="plan-entry-row" dense lead={showStatus ? <PlanDot status={entry.status} /> : undefined} trailing={priorityGlyph(entry.priority)}>
      <span className={cn('min-w-0 break-words', entry.status === 'completed' ? 'text-fg-2' : 'text-fg-1', entry.status === 'in_progress' && 'text-fg-strong')}>
        {entry.title}
      </span>
    </Row>
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
