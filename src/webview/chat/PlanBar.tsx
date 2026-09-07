import { useState } from 'react';
import { ChevronRight, ListTodo } from 'lucide-react';
import type { PlanBlock, Turn } from '@shared/transcript';
import { Card } from '../ui/Card';
import { Row, RowLabel, RowTarget } from '../ui/Row';
import { Collapse } from '../ui/Collapse';
import { cn } from '../ui/cn';
import { t } from '../i18n';
import { PlanEntries } from './Plan';

// The live to-do list, pinned above the composer the way Codex / Cursor do it: the latest plan of the session, one row showing the entry being worked on
// plus done / total, expanding to the whole list. Collapsed by default so a narrow sidebar keeps its room; the open state is the component's own and resets with the session.
// It goes away once every entry is done and the turn has ended — the transcript keeps its own copy of the plan for history
export function PlanBar({ turns, running }: { turns: Turn[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const plan = latestPlan(turns);
  if (!plan) return null;
  const done = plan.entries.filter(e => e.status === 'completed').length;
  const total = plan.entries.length;
  if (!running && done === total) return null;
  const current = plan.entries.find(e => e.status === 'in_progress') ?? plan.entries.find(e => e.status === 'pending');
  return (
    <div className="px-page pt-2">
      <Card className={cn('group flex flex-col px-pad py-1', open && 'pb-2')} data-open={open || undefined}>
        <Row
          as="button" interactive aria-expanded={open} onClick={() => setOpen(o => !o)}
          lead={<ListTodo className="size-icon" strokeWidth={1.5} />}
          trailing={<>
            <span>{done} / {total}</span>
            <ChevronRight className="size-3 transition-transform group-data-[open]:rotate-90" strokeWidth={1.75} />
          </>}
        >
          <RowLabel className={cn(running && current && 'shimmer')}>{t('plan.title')}</RowLabel>
          {current && <RowTarget>{current.title}</RowTarget>}
        </Row>
        <Collapse open={open}>
          <div className="pt-1">
            <PlanEntries entries={plan.entries} />
          </div>
        </Collapse>
      </Card>
    </div>
  );
}

// The most recent plan the agent reported: every plan update replaces the whole list, so only the last block matters
export function latestPlan(turns: Turn[]): PlanBlock | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.role !== 'agent') continue;
    for (let j = turn.blocks.length - 1; j >= 0; j--) {
      const b = turn.blocks[j];
      if (b?.type === 'plan') return b;
    }
  }
  return undefined;
}
