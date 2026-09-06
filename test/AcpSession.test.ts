import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentBlock, PermissionBlock, SessionOption, ToolCallBlock } from '@shared/transcript';
import { MAX_IMAGE_BYTES } from '@shared/attachments';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AcpSession, type CompactionPolicy, type SessionDeps } from '../src/host/acp/AcpSession';

// Launch test/fake-agent.ts via tsx as the agent; the registry holds a custom agent pointing at it
const FAKE = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

// Grok-style synthesized modes: not provided by the protocol, declared in the registry
const SYN_MODES: SessionOption[] = [
  { id: 'default', name: 'Agent' },
  { id: 'plan', name: 'Plan' },
  { id: 'yolo', name: 'Auto accept' },
];

function deps(cwd = '/tmp', compaction?: () => CompactionPolicy, modes?: SessionOption[]) {
  const registry = new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE], login: 'echo login', modes } });
  const logs: string[] = [];
  let changes = 0;
  // In-memory blob store: remembers what was written so tests can check the payload landed
  const blobs = new Map<string, Uint8Array>();
  const d: SessionDeps = {
    registry, log: (l: string) => logs.push(l), onChange: () => { changes++; }, compaction,
    blobs: {
      saveBlob: async (sid, ext, bytes) => { const name = `b${blobs.size}${ext}`; blobs.set(name, bytes); return { name, path: `/blobs/${sid}/${name}` }; },
      readBlob: async (_sid, name) => { const b = blobs.get(name); if (!b) throw new Error(`no blob ${name}`); return b; },
    },
  };
  return { d, logs, blobs, changes: () => changes, session: () => AcpSession.fresh('fake', cwd, d) };
}

// Wait until a condition holds (5s timeout by default)
async function until(pred: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 20));
  }
}

