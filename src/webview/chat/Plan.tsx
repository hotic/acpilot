import { Check, ListTodo } from 'lucide-react';
import type { PlanBlock, PlanStatus } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { Disclosure } from '../ui/Disclosure';
import { Row } from '../ui/Row';
import { cn } from '../ui/cn';

// Plan: one row plus the expanded entries; entries are Rows too, with a status dot in the lead slot
export function Plan({ block }: { block: PlanBlock }) {
  const { toolLine } = useAppearance();
  const done = block.entries.filter(e => e.status === 'completed').length;
  const lead = toolLine === 'text' ? undefined : <ListTodo className="size-icon" strokeWidth={1.5} />;
  return (
    <Disclosure
      lead={lead}
      indent={false}
      body={
        <ol className="flex flex-col">
          {block.entries.map(e => (
            <Row key={e.title} as="div" dense lead={<PlanDot status={e.status} />}>
              <span className={cn(e.status === 'completed' ? 'text-fg-2' : 'text-fg-1', e.status === 'in_progress' && 'text-fg-strong')}>{e.title}</span>
            </Row>
          ))}
        </ol>
      }
    >
      <span>计划</span>
      <span className="text-fg-3 tabular-nums">{done} / {block.entries.length}</span>
    </Disclosure>
  );
}

function PlanDot({ status }: { status: PlanStatus }) {
  if (status === 'completed') return <span className="flex size-3 items-center justify-center rounded-full bg-fg-3 text-bg-0"><Check className="size-2" strokeWidth={3} /></span>;
  if (status === 'in_progress') return <span className="flex size-3 items-center justify-center rounded-full border-[1.5px] border-accent"><span className="size-1.5 rounded-full bg-accent" /></span>;
  return <span className="size-3 rounded-full border-[1.5px] border-fg-3" />;
}
