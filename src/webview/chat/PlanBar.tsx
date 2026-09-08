import type { PlanBlock, Turn } from '@shared/transcript';
import { PlanCard } from './Plan';

// The latest to-do list stays pinned above the composer until every entry is done
// and the turn ends. The transcript retains its independent disclosure.
export function PlanBar({ turns, running }: { turns: Turn[]; running: boolean }) {
  const plan = latestPlan(turns);
  if (!plan) return null;
  const done = plan.entries.filter(e => e.status === 'completed').length;
  if (!running && done === plan.entries.length) return null;
  return (
    <div className="px-page pt-gap">
      <PlanCard entries={plan.entries} live={running} />
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
