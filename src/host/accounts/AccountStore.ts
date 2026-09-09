import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AccountInfo, AgentId } from '@shared/transcript';
import type { AccountCredential, AccountDraft } from './types';
import { msg } from '../errors';

// Secret vault: FileVault (secrets.json, mode 600) in the app, in-memory in tests
export interface SecretVault {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryVault implements SecretVault {
  private m = new Map<string, string>();
  async get(key: string) { return this.m.get(key); }
  async store(key: string, value: string) { this.m.set(key, value); }
  async delete(key: string) { this.m.delete(key); }
}

// Persistent vault at secrets.json. A corrupt file is logged and never overwritten.
export class FileVault implements SecretVault {
  private data = new Map<string, string>();
  private loaded = false;
  private frozen = false;

  constructor(private file: string, private log: (line: string) => void = () => {}) {}

  async get(key: string) {
    await this.load();
    return this.data.get(key);
  }

  async store(key: string, value: string) {
    await this.load();
    if (this.frozen) return;
    this.data.set(key, value);
    await this.persist();
  }

  async delete(key: string) {
    await this.load();
    if (this.frozen) return;
    this.data.delete(key);
    await this.persist();
  }

  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch { return; }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isPlainObject(parsed)) throw new Error('not an object');
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') this.data.set(k, v);
      }
    } catch (e) {
      this.log(`secrets.json unreadable, leaving file untouched (${msg(e)})`);
      this.frozen = true;
    }
  }

  private async persist() {
    if (this.frozen) return;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(Object.fromEntries(this.data), null, 2), { mode: 0o600 });
    try { await chmod(this.file, 0o600); } catch { /* Windows */ }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

interface StoredAccount extends AccountInfo {
  meta?: Record<string, string>;
}

const SECRET_PREFIX = 'acpira.account.';

export function accountSecretKey(id: string): string {
  return SECRET_PREFIX + id;
}

// Account metadata goes to <file> (JSON); secrets go into the vault keyed by id; the two sides are linked only by id
export class AccountStore {
  private items: StoredAccount[] = [];

  constructor(private file: string, private vault: SecretVault, private log: (line: string) => void = () => {}) {}

  // No file yet is the normal first run; a file that will not parse is worth a log line, since the UI then shows no accounts while the secrets still exist
  async load() {
    let raw: string;
    try { raw = await readFile(this.file, 'utf8'); }
    catch { this.items = []; return; }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('not an array');
      this.items = parsed as StoredAccount[];
    } catch (e) {
      this.log(`accounts.json unreadable, starting with no accounts (${msg(e)})`);
      this.items = [];
    }
    // Older drafts stored detail as '{tier} · {name}'; the name says nothing the label doesn't — keep the leading segment
    let migrated = false;
    for (const a of this.items) {
      const detail = a.detail?.split(' · ')[0] || undefined;
      if (detail !== a.detail) { a.detail = detail; migrated = true; }
    }
    if (migrated) await this.persist();
  }

  private async persist() {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.items, null, 2), { mode: 0o600 });
  }

  list(agent?: AgentId): AccountInfo[] {
    return this.items.filter(a => !agent || a.agent === agent).map(({ meta: _, ...info }) => info);
  }

  get(id: string): AccountInfo | undefined {
    const a = this.items.find(x => x.id === id);
    if (!a) return undefined;
    const { meta: _, ...info } = a;
    return info;
  }

  // The most recently used one is the default; if none has ever been used, take the earliest added
  defaultFor(agent: AgentId): AccountInfo | undefined {
    const list = this.list(agent);
    return list.sort((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') || a.addedAt.localeCompare(b.addedAt))[0];
  }

  // Same label under the same agent counts as the same account: re-login just swaps the secret instead of growing a duplicate
  async add(agent: AgentId, draft: AccountDraft): Promise<AccountInfo> {
    const now = new Date().toISOString();
    let a = this.items.find(x => x.agent === agent && x.label === draft.label);
    if (a) { a.detail = draft.detail; a.meta = draft.meta; }
    else { a = { id: randomUUID(), agent, label: draft.label, detail: draft.detail, meta: draft.meta, addedAt: now }; this.items.push(a); }
    await this.vault.store(accountSecretKey(a.id), draft.secret);
    await this.persist();
    const { meta: _, ...info } = a;
    return info;
  }

  async remove(id: string) {
    if (!this.items.some(x => x.id === id)) return;
    this.items = this.items.filter(x => x.id !== id);
    await this.vault.delete(accountSecretKey(id));
    await this.persist();
  }

  async credential(id: string): Promise<AccountCredential | undefined> {
    const a = this.items.find(x => x.id === id);
    if (!a) return undefined;
    const secret = await this.vault.get(accountSecretKey(id));
    return secret ? { secret, meta: a.meta } : undefined;
  }

  async touch(id: string) {
    const a = this.items.find(x => x.id === id);
    if (!a) return;
    a.lastUsedAt = new Date().toISOString();
    await this.persist();
  }
}
