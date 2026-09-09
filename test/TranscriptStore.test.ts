import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../src/host/acp/AcpSession';
import { TranscriptStore, summarize } from '../src/host/store/TranscriptStore';

function record(id: string, title = 'T'): SessionRecord {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, agent: 'fake', cwd: '/tmp', title, createdAt: now, updatedAt: now, turns: [], controls: { modes: [], options: [] }, commands: [] };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'acpira-store-'));
  const logs: string[] = [];
  return { dir, logs, store: new TranscriptStore(dir, l => logs.push(l)) };
}

describe('TranscriptStore', () => {
  it('dispose writes what is still debounced', async () => {
    const { dir, store } = fixture();
    store.save(record('a', 'first'), 10_000);
    store.save(record('b', 'second'), 10_000);
    await store.dispose();
    expect(JSON.parse(readFileSync(join(dir, 'a.json'), 'utf8')).title).toBe('first');
    expect(JSON.parse(readFileSync(join(dir, 'b.json'), 'utf8')).title).toBe('second');
  });

  it('a debounced save that cannot reach the disk is logged, not thrown', async () => {
    const { dir, logs, store } = fixture();
    // A regular file where the record's directory must go makes the write fail
    writeFileSync(join(dir, 'x.json'), '');
    const broken = new TranscriptStore(join(dir, 'x.json'), l => logs.push(l));
    broken.save(record('x'), 0);
    await new Promise(r => setTimeout(r, 50));
    expect(logs.some(l => l.includes('save failed'))).toBe(true);
    expect(store).toBeDefined();
  });

  it('unreadable or malformed records load as missing and leave a log line', async () => {
    const { dir, logs, store } = fixture();
    writeFileSync(join(dir, 'bad.json'), '{ not json');
    writeFileSync(join(dir, 'shape.json'), JSON.stringify({ id: 'shape' }));
    expect(await store.load('bad')).toBeNull();
    expect(await store.load('shape')).toBeNull();
    expect(await store.load('absent')).toBeNull();
    expect(logs.filter(l => l.includes('record unreadable'))).toHaveLength(2);
    await store.flush(record('good'));
    expect((await store.load('good'))?.id).toBe('good');
  });

  it('rebuilding a lost index skips the broken records', async () => {
    const { dir, store } = fixture();
    await store.flush(record('ok'));
    writeFileSync(join(dir, 'bad.json'), 'nope');
    expect((await store.loadIndex()).map(s => s.id)).toEqual(['ok']);
  });

  // The failure that lost sessions in the wild: every window holds its own copy of the list and used to write it back whole
  it('two hosts over one directory: neither clobbers the other’s sessions, and a valid but incomplete index is healed from the record files', async () => {
    const { dir, store: a } = fixture();
    const b = new TranscriptStore(dir);
    await a.flush(record('a1', 'from A'));
    const listA = await a.syncIndex([summarize(record('a1', 'from A'))], new Set(['a1']));
    expect(listA.map(s => s.id)).toEqual(['a1']);

    // B booted earlier with an empty list and never saw a1; its write must not drop a1
    await b.flush(record('b1', 'from B'));
    const listB = await b.syncIndex([summarize(record('b1', 'from B'))], new Set(['b1']));
    expect(listB.map(s => s.id).sort()).toEqual(['a1', 'b1']);
    // A's next write, still ignorant of b1, keeps it too
    expect((await a.syncIndex(listA, new Set(['a1']))).map(s => s.id).sort()).toEqual(['a1', 'b1']);

    // An index hand-truncated to nothing (or clobbered by an old build) comes back from the files
    writeFileSync(join(dir, 'index.json'), '[]');
    expect((await a.loadIndex()).map(s => s.title).sort()).toEqual(['from A', 'from B']);
    // An entry whose file is gone drops out
    rmSync(join(dir, 'b1.json'));
    expect((await a.loadIndex()).map(s => s.id)).toEqual(['a1']);
  });

  it('own ids take this host’s summary, the rest the disk’s (another window may have renamed them); legacy entries get cwd backfilled', async () => {
    const { dir, store } = fixture();
    await store.flush(record('x', 'renamed elsewhere'));
    await store.flush(record('y', 'mine'));
    // Disk index: x already renamed by another window, y stale; this host's list has both under their old titles
    const stale = { ...summarize(record('y', 'old')), cwd: undefined as unknown as string };
    writeFileSync(join(dir, 'index.json'), JSON.stringify([summarize(record('x', 'renamed elsewhere')), stale]));
    const out = await store.syncIndex([summarize(record('x', 'old')), summarize(record('y', 'mine'))], new Set(['y']));
    expect(out.find(s => s.id === 'x')?.title).toBe('renamed elsewhere');
    expect(out.find(s => s.id === 'y')).toMatchObject({ title: 'mine', cwd: '/tmp' });
  });

  it('trash moves the record and its blobs out of the live directory and back; sweep removes only entries older than the window', async () => {
    const { dir, store } = fixture();
    await store.flush(record('t'));
    await store.saveBlob('t', '.png', new Uint8Array([1, 2, 3]));
    await store.trash('t');
    expect(existsSync(join(dir, 't.json'))).toBe(false);
    expect(existsSync(join(dir, 'trash', 't.json'))).toBe(true);
    expect(readdirSync(join(dir, 'trash', 't'))).toHaveLength(1);
    expect((await store.loadIndex()).map(s => s.id)).toEqual([]);

    await store.sweepTrash(60_000);
    expect(existsSync(join(dir, 'trash', 't.json'))).toBe(true);
    await store.restore('t');
    expect(existsSync(join(dir, 't.json'))).toBe(true);
    expect(readdirSync(join(dir, 't'))).toHaveLength(1);
    expect((await store.loadIndex()).map(s => s.id)).toEqual(['t']);

    await store.trash('t');
    await store.sweepTrash(0);
    expect(existsSync(join(dir, 'trash', 't.json'))).toBe(false);
    expect(existsSync(join(dir, 'trash', 't'))).toBe(false);
    await store.remove('t');
  });

  it('a record still debounced is readable through load, and writing the index lands it first so the index never names a missing file', async () => {
    const { dir, store } = fixture();
    store.save(record('p', 'pending'), 10_000);
    expect((await store.load('p'))?.title).toBe('pending');
    expect(existsSync(join(dir, 'p.json'))).toBe(false);
    expect((await store.syncIndex([summarize(record('p', 'pending'))], new Set(['p']))).map(s => s.id)).toEqual(['p']);
    expect(existsSync(join(dir, 'p.json'))).toBe(true);
    await store.dispose();
    // No temp files are left behind by the atomic writes
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
});
