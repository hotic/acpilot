import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionSummary } from '@shared/transcript';
import type { SessionRecord } from '../acp/AcpSession';
import type { BlobStore } from '../acp/attachments';

// Session persistence: <dir>/index.json holds the summary list, <dir>/<id>.json holds the full record, <dir>/<id>/ holds its attachment blobs. Writes are debounced per session
export class TranscriptStore implements BlobStore {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private dir: string) {}

  private async ensure() { await mkdir(this.dir, { recursive: true }); }

  async loadIndex(): Promise<SessionSummary[]> {
    try { return JSON.parse(await readFile(join(this.dir, 'index.json'), 'utf8')) as SessionSummary[]; }
    catch { return this.rebuildIndex(); }
  }

  // If the index is lost, rebuild it by scanning the directory
  private async rebuildIndex(): Promise<SessionSummary[]> {
    await this.ensure();
    const out: SessionSummary[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json') || f === 'index.json') continue;
      const r = await this.load(f.slice(0, -5));
      if (r) out.push(summarize(r));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveIndex(list: SessionSummary[]) {
    await this.ensure();
    await writeFile(join(this.dir, 'index.json'), JSON.stringify(list, null, 2));
  }

  async load(id: string): Promise<SessionRecord | null> {
    try { return JSON.parse(await readFile(join(this.dir, `${id}.json`), 'utf8')) as SessionRecord; }
    catch { return null; }
  }

  save(record: SessionRecord, delay = 400) {
    clearTimeout(this.timers.get(record.id));
    this.timers.set(record.id, setTimeout(() => {
      this.timers.delete(record.id);
      void this.ensure().then(() => writeFile(join(this.dir, `${record.id}.json`), JSON.stringify(record)));
    }, delay));
  }

  async flush(record: SessionRecord) {
    clearTimeout(this.timers.get(record.id));
    this.timers.delete(record.id);
    await this.ensure();
    await writeFile(join(this.dir, `${record.id}.json`), JSON.stringify(record));
  }

  // Removes the record and its blob directory
  async remove(id: string) {
    clearTimeout(this.timers.get(id));
    await rm(join(this.dir, `${id}.json`), { force: true });
    await rm(join(this.dir, id), { recursive: true, force: true });
  }

  // Blob names are content hashes, so pasting the same image twice yields one file. The session id names the directory, so it must be a plain token
  // (fresh ids are UUIDs; a hand-edited record could hold anything)
  async saveBlob(sessionId: string, ext: string, bytes: Uint8Array): Promise<{ name: string; path: string }> {
    if (!/^[\w-]+$/.test(sessionId) || !/^\.\w+$/.test(ext)) throw new Error(`非法的 blob 位置：${sessionId}/*${ext}`);
    const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}${ext}`;
    const dir = join(this.dir, sessionId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, bytes);
    return { name, path };
  }

  async readBlob(sessionId: string, name: string): Promise<Uint8Array> {
    if (!/^[\w-]+$/.test(sessionId) || !/^[\w-]+\.\w+$/.test(name)) throw new Error(`非法的 blob 位置：${sessionId}/${name}`);
    return readFile(join(this.dir, sessionId, name));
  }
}

export function summarize(r: SessionRecord): SessionSummary {
  return { id: r.id, title: r.title, agent: r.agent, accountId: r.accountId, updatedAt: r.updatedAt, pinned: r.pinned };
}
