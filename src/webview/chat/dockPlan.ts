import type { PlanBlock, Turn } from '@shared/transcript';

// Open entries stay in the dock across turns. A finished list stays only while
// its own turn is still running, so a later prompt does not resurrect it.
export function dockPlan(turns: Turn[], running: boolean): PlanBlock | undefined {
  const found = latestPlan(turns);
  if (!found) return undefined;
  if (found.plan.entries.some(entry => entry.status !== 'completed')) return found.plan;
  if (running && found.index === turns.length - 1) return found.plan;
  return undefined;
}

// The most recent plan the agent reported: every plan update replaces the whole list, so only the last block matters
export function latestPlan(turns: Turn[]): { plan: PlanBlock; index: number } | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn?.role !== 'agent') continue;
    for (let j = turn.blocks.length - 1; j >= 0; j--) {
      const b = turn.blocks[j];
      if (b?.type === 'plan') return { plan: b, index: i };
    }
  }
  return undefined;
}
