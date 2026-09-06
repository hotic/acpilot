import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionSummary } from '@shared/transcript';
import type { SessionRecord } from '../acp/AcpSession';

// Session persistence: <dir>/index.json holds the summary list, <dir>/<id>.json holds the full record. Writes are debounced per session
export class TranscriptStore {
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

  async remove(id: string) {
    clearTimeout(this.timers.get(id));
    await rm(join(this.dir, `${id}.json`), { force: true });
  }
}

export function summarize(r: SessionRecord): SessionSummary {
  return { id: r.id, title: r.title, agent: r.agent, accountId: r.accountId, updatedAt: r.updatedAt, pinned: r.pinned };
}
