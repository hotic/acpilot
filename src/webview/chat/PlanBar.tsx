import type { Turn } from '@shared/transcript';
import { PlanCard } from './Plan';
import { dockPlan } from './dockPlan';

export function PlanBar({ turns, running }: { turns: Turn[]; running: boolean }) {
  const plan = dockPlan(turns, running);
  if (!plan) return null;
  return (
    <div className="px-page pt-gap">
      <PlanCard entries={plan.entries} live={running} />
    </div>
  );
}
