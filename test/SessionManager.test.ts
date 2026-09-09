import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { HiddenMap } from '../src/shared/settings';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { SessionManager } from '../src/host/SessionManager';
import { TranscriptStore } from '../src/host/store/TranscriptStore';
import { LocalAccounts } from '../src/host/accounts/local';

const FAKE = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

function manager() {
  const dir = mkdtempSync(join(tmpdir(), 'acpira-mgr-'));
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
  it('publishes local quota updates and refreshes after a turn without binding an imported account', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acpira-local-manager-'));
    const local = new LocalAccounts({ home: dir, env: () => ({ KIMI_CODE_API_KEY: 'test-code-key' }),
      fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ usage: { limit: 100, used: 25 } }))),
    });
    const refresh = vi.spyOn(local, 'refresh');
    const m = new SessionManager({
      registry: new AgentRegistry({ kimi: { name: 'Kimi Code', command: TSX, args: [FAKE] } }),
      store: new TranscriptStore(dir), localAccounts: local,
      log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'kimi', runInTerminal: () => {}, toast: () => {},
    });
    const updates: unknown[] = [];
    m.subscribe(ev => { if (ev.type === 'agents') updates.push(ev.agents); });
    try {
      await m.init();
      await m.handle({ type: 'refreshQuota', agent: 'kimi' });
      expect(m.agents().find(a => a.id === 'kimi')).toMatchObject({ localAccount: { status: 'ready', quota: { windows: [{ remaining: 0.75 }] } } });
      expect(updates.length).toBeGreaterThan(0);
      expect(m.accounts()).toEqual([]);
      await m.newSession();
      expect(m.active()?.accountId).toBeUndefined();
      refresh.mockClear();
      await m.handle({ type: 'send', text: 'hi' });
      expect(refresh).toHaveBeenCalledWith('kimi', true);
    } finally {
      await m.dispose();
      rmSync(dir, { recursive: true, force: true });
    }
  });

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

    // delete the current session b → active switches to a, b's file moved to the trash (out of the live directory, so no other window lists it)
    await m.handle({ type: 'deleteSession', id: b });
    expect(m.sessions().map(s => s.id)).toEqual([a]);
    expect(m.activeId).toBe(a);
    expect(m.active()?.title).toBe('第一条');
    expect(existsSync(join(dir, `${b}.json`))).toBe(false);
    expect(existsSync(join(dir, 'trash', `${b}.json`))).toBe(true);

    await m.handle({ type: 'restoreSession', id: b });
    expect(m.sessions().map(s => s.id).sort()).toEqual([a, b].sort());
    expect(existsSync(join(dir, `${b}.json`))).toBe(true);

    // delete a again, then reopen the manager: only b left in the index
    await m.handle({ type: 'deleteSession', id: a });
    expect(m.activeId).toBe(b);
    await m.dispose();
    expect(existsSync(join(dir, `${a}.json`))).toBe(false);
    expect(existsSync(join(dir, 'trash', `${a}.json`))).toBe(false);
    const m2 = new SessionManager({
      registry: new AgentRegistry(), store: new TranscriptStore(dir), log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'fake', runInTerminal: () => {}, toast: () => {},
    });
    await m2.init();
    expect(m2.sessions().map(s => s.id)).toEqual([b]);
  }, 20_000);

  // Several webviews (sidebar + editor tabs) each hold their own active session over the shared list; only the viewers showing a session get its updates
  it('viewers: independent active sessions, session events only to the viewers showing it, deletion / empty-drop respect the other viewers', async () => {
    const { m } = manager();
    await m.init();
    const a = m.attach();
    const b = m.attach();
    const seenA: string[] = [];
    const seenB: string[] = [];
    a.subscribe(ev => { if (ev.type === 'session') seenA.push(ev.session.id); });
    b.subscribe(ev => { if (ev.type === 'session') seenB.push(ev.session.id); });

    // a fresh viewer opens a fresh session; a second fresh viewer gets its own, not a's
    await a.ensureActive();
    await b.ensureActive();
    const sa = a.activeId!;
    const sb = b.activeId!;
    expect(sa).not.toBe(sb);
    expect(m.sessions().map(s => s.id).sort()).toEqual([sa, sb].sort());
    // both viewers can look at the same session; b moving on to a new one leaves a where it was
    await a.handle({ type: 'send', text: 'hi' });
    await b.selectSession(sa);
    expect(b.active()?.turns.length).toBe(2);
    await b.newSession();
    expect(m.sessions().map(s => s.id)).toContain(sa);
    expect(a.activeId).toBe(sa);
    expect(b.activeId).not.toBe(sa);

    // updates route by active session: a's turn reached a and (while b showed sa) b, but b's fresh session never reached a
    seenA.length = 0; seenB.length = 0;
    await a.handle({ type: 'send', text: 'again' });
    expect(seenA).toContain(sa);
    expect(seenB).not.toContain(sa);

    // deleting a's session moves only a; b stays where it was
    const sb2 = b.activeId!;
    await b.handle({ type: 'deleteSession', id: sa });
    expect(b.activeId).toBe(sb2);
    expect(a.activeId).toBeDefined();
    expect(a.activeId).not.toBe(sa);

    // a disposed viewer no longer hears anything
    seenB.length = 0;
    b.dispose();
    await a.handle({ type: 'send', text: 'quiet' });
    expect(seenB).toEqual([]);
    await m.dispose();
  }, 30_000);

  it('after probing binaries, agents() carries available: the fake agent is present, an uninstalled one is not', async () => {
    const { m } = manager();
    expect(m.agents().find(a => a.id === 'fake')?.available).toBeUndefined();
    await m.init();
    expect(m.agents().find(a => a.id === 'fake')?.available).toBe(true);
    await m.dispose();
    const m2 = new SessionManager({
      registry: new AgentRegistry({ ghost: { name: 'Ghost', command: '/nonexistent/ghost-cli' } }), store: new TranscriptStore(mkdtempSync(join(tmpdir(), 'acpira-mgr-'))),
      log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'ghost', runInTerminal: () => {}, toast: () => {},
    });
    await m2.init();
    expect(m2.agents().find(a => a.id === 'ghost')?.available).toBe(false);
    await m2.dispose();
  });

  // A CLI installed while the window is open: the registry's notification re-pushes agents to every viewer, and the poll keeps looking while
  // something is missing (fake timers drive it); the install action runs the vendor line through the shell in a host terminal
  it('a CLI appearing after init reaches the viewers as an agents event, via the poll or a direct lookup; installAgent runs the vendor line in a terminal', async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'acpira-mgr-'));
    const bin = join(dir, 'ghost-cli');
    const terminal: { command: string; args: string[] }[] = [];
    const m = new SessionManager({
      // `never` stays missing so the poll keeps its timer armed regardless of which built-in CLIs this machine has
      registry: new AgentRegistry({ ghost: { name: 'Ghost', command: bin, install: { command: 'curl -fsSL https://example.com/i.sh | bash' } }, never: { name: 'Never', command: '/nonexistent/never-cli' } }),
      store: new TranscriptStore(mkdtempSync(join(tmpdir(), 'acpira-mgr-'))),
      log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'ghost', runInTerminal: (_t, command, args) => terminal.push({ command, args }), toast: () => {},
    });
    try {
      await m.init();
      const v = m.attach();
      const seen: (boolean | undefined)[] = [];
      v.subscribe(ev => { if (ev.type === 'agents') seen.push(ev.agents.find(a => a.id === 'ghost')?.available); });
      expect(m.agents().find(a => a.id === 'ghost')).toMatchObject({ available: false, install: { command: 'curl -fsSL https://example.com/i.sh | bash' } });

      // The settings page's rescan path: a direct lookup finds the new binary and the list is pushed at once
      writeFileSync(bin, '#!/bin/sh\nexit 0\n'); chmodSync(bin, 0o755);
      expect(await m.registry.resolveBinary('ghost')).toBe(bin);
      expect(seen).toEqual([true]);

      // Removed again: the next poll tick notices (the tick starts real fs lookups, so waitFor lets them land)
      rmSync(bin);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => expect(seen).toEqual([true, false]));
      // …and the poll keeps running while it is missing, so a reinstall shows up on its own
      writeFileSync(bin, '#!/bin/sh\nexit 0\n'); chmodSync(bin, 0o755);
      await vi.advanceTimersByTimeAsync(10_000);
      await vi.waitFor(() => expect(seen).toEqual([true, false, true]));

      await v.handle({ type: 'installAgent', agent: 'ghost' });
      expect(terminal).toEqual([{ command: process.platform === 'win32' ? 'powershell' : 'bash', args: [process.platform === 'win32' ? '-Command' : '-c', 'curl -fsSL https://example.com/i.sh | bash'] }]);
    } finally {
      await m.dispose();
      vi.useRealTimers();
    }
  });

  it('hidden options: read from the host as a plain copy and re-pushed on emitHidden', () => {
    const hidden: HiddenMap = { devin: { model: ['GLM-5.2'] } };
    const events: HiddenMap[] = [];
    const m = new SessionManager({
      registry: new AgentRegistry(), store: new TranscriptStore(mkdtempSync(join(tmpdir(), 'acpira-mgr-'))), log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'fake', runInTerminal: () => {}, toast: () => {},
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

  // The fake agent's process starts every session on model m1 / effort high / mode agent; what the user picked last must come back on the next new session
  it('last chosen mode / config values are remembered per agent, replayed onto new sessions (also after a reload), and values the agent no longer offers are skipped', async () => {
    const { m, dir } = manager();
    await m.init();
    await m.newSession();
    const controls = () => m.active()!.controls;
    expect(controls().options.map(c => c.value)).toEqual(['m1', 'high']);
    await m.handle({ type: 'setConfig', configId: 'model', value: 'm2' });
    await m.handle({ type: 'setConfig', configId: 'effort', value: 'low' });
    await m.handle({ type: 'setMode', id: 'plan' });
    expect(m.lastSettings('fake')).toEqual({ modeId: 'plan', config: { model: 'm2', effort: 'low' } });
    // a mode the agent switches by itself (Devin's "switch to bypass mode" permission answer arrives as current_mode_update) counts as the choice in effect
    await m.handle({ type: 'send', text: 'mode:agent' });
    expect(m.lastSettings('fake')).toEqual({ modeId: 'agent', config: { model: 'm2', effort: 'low' } });
    await m.handle({ type: 'setMode', id: 'plan' });
    // (a session must have said something, or the next newSession replaces it instead of adding one — done above)
    await m.newSession();
    expect(controls().options.map(c => c.value)).toEqual(['m2', 'low']);
    expect(controls().modeId).toBe('plan');
    // the choices themselves are what a turn records, so the new session's first turn carries them
    await m.handle({ type: 'send', text: 'inspect-history' });
    const reply = m.active()!.turns.at(-1)!;
    expect(reply.role === 'agent' && reply.blocks.some(b => b.type === 'text' && b.markdown.includes('"model":"m2"') && b.markdown.includes('"mode":"plan"'))).toBe(true);
    await m.dispose();

    // reload: the memory is on disk; a stale value (no longer in the agent's list) is passed over while the others still apply
    const store = new TranscriptStore(dir);
    const prefs = await store.loadPrefs();
    prefs.lastSettings.fake = { modeId: 'plan', config: { model: 'gone', effort: 'low' } };
    await store.savePrefs(prefs);
    const m2 = new SessionManager({
      registry: new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE] } }), store, log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'fake', runInTerminal: () => {}, toast: () => {},
    });
    await m2.init();
    await m2.newSession();
    expect(m2.active()!.controls.options.map(c => c.value)).toEqual(['m1', 'low']);
    expect(m2.active()!.controls.modeId).toBe('plan');
    await m2.dispose();
  }, 30_000);

  it('newSession on an empty starting/ready session keeps the process instead of respawning', async () => {
    const { m } = manager();
    await m.init();
    await m.newSession();
    const a = m.activeId!;
    await m.newSession();
    expect(m.activeId).toBe(a);
    expect(m.sessions().map(s => s.id)).toEqual([a]);
    await m.dispose();
  }, 20_000);

  // Two extension hosts (two windows, or VS Code + Cursor) share ~/.acpira/sessions. Each used to rewrite index.json from its own memory,
  // so whichever streamed last erased the other's new sessions from the list while their records stayed on disk
  it('two managers over one directory: sessions created in one show up in the other on refresh, neither erases the other’s, deletion is honored across', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acpira-mgr-'));
    const mk = () => new SessionManager({
      registry: new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE] } }),
      store: new TranscriptStore(dir), log: () => {}, cwd: () => '/tmp', defaultAgent: () => 'fake', runInTerminal: () => {}, toast: () => {},
    });
    const a = mk();
    const b = mk();
    await a.init();
    await b.init();
    await a.newSession();
    await a.handle({ type: 'send', text: 'from A' });
    const sa = a.activeId!;
    await b.newSession();
    await b.handle({ type: 'send', text: 'from B' });
    const sb = b.activeId!;
    // Each keeps streaming (index writes on both sides) — nothing is lost; a refresh (window focus) is when the other's work shows up
    await a.handle({ type: 'send', text: 'A again' });
    await b.handle({ type: 'send', text: 'B again' });
    await b.refreshIndex();
    await a.refreshIndex();
    await b.refreshIndex();
    expect(a.sessions().map(s => s.id).sort()).toEqual([sa, sb].sort());
    expect(b.sessions().map(s => s.id).sort()).toEqual([sa, sb].sort());
    // A renames its own session: B sees the new title after its refresh, not its stale copy
    await a.handle({ type: 'renameSession', id: sa, title: 'A 的会话' });
    await a.refreshIndex();
    await b.refreshIndex();
    expect(b.sessions().find(s => s.id === sa)?.title).toBe('A 的会话');
    // A's window closes; B deletes A's session (live nowhere now): a host starting meanwhile does not list it, B's undo brings it back for everyone
    await a.dispose();
    const c = mk();
    await b.handle({ type: 'deleteSession', id: sa });
    await c.init();
    expect(c.sessions().map(s => s.id)).toEqual([sb]);
    await b.handle({ type: 'restoreSession', id: sa });
    await c.refreshIndex();
    expect(c.sessions().map(s => s.id).sort()).toEqual([sa, sb].sort());
    expect(c.sessions().find(s => s.id === sa)?.title).toBe('A 的会话');
    await b.dispose();
    await c.dispose();
  }, 30_000);

  it('the first session takes the warm process started at init', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acpira-mgr-'));
    const logs: string[] = [];
    const m = new SessionManager({
      registry: new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE] } }),
      store: new TranscriptStore(dir),
      log: line => logs.push(line),
      cwd: () => '/tmp',
      defaultAgent: () => 'fake',
      runInTerminal: () => {},
      toast: () => {},
    });
    await m.init();
    await m.newSession();
    expect(logs.some(l => l.includes('reuse warm'))).toBe(true);
    expect(m.active()?.status).toBe('ready');
    await m.dispose();
  }, 20_000);
});
