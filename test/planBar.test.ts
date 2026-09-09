import { describe, expect, it } from 'vitest';
import type { PlanBlock, PlanEntry, Turn } from '../src/shared/transcript';
import { dockPlan } from '../src/webview/chat/dockPlan';

const entry = (title: string, status: PlanEntry['status']): PlanEntry => ({ title, status });
const plan = (...entries: PlanEntry[]): PlanBlock => ({ type: 'plan', entries });
const done = plan(entry('A', 'completed'), entry('B', 'completed'));
const open = plan(entry('A', 'completed'), entry('B', 'pending'));

describe('PlanBar dock visibility', () => {
  it('hides a finished list once its turn has ended', () => {
    const turns: Turn[] = [
      { role: 'user', text: 'do the work' },
      { role: 'agent', blocks: [done] },
    ];
    expect(dockPlan(turns, false)).toBeUndefined();
  });

  it('keeps a finished list pinned while that same turn is still running', () => {
    const turns: Turn[] = [
      { role: 'user', text: 'do the work' },
      { role: 'agent', blocks: [done] },
    ];
    expect(dockPlan(turns, true)).toBe(done);
  });

  it('does not resurrect a finished list when a later prompt starts running', () => {
    const turns: Turn[] = [
      { role: 'user', text: 'do the work' },
      { role: 'agent', blocks: [done] },
      { role: 'user', text: 'rewrite the commit message' },
      { role: 'agent', blocks: [] },
    ];
    expect(dockPlan(turns, true)).toBeUndefined();
    expect(dockPlan(turns, false)).toBeUndefined();
  });

  it('keeps an unfinished list in the dock across a new prompt', () => {
    const turns: Turn[] = [
      { role: 'user', text: 'do the work' },
      { role: 'agent', blocks: [open] },
      { role: 'user', text: 'keep going' },
      { role: 'agent', blocks: [] },
    ];
    expect(dockPlan(turns, true)).toBe(open);
    // Completing a later follow-up does not complete the preceding plan.
    expect(dockPlan(turns, false)).toBe(open);
    expect(dockPlan(turns.slice(0, 2), false)).toBe(open);
  });

  it('follows a new plan on the live turn instead of the finished predecessor', () => {
    const next = plan(entry('Rewrite the message', 'in_progress'));
    const turns: Turn[] = [
      { role: 'user', text: 'do the work' },
      { role: 'agent', blocks: [done] },
      { role: 'user', text: 'rewrite the commit message' },
      { role: 'agent', blocks: [next] },
    ];
    expect(dockPlan(turns, true)).toBe(next);
  });
});
