import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../src/host/acp/AcpSession';
import { TranscriptStore } from '../src/host/store/TranscriptStore';

function record(id: string, title = 'T'): SessionRecord {
  const now = '2026-01-01T00:00:00.000Z';
  return { id, agent: 'fake', cwd: '/tmp', title, createdAt: now, updatedAt: now, turns: [], controls: { modes: [], options: [] }, commands: [] };
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'acpilot-store-'));
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
});
