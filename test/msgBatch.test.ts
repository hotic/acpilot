import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostMsg } from '../src/shared/protocol';
import type { SessionView } from '../src/shared/transcript';
import { freezeHostMsg, HostMsgBatch } from '../src/host/msgBatch';

function session(running: boolean, rev: number, text = 'hi'): Extract<HostMsg, { type: 'session' }> {
  const view: SessionView = {
    id: 's', agent: 'kimi', title: 't', cwd: '/w', status: 'ready', running, rev,
    createdAt: 'a', updatedAt: 'b', commands: [], controls: { modes: [], options: [] },
    turns: [
      { role: 'user', id: 'u1', text: 'hi' },
      { role: 'agent', blocks: [{ type: 'text', markdown: text }] },
    ],
  };
  return { type: 'session', session: view };
}

afterEach(() => { vi.useRealTimers(); });

describe('HostMsgBatch', () => {
  it('keeps only the latest session view inside the window', () => {
    vi.useFakeTimers();
    const posted: HostMsg[] = [];
    const batch = new HostMsgBatch(m => posted.push(m), 30);
    batch.push(session(true, 1, 'a'));
    batch.push(session(true, 2, 'ab'));
    expect(posted).toEqual([]);
    vi.advanceTimersByTime(30);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'session', session: { rev: 2, running: true } });
    batch.dispose();
  });

  it('flushes an idle session immediately and drops a coalesced running view', () => {
    vi.useFakeTimers();
    const posted: HostMsg[] = [];
    const batch = new HostMsgBatch(m => posted.push(m), 30);
    batch.push(session(true, 3));
    batch.push(session(false, 4));
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'session', session: { rev: 4, running: false } });
    vi.advanceTimersByTime(30);
    expect(posted).toHaveLength(1);
    batch.dispose();
  });

  it('flushes a pending sessions list together with the idle edge', () => {
    vi.useFakeTimers();
    const posted: HostMsg[] = [];
    const batch = new HostMsgBatch(m => posted.push(m), 30);
    batch.push({ type: 'sessions', sessions: [] });
    batch.push(session(false, 2));
    expect(posted.map(m => m.type)).toEqual(['sessions', 'session']);
    batch.dispose();
  });
});

describe('freezeHostMsg', () => {
  it('clones session turns so later endTurn mutations stay off the posted snapshot', () => {
    const msg = session(true, 3, 'stream');
    const frozen = freezeHostMsg(msg);
    if (frozen.type !== 'session') throw new Error('expected session');
    const live = msg.session.turns[1];
    if (live?.role !== 'agent') throw new Error('expected agent turn');
    live.stop = 'end_turn';
    live.blocks[0] = { type: 'text', markdown: 'done' };
    msg.session.running = false;
    expect(frozen.session).toMatchObject({ running: true, rev: 3 });
    const posted = frozen.session.turns[1];
    expect(posted).toMatchObject({ role: 'agent', blocks: [{ type: 'text', markdown: 'stream' }] });
    expect(posted && posted.role === 'agent' ? posted.stop : 'missing').toBeUndefined();
  });
});