describe('AcpSession', () => {
  it('start session: receives modes and configOptions (model sorted before thought_level)', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    const v = s.view();
    expect(v.status).toBe('ready');
    expect(v.controls.modes.map(m => m.id)).toEqual(['agent', 'plan']);
    expect(v.controls.modeId).toBe('agent');
    expect(v.controls.options.map(o => o.id)).toEqual(['model', 'effort']);
    expect(v.controls.options[0]).toMatchObject({ category: 'model', value: 'm1' });
    expect(v.controls.options[0]!.options.map(o => o.id)).toEqual(['m1', 'm2']);
    expect(v.controls.options[1]).toMatchObject({ name: 'Reasoning', category: 'thought_level', value: 'high' });
    s.dispose();
  });

  it('one prompt turn: thought / plan / text merged into blocks, title and commands updated, echoed user_message_chunk not duplicated', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    await s.prompt('hi');
    const v = s.view();
    expect(v.running).toBe(false);
    expect(v.turns).toHaveLength(2);
    expect(v.turns[0]).toEqual({ role: 'user', text: 'hi' });
    const agent = v.turns[1]!;
    expect(agent.role).toBe('agent');
    if (agent.role !== 'agent') return;
    expect(agent.blocks.map(b => b.type)).toEqual(['thought', 'plan', 'text']);
    expect(agent.blocks[0]).toMatchObject({ type: 'thought', text: 'thinking hard', streaming: false });
    expect(agent.blocks[2]).toMatchObject({ type: 'text', markdown: 'hello world', streaming: false });
    expect(agent.activity).toBeUndefined();
    expect(v.title).toBe('Fake title');
    expect(v.commands).toEqual([{ name: 'compact', description: 'compact it' }]);
    s.dispose();
  });

  it('attachments: image and dropped text are written to the blob store and sent as image / resource blocks, a file goes as resource_link; the turn keeps only references', async () => {
    const { session, blobs } = deps();
    const s = session();
    await s.start();
    const png = Buffer.from('fake-png-bytes').toString('base64');
    await s.prompt('echo blocks', [
      { kind: 'image', mimeType: 'image/png', data: png, name: 'shot.png' },
      { kind: 'text', name: 'notes.md', text: '# notes' },
      { kind: 'file', uri: 'file:///repo/src/a.ts', name: 'src/a.ts' },
    ]);
    const v = s.view();
    expect(v.turns[0]).toEqual({
      role: 'user', text: 'echo blocks',
      attachments: [
        { kind: 'image', blob: 'b0.png', mimeType: 'image/png', name: 'shot.png' },
        { kind: 'text', blob: 'b1.txt', name: 'notes.md' },
        { kind: 'file', uri: 'file:///repo/src/a.ts', name: 'src/a.ts' },
      ],
    });
    expect(Buffer.from(blobs.get('b0.png')!).toString()).toBe('fake-png-bytes');
    expect(Buffer.from(blobs.get('b1.txt')!).toString()).toBe('# notes');
    // the fake agent echoes the block types and key fields it received
    const agent = v.turns[1]!;
    if (agent.role !== 'agent') throw new Error();
    const echoed = agent.blocks.find(b => b.type === 'text');
    expect(echoed).toMatchObject({ type: 'text', markdown: 'text · image:image/png · resource:file:///blobs/' + s.id + '/b1.txt:# notes · resource_link:file:///repo/src/a.ts:src/a.ts' });
    s.dispose();
  });

  it('attachments only: the text block is omitted and the title comes from what was attached', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    await s.prompt('', [{ kind: 'image', mimeType: 'image/png', data: 'AAAA' }, { kind: 'file', uri: 'file:///repo/README.md', name: 'README.md' }]);
    const v = s.view();
    expect(v.turns[0]).toMatchObject({ role: 'user', text: '' });
    expect(v.title).toBe('1 张图片、README.md');
    const agent = v.turns[1]!;
    if (agent.role !== 'agent') throw new Error();
    expect(agent.blocks.find(b => b.type === 'text')).toMatchObject({ markdown: 'image:image/png · resource_link:file:///repo/README.md:README.md' });
    // the echoed user_message_chunk (Grok sends the image back too) must not create a second user turn
    expect(v.turns.filter(t => t.role === 'user')).toHaveLength(1);
    s.dispose();
  });

  it('file draft pointing at an image on disk is read and sent as pixels; an oversized image draft is dropped with a note, the rest still goes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acpilot-att-'));
    const png = join(dir, 'shot.png');
    writeFileSync(png, 'real-png-bytes');
    const { d, session, blobs } = deps();
    const notes: string[] = [];
    d.notify = t => notes.push(t);
    const s = session();
    await s.start();
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1).toString('base64');
    await s.prompt('echo blocks', [
      { kind: 'file', uri: pathToFileURL(png).href, name: 'shot.png' },
      { kind: 'image', mimeType: 'image/png', data: huge, name: 'huge.png' },
    ]);
    const v = s.view();
    expect(v.turns[0]).toMatchObject({ role: 'user', attachments: [{ kind: 'image', blob: 'b0.png', mimeType: 'image/png', name: 'shot.png' }] });
    expect(Buffer.from(blobs.get('b0.png')!).toString()).toBe('real-png-bytes');
    const agent = v.turns[1]!;
    if (agent.role !== 'agent') throw new Error();
    expect(agent.blocks.find(b => b.type === 'text')).toMatchObject({ markdown: 'text · image:image/png' });
    expect(notes).toEqual([`huge.png 超过 ${MAX_IMAGE_BYTES >> 20} MB，已跳过`]);
    s.dispose();
  });

  it('blob store failing does not lose the prompt: it still goes out inline, the attachment just has no preview', async () => {
    const { d, session } = deps();
    d.blobs = { saveBlob: async () => { throw new Error('disk full'); }, readBlob: async () => { throw new Error('nope'); } };
    const notes: string[] = [];
    d.notify = t => notes.push(t);
    const s = session();
    await s.start();
    await s.prompt('echo blocks', [{ kind: 'image', mimeType: 'image/png', data: 'AAAA', name: 'shot.png' }, { kind: 'text', name: 'n.md', text: 'x' }]);
    const v = s.view();
    expect(v.turns[0]).toEqual({ role: 'user', text: 'echo blocks', attachments: [{ kind: 'image', mimeType: 'image/png', name: 'shot.png' }, { kind: 'text', name: 'n.md' }] });
    const agent = v.turns[1]!;
    if (agent.role !== 'agent') throw new Error();
    expect(agent.blocks.find(b => b.type === 'text')).toMatchObject({ markdown: 'text · image:image/png · resource:attachment:///n.md:x' });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toContain('disk full');
    s.dispose();
  });

  it('cancel while staging drops the prompt without a turn; a send arriving meanwhile is queued and goes out afterwards', async () => {
    const { d, session } = deps();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const inner = d.blobs;
    d.blobs = { ...inner, saveBlob: async (...a) => { await gate; return inner.saveBlob(...a); } };
    const s = session();
    await s.start();
    const first = s.prompt('echo blocks', [{ kind: 'image', mimeType: 'image/png', data: 'AAAA' }]);
    expect(s.view().running).toBe(true);
    await s.cancel();
    await s.prompt('hi');
    expect(s.view().queued).toBe('hi');
    release();
    await first;
    await until(() => !s.view().running && s.view().turns.length === 2);
    const v = s.view();
    expect(v.turns[0]).toEqual({ role: 'user', text: 'hi' });
    expect(v.queued).toBeUndefined();
    s.dispose();
  });

  it('dispose while staging: nothing is appended or sent afterwards', async () => {
    const { d, session, blobs } = deps();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const inner = d.blobs;
    d.blobs = { ...inner, saveBlob: async (...a) => { await gate; return inner.saveBlob(...a); } };
    const s = session();
    await s.start();
    const p = s.prompt('echo blocks', [{ kind: 'image', mimeType: 'image/png', data: 'AAAA' }]);
    s.dispose();
    release();
    await p;
    expect(s.view().turns).toEqual([]);
    expect(s.view().running).toBe(false);
    // the blob had already been handed to the store by the time dispose landed; the manager removes the directory when it drops the session
    expect(blobs.size).toBe(1);
  });

  it('permission: card appears → approve → tool completes, diff normalized, usage arrives', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    const p = s.prompt('use tool');
    await until(() => s.view().turns.some(t => t.role === 'agent' && t.blocks.some(b => b.type === 'permission')));
    const agent = s.view().turns[1]!;
    if (agent.role !== 'agent') throw new Error();
    const perm = agent.blocks.find(b => b.type === 'permission') as PermissionBlock;
    expect(perm.command).toBe('pnpm test');
    expect(perm.options.map(o => o.id)).toEqual(['allow', 'reject']);
    expect(agent.activity?.label).toBe('等待批准');
    s.resolvePermission(perm.id, 'allow');
    await p;
    const v = s.view();
    const blocks = (v.turns[1] as { blocks: AgentBlock[] }).blocks;
    expect(blocks.some(b => b.type === 'permission')).toBe(false);
    const tc1 = blocks.find((b): b is ToolCallBlock => b.type === 'tool_call' && b.id === 'tc1')!;
    expect(tc1).toMatchObject({ kind: 'execute', verb: '运行', target: 'pnpm test', targetMono: true, status: 'completed' });
    expect(tc1.content).toEqual({ type: 'text', text: '12 passed' });
    const tc2 = blocks.find((b): b is ToolCallBlock => b.type === 'tool_call' && b.id === 'tc2')!;
    expect(tc2).toMatchObject({ kind: 'edit', target: 'a.ts', diffStat: { add: 2, del: 1 } });
    expect(v.usage).toEqual({ used: 1234, size: 100000, cost: 0.01 });
    s.dispose();
  });

  it('synthesized modes: when the protocol omits modes, backfill from the registry, default to the first one, setMode goes through session/set_mode', async () => {
    mkdirSync('/tmp/acpilot-no-modes', { recursive: true });
    const { session } = deps('/tmp/acpilot-no-modes', undefined, SYN_MODES);
    const s = session();
    await s.start();
    const v = s.view();
    expect(v.status).toBe('ready');
    expect(v.controls.modes.map(m => m.id)).toEqual(['default', 'plan', 'yolo']);
    expect(v.controls.modeId).toBe('default');
    // configOptions unaffected, still land in controls.options
    expect(v.controls.options.map(o => o.id)).toEqual(['model', 'effort']);
    await s.setMode('plan');
    expect(s.view().controls.modeId).toBe('plan');
    await s.setMode('default');
    expect(s.view().controls.modeId).toBe('default');
    s.dispose();
  });

  it('synthesized modes: yolo auto-approves permission requests, no card shown', async () => {
    mkdirSync('/tmp/acpilot-no-modes', { recursive: true });
    const { session } = deps('/tmp/acpilot-no-modes', undefined, SYN_MODES);
    const s = session();
    await s.start();
    // plan → yolo: covers the "pull the CLI back to default first" path
    await s.setMode('plan');
    await s.setMode('yolo');
    expect(s.view().controls.modeId).toBe('yolo');
    await s.prompt('use tool');
    const v = s.view();
    const blocks = (v.turns[1] as { blocks: AgentBlock[] }).blocks;
    expect(blocks.some(b => b.type === 'permission')).toBe(false);
    const tc1 = blocks.find((b): b is ToolCallBlock => b.type === 'tool_call' && b.id === 'tc1')!;
    expect(tc1.status).toBe('completed');
    s.dispose();
  });

  it('synthesized modes: switching into yolo approves pending permissions too', async () => {
    mkdirSync('/tmp/acpilot-no-modes', { recursive: true });
    const { session } = deps('/tmp/acpilot-no-modes', undefined, SYN_MODES);
    const s = session();
    await s.start();
    const p = s.prompt('use tool');
    await until(() => s.view().turns.some(t => t.role === 'agent' && t.blocks.some(b => b.type === 'permission')));
    await s.setMode('yolo');
    await p;
    const v = s.view();
    expect(v.running).toBe(false);
    const blocks = (v.turns[1] as { blocks: AgentBlock[] }).blocks;
    expect(blocks.some(b => b.type === 'permission')).toBe(false);
    const tc1 = blocks.find((b): b is ToolCallBlock => b.type === 'tool_call' && b.id === 'tc1')!;
    expect(tc1.status).toBe('completed');
    s.dispose();
  });

  it('cancel: text stops midway, the turn wraps up, can send again', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    const p = s.prompt('slow');
    await until(() => { const t = s.view().turns[1]; return t?.role === 'agent' && t.blocks.some(b => b.type === 'text'); });
    await s.cancel();
    await p;
    expect(s.view().running).toBe(false);
    await s.prompt('hi');
    expect(s.view().turns).toHaveLength(4);
    s.dispose();
  });

  it('prompt error: the turn ends with stop=error carrying code / kind / retryable, the session stays ready; retryTurn drops both turns and sends the same prompt again', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    await s.prompt('please fail');
    let v = s.view();
    expect(v.status).toBe('ready');
    expect(v.running).toBe(false);
    expect(v.error).toBeUndefined();
    expect(v.turns).toHaveLength(2);
    const agent = v.turns[1]!;
    if (agent.role !== 'agent') throw new Error();
    expect(agent.stop).toBe('error');
    expect(agent.error).toEqual({ message: 'Upstream error: quota exhausted', code: -32603, kind: 'upstream_error', retryable: true });
    await s.retryTurn();
    v = s.view();
    expect(v.turns).toHaveLength(2);
    expect(v.turns[0]).toEqual({ role: 'user', text: 'please fail' });
    const again = v.turns[1]!;
    if (again.role !== 'agent') throw new Error();
    expect(again.stop).toBe('end_turn');
    expect(again.blocks.some(b => b.type === 'text')).toBe(true);
    s.dispose();
  });

  it('retryTurn: attachments are rebuilt from their blobs; nothing happens after a normal end', async () => {
    const { session, blobs } = deps();
    const s = session();
    await s.start();
    await s.prompt('fail with picture', [{ kind: 'image', mimeType: 'image/png', data: Buffer.from('png!').toString('base64'), name: 'shot.png' }]);
    expect(blobs.size).toBe(1);
    await s.retryTurn();
    const v = s.view();
    expect(v.turns).toHaveLength(2);
    const user = v.turns[0]!;
    expect(user).toMatchObject({ role: 'user', text: 'fail with picture', attachments: [{ kind: 'image', mimeType: 'image/png', name: 'shot.png' }] });
    // The re-sent image is byte-for-byte the original (the fake store names blobs by count, the real one by content hash)
    const blob = user.role === 'user' && user.attachments?.[0]?.kind === 'image' ? user.attachments[0].blob : undefined;
    expect(Buffer.from(blobs.get(blob ?? '')!).toString()).toBe('png!');
    const agent = v.turns[1]!;
    if (agent.role !== 'agent') throw new Error();
    expect(agent.stop).toBe('end_turn');
    expect(agent.blocks[0]).toMatchObject({ type: 'text', markdown: 'text · image:image/png' });
    await s.retryTurn();
    expect(s.view().turns).toHaveLength(2);
    s.dispose();
  });

  it('short stops: refusal leaves an empty turn with stop=refusal, max_tokens keeps the text and stop=max_tokens; a normal turn records end_turn', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    await s.prompt('refuse this');
    await s.prompt('truncate this');
    await s.prompt('hi');
    const [, refused, , truncated, , ok] = s.view().turns;
    if (refused?.role !== 'agent' || truncated?.role !== 'agent' || ok?.role !== 'agent') throw new Error();
    expect(refused.stop).toBe('refusal');
    expect(refused.blocks).toEqual([]);
    expect(truncated.stop).toBe('max_tokens');
    expect(truncated.blocks.at(-1)).toMatchObject({ type: 'text', markdown: 'once upon a', streaming: false });
    expect(ok.stop).toBe('end_turn');
    expect(ok.error).toBeUndefined();
    s.dispose();
  });

  it('queue: sending another prompt while running auto-sends it after the turn ends', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    const p = s.prompt('slow');
    await until(() => s.view().running);
    await s.prompt('hi');
    expect(s.view().queued).toBe('hi');
    await s.cancel();
    await p;
    await until(() => s.view().turns.length === 4 && !s.view().running);
    expect(s.view().queued).toBeUndefined();
    s.dispose();
  });

  it('switch mode / model / effort; rename and pin leave updatedAt untouched', async () => {
    const { session } = deps();
    const s = session();
    await s.start();
    await s.setMode('plan');
    expect(s.view().controls.modeId).toBe('plan');
    await s.setConfig('model', 'm2');
    expect(s.view().controls.options.find(o => o.id === 'model')?.value).toBe('m2');
    await s.setConfig('effort', 'low');
    expect(s.view().controls.options.find(o => o.id === 'effort')?.value).toBe('low');
    expect(s.view().controls.options.find(o => o.id === 'model')?.value).toBe('m2');
    await s.setConfig('nope', 'x');
    const before = s.view().updatedAt;
    s.rename('  改个名  ');
    s.setPinned(true);
    expect(s.view().title).toBe('改个名');
    expect(s.toRecord().pinned).toBe(true);
    expect(s.view().updatedAt).toBe(before);
    s.dispose();
  });

  it('resume: with acpSessionId goes through session/resume; unknown to the process → readonly', async () => {
    const { d, session } = deps();
    const s = session();
    await s.start();
    await s.prompt('hi');
    const record = s.toRecord();
    s.dispose();
    // new process doesn't know the old sessionId → resume fails → loadSession unimplemented → readonly
    const s2 = new AcpSession(record, d);
    await s2.start();
    expect(s2.view().status).toBe('readonly');
    expect(s2.view().turns).toHaveLength(2);
    s2.dispose();
  });

  it('resume: peer reports session_not_found (Devin sweeps empty sessions) → fall back to a new session, history kept', async () => {
    mkdirSync('/tmp/acpilot-gone', { recursive: true });
    const { d, logs, session } = deps('/tmp/acpilot-gone');
    const s = session();
    await s.start();
    await s.prompt('hi');
    const record = s.toRecord();
    s.dispose();
    // new process resume reports session_not_found → degrade to session/new: status ready, local history untouched
    // (the fake agent resets seq to zero per process, so the new session is still named s1; only logs tell new from resume)
    const s2 = new AcpSession(record, d);
    await s2.start();
    expect(s2.view().status).toBe('ready');
    expect(s2.view().turns).toHaveLength(2);
    expect(logs.filter(l => l.includes('session/new ok')).length).toBe(2);
    s2.dispose();
  });

  it('auto compaction: usage over threshold at turn end and /compact available → auto-send an auto turn, compaction row in_progress→completed, usage drops; no resend if usage did not grow back', async () => {
    const { session } = deps('/tmp', () => ({ atTokens: 300_000, auto: true }));
    const s = session();
    await s.start();
    await s.prompt('big');
    // auto compaction is already queued (async) when prompt() returns; wait for it to finish
    await until(() => s.view().turns.length === 4 && !s.view().running);
    const v = s.view();
    expect(v.turns[2]).toEqual({ role: 'user', text: '/compact', auto: true });
    const t = v.turns[3]!;
    if (t.role !== 'agent') throw new Error();
    expect(t.blocks).toEqual([{ type: 'compaction', id: 'cp1', status: 'completed' }]);
    expect(v.usage?.used).toBeLessThan(300_000);
    expect(v.title).toBe('big');

    // grows again → compacts once more, but this time the fake agent can't compact (usage unchanged)
    await s.prompt('big');
    await until(() => s.view().turns.length === 8 && !s.view().running);
    const used = s.view().usage!.used;
    expect(used).toBeGreaterThan(300_000);
    // usage didn't grow back much: the next turn end doesn't resend /compact
    await s.prompt('hi');
    await new Promise(r => setTimeout(r, 200));
    expect(s.view().turns).toHaveLength(10);
    expect(s.view().usage!.used).toBe(used);
    s.dispose();
  });

  it('manual compaction: sends /compact when available; errors when not', async () => {
    const { session } = deps('/tmp', () => ({ atTokens: 300_000, auto: false }));
    const s = session();
    await s.start();
    await expect(s.compact()).rejects.toThrow('/compact');
    await s.prompt('big');
    await new Promise(r => setTimeout(r, 200));
    expect(s.view().turns).toHaveLength(2);
    await s.compact();
    expect(s.view().turns).toHaveLength(4);
    expect(s.view().turns[2]).toEqual({ role: 'user', text: '/compact' });
    s.dispose();
  });

  it('login: session/new fails with -32000 → auth_required → authenticate → retry succeeds', async () => {
    mkdirSync('/tmp/acpilot-needs-auth', { recursive: true });
    const { session } = deps('/tmp/acpilot-needs-auth');
    const s = session();
    await s.start();
    expect(s.view().status).toBe('auth_required');
    expect(s.view().authMethods?.[0]?.id).toBe('fake.login');
    // The reason the CLI logged to stderr right before -32000 is surfaced instead of a bare "log in"
    expect(s.view().error).toBe('provider managed:fake has no credential configured');
    await s.authenticate();
    await s.retry();
    expect(s.view().status).toBe('ready');
    expect(s.view().error).toBeUndefined();
    s.dispose();
  });
});
