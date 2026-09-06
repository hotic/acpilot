import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HiddenMap } from '../src/shared/settings';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { SessionManager } from '../src/host/SessionManager';
import { TranscriptStore } from '../src/host/store/TranscriptStore';

const FAKE = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

function manager() {
  const dir = mkdtempSync(join(tmpdir(), 'acpilot-mgr-'));
  const toasts: string[] = [];
  const m = new SessionManager({
    registry: new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE] } }),
    store: new TranscriptStore(dir),
    log: () => {},
    cwd: () => '/tmp',
    defaultAgent: () => 'fake',
    runInTerminal: () => {},
    toast: (_l, t) => toasts.push(t),
  });
  return { m, dir, toasts };
}

describe('SessionManager', () => {
  it('delete is soft: leaves the list, switches the active session, file kept; restore brings it back; rename / pin land in the index', async () => {
    const { m, dir } = manager();
    await m.init();
    await m.newSession();
    const a = m.activeId!;
    await m.handle({ type: 'send', text: 'hi' });
    await m.newSession();
    const b = m.activeId!;
    expect(m.sessions().map(s => s.id)).toEqual([b, a]);

    await m.handle({ type: 'renameSession', id: a, title: '第一条' });
    await m.handle({ type: 'pinSession', id: a, pinned: true });
    expect(m.sessions()[0]).toMatchObject({ id: a, title: '第一条', pinned: true });

    // delete the current session b → active switches to a, b's file is still there (in the trash)
    await m.handle({ type: 'deleteSession', id: b });
    expect(m.sessions().map(s => s.id)).toEqual([a]);
    expect(m.activeId).toBe(a);
    expect(m.active()?.title).toBe('第一条');
    expect(existsSync(join(dir, `${b}.json`))).toBe(true);

    await m.handle({ type: 'restoreSession', id: b });
    expect(m.sessions().map(s => s.id).sort()).toEqual([a, b].sort());

    // delete a again, then reopen the manager: only b left in the index
    await m.handle({ type: 'deleteSession', id: a });
    expect(m.activeId).toBe(b);
    await m.dispose();
    expect(existsSync(join(dir, `${a}.json`))).toBe(false);
    const m2 = new SessionManager({
      registry: new AgentRegistry(), store: new TranscriptStore(dir), log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'fake', runInTerminal: () => {}, toast: () => {},
    });
    await m2.init();
    expect(m2.sessions().map(s => s.id)).toEqual([b]);
  }, 20_000);

  it('after probing binaries, agents() carries available: the fake agent is present, an uninstalled one is not', async () => {
    const { m } = manager();
    expect(m.agents().find(a => a.id === 'fake')?.available).toBeUndefined();
    await m.init();
    expect(m.agents().find(a => a.id === 'fake')?.available).toBe(true);
    const m2 = new SessionManager({
      registry: new AgentRegistry({ ghost: { name: 'Ghost', command: '/nonexistent/ghost-cli' } }), store: new TranscriptStore(mkdtempSync(join(tmpdir(), 'acpilot-mgr-'))),
      log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'ghost', runInTerminal: () => {}, toast: () => {},
    });
    await m2.init();
    expect(m2.agents().find(a => a.id === 'ghost')?.available).toBe(false);
  });

  it('hidden options: read from the host as a plain copy and re-pushed on emitHidden', () => {
    const hidden: HiddenMap = { devin: { model: ['GLM-5.2'] } };
    const events: HiddenMap[] = [];
    const m = new SessionManager({
      registry: new AgentRegistry(), store: new TranscriptStore(mkdtempSync(join(tmpdir(), 'acpilot-mgr-'))), log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'fake', runInTerminal: () => {}, toast: () => {},
      hidden: () => hidden,
    });
    m.subscribe(ev => { if (ev.type === 'hidden') events.push(ev.hidden); });
    expect(m.hidden()).toEqual(hidden);
    expect(m.hidden()).not.toBe(hidden);
    m.emitHidden();
    expect(events).toEqual([hidden]);
  });

  it('knownControls: the configOptions of the agent’s latest session, also after the process is gone; nothing for an agent never opened', async () => {
    const { m, dir } = manager();
    await m.init();
    expect(await m.knownControls('fake')).toEqual([]);
    await m.newSession();
    const live = await m.knownControls('fake');
    expect(live.map(c => c.id)).toEqual(['model', 'effort']);
    await m.dispose();
    const m2 = new SessionManager({
      registry: new AgentRegistry(), store: new TranscriptStore(dir), log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'fake', runInTerminal: () => {}, toast: () => {},
    });
    await m2.init();
    expect((await m2.knownControls('fake')).map(c => c.id)).toEqual(['model', 'effort']);
    expect(await m2.knownControls('ghost')).toEqual([]);
  }, 20_000);
});
