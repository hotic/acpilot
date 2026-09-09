import { describe, expect, it } from 'vitest';
import { compactBudget, conversationTokens, estimateUsage, estTokens, liveUsage, overCompactBudget, usageWindow } from '../src/webview/chat/usageBreakdown';
import type { Turn, Usage } from '../src/shared/transcript';

// 100 latin chars ≈ 25 tokens
const latin = (n: number) => 'a'.repeat(n);

describe('estTokens', () => {
  it('empty string is 0', () => {
    expect(estTokens('')).toBe(0);
  });

  it('roughly 4 latin chars per token', () => {
    expect(estTokens(latin(100))).toBe(25);
  });

  it('CJK chars are denser', () => {
    expect(estTokens('你好世界')).toBe(Math.ceil(4 * 0.7));
  });
});

describe('usageWindow', () => {
  it('caps the agent-reported window at the compact threshold', () => {
    expect(usageWindow(1_000_000, 300_000)).toBe(300_000);
  });

  it('keeps a smaller model window', () => {
    expect(usageWindow(200_000, 300_000)).toBe(200_000);
  });

  it('ignores a missing or non-positive threshold', () => {
    expect(usageWindow(1_000_000)).toBe(1_000_000);
    expect(usageWindow(1_000_000, 0)).toBe(1_000_000);
    expect(usageWindow(1_000_000, -1)).toBe(1_000_000);
  });
});

describe('compactBudget', () => {
  it('only marks a budget strictly inside the agent window', () => {
    expect(compactBudget(1_000_000, 300_000)).toBe(300_000);
    expect(compactBudget(200_000, 300_000)).toBeUndefined();
    expect(compactBudget(300_000, 300_000)).toBeUndefined();
    expect(compactBudget(1_000_000)).toBeUndefined();
  });

  it('treats usage at or above the threshold as over budget', () => {
    expect(overCompactBudget(345_000, 300_000)).toBe(true);
    expect(overCompactBudget(300_000, 300_000)).toBe(true);
    expect(overCompactBudget(299_999, 300_000)).toBe(false);
    expect(overCompactBudget(345_000)).toBe(false);
  });
});

describe('estimateUsage', () => {
  const usage: Usage = { used: 1000, size: 10000 };
  const turns: Turn[] = [
    { role: 'user', text: latin(400) }, // ≈100
    {
      role: 'agent',
      blocks: [
        { type: 'thought', text: latin(200) }, // ≈50
        { type: 'text', markdown: latin(400) }, // ≈100
        { type: 'plan', entries: [{ title: latin(40), status: 'completed' }] }, // ≈10 → agent
        {
          type: 'tool_call', id: 't1', kind: 'read', verb: '读取', target: latin(60), status: 'completed',
          content: { type: 'text', text: latin(400) }, // ≈100
        },
      ],
    },
  ];

  it('segments grouped by block type, system segment as the remainder', () => {
    const segs = estimateUsage(turns, usage);
    const byId = new Map<string, number>(segs.map(s => [s.id, s.tokens]));
    const tok = (id: string) => byId.get(id) ?? 0;
    expect(tok('user')).toBe(100);
    expect(tok('thought')).toBe(50);
    // agent = text 100 + plan 10
    expect(tok('agent')).toBe(110);
    // tool = verb/target line + output
    expect(tok('tool')).toBeGreaterThan(100);
    expect(tok('system')).toBe(usage.used - (tok('user') + tok('agent') + tok('tool') + tok('thought')));
    expect(tok('system')).toBeGreaterThan(0);
  });

  it('when the conversation estimate exceeds the total (after compaction), shrink proportionally and zero the system segment', () => {
    const segs = estimateUsage(turns, { used: 100, size: 10000 });
    const system = segs.find(s => s.id === 'system')!;
    expect(system.tokens).toBe(0);
    const total = segs.reduce((n, s) => n + s.tokens, 0);
    // each segment rounds separately; allow 1~2 tokens of rounding error
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(2);
  });

  it('empty conversation: everything goes to the system segment', () => {
    const segs = estimateUsage([], usage);
    expect(segs.find(s => s.id === 'system')!.tokens).toBe(usage.used);
    expect(segs.filter(s => s.id !== 'system').every(s => s.tokens === 0)).toBe(true);
  });
});

describe('liveUsage', () => {
  const usage: Usage = { used: 100, size: 10_000 };
  const turns: Turn[] = [
    { role: 'user', text: latin(400) },
    { role: 'agent', blocks: [{ type: 'text', markdown: latin(400) }] },
  ];

  it('keeps the agent total when idle even if the transcript estimate is larger', () => {
    expect(conversationTokens(turns)).toBeGreaterThan(usage.used);
    expect(liveUsage(usage, turns)).toBe(usage);
    expect(liveUsage(usage, turns, false)).toBe(usage);
  });

  it('raises used to the transcript estimate while a turn is running', () => {
    const local = conversationTokens(turns);
    expect(liveUsage(usage, turns, true)).toEqual({ used: local, size: 10_000 });
  });

  it('does not drop below the agent snapshot', () => {
    expect(liveUsage({ used: 50_000, size: 10_000 }, turns, true)).toEqual({ used: 50_000, size: 10_000 });
  });
});
