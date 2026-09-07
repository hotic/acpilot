import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AcpSession } from '../src/host/acp/AcpSession';

const FAKE = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

function fixture(agent: string, auto = false) {
  const logs: string[] = [];
  const session = AcpSession.fresh(agent, '/tmp', {
    registry: new AgentRegistry({ [agent]: { command: TSX, args: [FAKE], env: { FAKE_COMPACTION: agent } } }),
    log: line => logs.push(line), onChange: () => {},
    blobs: { saveBlob: async () => { throw new Error('No attachments'); }, readBlob: async () => { throw new Error('No attachments'); } },
    compaction: () => ({ auto, atTokens: 300_000 }),
  });
  return { session, logs };
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the fake ACP peer');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('background compaction queue', () => {
  it.each(['devin', 'kimi', 'structured'])('%s: holds a follow-up after the compact RPC returns until compaction completes', async agent => {
    const { session: s, logs } = fixture(agent);
    try {
      await s.start();
      await s.prompt('hi');
      logs.length = 0;
      const compact = s.compact();
      await until(() => logs.some(l => l.includes('prompt done:')));
      expect(s.isRunning).toBe(true);
      await s.prompt('follow-up');
      expect(s.view().queued?.map(q => q.text)).toEqual(['follow-up']);
      expect(s.view().turns).toHaveLength(4);
      await s.setConfig('effort', 'low');
      expect(s.isRunning).toBe(true);
      await s.setConfig('effort', 'high');
      await compact;
      await until(() => !s.isRunning);
      expect(s.view().queued).toBeUndefined();
      expect(s.view().turns).toHaveLength(6);
      expect(s.view().turns[4]).toMatchObject({ role: 'user', text: 'follow-up' });
      expect(s.view().turns[5]).toMatchObject({ role: 'agent', stop: 'end_turn', blocks: expect.arrayContaining([expect.objectContaining({ type: 'text', markdown: 'hello world' })]) });
      expect(logs.some(l => /\] cancel$/.test(l))).toBe(false);
    } finally { s.dispose(); }
  });

  it.each(['devin', 'kimi'])('%s: auto-compaction keeps the queue and records usage after completion', async agent => {
    const { session: s, logs } = fixture(agent, true);
    try {
      await s.start();
      await s.prompt('big');
      await until(() => logs.filter(l => l.includes('prompt done:')).length === 2);
      expect(s.isRunning).toBe(true);
      expect(s.view().turns[2]).toEqual({ role: 'user', text: '/compact', auto: true });
      await s.prompt('follow-up');
      await s.setConfig('effort', 'high');
      await until(() => !s.isRunning);
      expect(s.view().turns).toHaveLength(6);
      expect(s.view().usage?.used).toBeLessThan(300_000);
    } finally { s.dispose(); }
  });

  it('dispose releases a background wait without dispatching the queued prompt', async () => {
    const { session: s, logs } = fixture('devin');
    try {
      await s.start();
      await s.prompt('hi');
      logs.length = 0;
      const compact = s.compact();
      await until(() => logs.some(l => l.includes('prompt done:')));
      await s.prompt('follow-up');
      s.dispose();
      await compact;
      expect(s.view().status).toBe('closed');
      expect(s.view().turns).toHaveLength(4);
    } finally { s.dispose(); }
  });
});
