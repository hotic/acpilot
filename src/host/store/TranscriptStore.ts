import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentId, SessionSummary, TurnSettings } from '@shared/transcript';
import type { SessionRecord } from '../acp/AcpSession';
import type { BlobStore } from '../acp/attachments';
import { msg } from '../errors';
import { t } from '../i18n';

// Cross-session memory that is not a setting: the mode / config values last chosen per agent, replayed onto new sessions
export interface SessionPrefs {
  lastSettings: Record<AgentId, TurnSettings>;
}

const META_FILES = new Set(['index.json', 'prefs.json']);

// Streamed updates call save() every few milliseconds; one write per session this often is plenty
const SAVE_DEBOUNCE_MS = 400;

interface PendingWrite {
  timer: NodeJS.Timeout;
  record: SessionRecord;
}

// Session persistence: <dir>/index.json holds the summary list, <dir>/prefs.json the per-agent memory, <dir>/<id>.json the full record,
// <dir>/<id>/ its attachment blobs. Record writes are debounced per session
export class TranscriptStore implements BlobStore {
  private pending = new Map<string, PendingWrite>();

  constructor(private dir: string, private log: (line: string) => void = () => {}) {}

  private async ensure() { await mkdir(this.dir, { recursive: true }); }

  async loadIndex(): Promise<SessionSummary[]> {
    try { return JSON.parse(await readFile(join(this.dir, 'index.json'), 'utf8')) as SessionSummary[]; }
    catch { return this.rebuildIndex(); }
  }

  async loadPrefs(): Promise<SessionPrefs> {
    try { return { lastSettings: {}, ...(JSON.parse(await readFile(join(this.dir, 'prefs.json'), 'utf8')) as Partial<SessionPrefs>) }; }
    catch { return { lastSettings: {} }; }
  }

  async savePrefs(prefs: SessionPrefs) {
    await this.ensure();
    await writeFile(join(this.dir, 'prefs.json'), JSON.stringify(prefs, null, 2));
  }

  // If the index is lost, rebuild it by scanning the directory
  private async rebuildIndex(): Promise<SessionSummary[]> {
    await this.ensure();
    const out: SessionSummary[] = [];
    for (const f of await readdir(this.dir)) {
      if (!f.endsWith('.json') || META_FILES.has(f)) continue;
      const r = await this.load(f.slice(0, -5));
      if (r) out.push(summarize(r));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveIndex(list: SessionSummary[]) {
    await this.ensure();
    await writeFile(join(this.dir, 'index.json'), JSON.stringify(list, null, 2));
  }

  // A record that fails to parse, or lacks the fields every reader relies on, counts as missing: better an empty entry than a crash mid-restore
  async load(id: string): Promise<SessionRecord | null> {
    let raw: string;
    try { raw = await readFile(join(this.dir, `${id}.json`), 'utf8'); }
    catch { return null; }
    try {
      const r = JSON.parse(raw) as unknown;
      if (!isRecord(r)) throw new Error('not a session record');
      return r;
    } catch (e) {
      this.log(`session ${id}: record unreadable (${msg(e)})`);
      return null;
    }
  }

  save(record: SessionRecord, delay = SAVE_DEBOUNCE_MS) {
    this.cancelPending(record.id);
    const timer = setTimeout(() => {
      this.pending.delete(record.id);
      this.write(record).catch(e => this.log(`session ${record.id}: save failed (${msg(e)})`));
    }, delay);
    this.pending.set(record.id, { timer, record });
  }

  async flush(record: SessionRecord) {
    this.cancelPending(record.id);
    await this.write(record);
  }

  // Removes the record and its blob directory
  async remove(id: string) {
    this.cancelPending(id);
    await rm(join(this.dir, `${id}.json`), { force: true });
    await rm(join(this.dir, id), { recursive: true, force: true });
  }

  // Writes whatever is still debounced; called when the extension host goes down so the last few seconds of a transcript are not lost
  async dispose() {
    const writes = [...this.pending.values()].map(p => { clearTimeout(p.timer); return this.write(p.record); });
    this.pending.clear();
    const results = await Promise.allSettled(writes);
    for (const r of results) if (r.status === 'rejected') this.log(`final save failed (${msg(r.reason)})`);
  }

  private cancelPending(id: string) {
    const p = this.pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(id);
  }

  private async write(record: SessionRecord) {
    await this.ensure();
    await writeFile(join(this.dir, `${record.id}.json`), JSON.stringify(record));
  }

  // Blob names are content hashes, so pasting the same image twice yields one file. The session id names the directory, so it must be a plain token
  // (fresh ids are UUIDs; a hand-edited record could hold anything)
  async saveBlob(sessionId: string, ext: string, bytes: Uint8Array): Promise<{ name: string; path: string }> {
    if (!/^[\w-]+$/.test(sessionId) || !/^\.\w+$/.test(ext)) throw new Error(t('host.blobIllegal', { path: `${sessionId}/*${ext}` }));
    const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}${ext}`;
    const dir = join(this.dir, sessionId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, name);
    await writeFile(path, bytes);
    return { name, path };
  }

  async readBlob(sessionId: string, name: string): Promise<Uint8Array> {
    if (!/^[\w-]+$/.test(sessionId) || !/^[\w-]+\.\w+$/.test(name)) throw new Error(t('host.blobIllegal', { path: `${sessionId}/${name}` }));
    return readFile(join(this.dir, sessionId, name));
  }
}

export function summarize(r: SessionRecord): SessionSummary {
  return { id: r.id, title: r.title, agent: r.agent, accountId: r.accountId, updatedAt: r.updatedAt, pinned: r.pinned };
}

// The minimum shape the manager and the session constructor dereference without checks
function isRecord(v: unknown): v is SessionRecord {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.agent === 'string' && typeof r.cwd === 'string'
    && typeof r.updatedAt === 'string' && Array.isArray(r.turns);
}
