import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AcpSession } from '../src/host/acp/AcpSession';
import type { AgentProcess } from '../src/host/acp/AgentProcess';
import { AccountManager } from '../src/host/accounts/AccountManager';
import { AccountStore, MemoryVault } from '../src/host/accounts/AccountStore';
import type { AccountCredential, AccountDraft, AccountProvider, LoginFlow } from '../src/host/accounts/types';
import { DevinAccountProvider, parseStatus, readCredentials, tomlOf } from '../src/host/accounts/devin';
import { SessionManager } from '../src/host/SessionManager';
import { TranscriptStore } from '../src/host/store/TranscriptStore';

const FAKE = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

// Fake provider: puts the key into authenticate's _meta.api_key like Devin does; import always returns one account
class FakeProvider implements AccountProvider {
  readonly agent = 'fake';
  importDraft: AccountDraft | undefined = { label: 'one@example.com', detail: 'Max', secret: 'good-key' };
  async importLocal() { return this.importDraft; }
  async login(): Promise<LoginFlow> { throw new Error('not in test'); }
  async authenticate(proc: AgentProcess, cred: AccountCredential) {
    const req: acp.AuthenticateRequest = { methodId: 'fake.login', _meta: { api_key: cred.secret } };
    await proc.agent.request(acp.methods.agent.authenticate, req);
  }
}

function tmp() { return mkdtempSync(join(tmpdir(), 'acpilot-acc-')); }

describe('AccountStore', () => {
  it('metadata goes to JSON, secrets go to the vault; re-login with the same label only replaces the secret; the default account is the most recently used', async () => {
    const dir = tmp();
    const vault = new MemoryVault();
    const store = new AccountStore(join(dir, 'accounts.json'), vault);
    await store.load();
    const a = await store.add('devin', { label: 'a@x.io', detail: 'Max', secret: 's1', meta: { api_server_url: 'https://s' } });
    const b = await store.add('devin', { label: 'b@x.io', secret: 's2' });
    expect(store.list('devin').map(x => x.label)).toEqual(['a@x.io', 'b@x.io']);
    expect(JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8'))).not.toContain('s1');
    expect(readFileSync(join(dir, 'accounts.json'), 'utf8')).not.toMatch(/s1|s2/);
    expect(await store.credential(a.id)).toEqual({ secret: 's1', meta: { api_server_url: 'https://s' } });
    // the earliest added is the default; after b is used once, the default switches to b
    expect(store.defaultFor('devin')?.id).toBe(a.id);
    await store.touch(b.id);
    expect(store.defaultFor('devin')?.id).toBe(b.id);
    // re-login with the same label: id unchanged, secret replaced
    const a2 = await store.add('devin', { label: 'a@x.io', secret: 's1-new' });
    expect(a2.id).toBe(a.id);
    expect(store.list('devin')).toHaveLength(2);
    expect((await store.credential(a.id))?.secret).toBe('s1-new');
    await store.remove(a.id);
    expect(store.list('devin').map(x => x.id)).toEqual([b.id]);
    expect(await store.credential(a.id)).toBeUndefined();
    // still there after a reload
    const store2 = new AccountStore(join(dir, 'accounts.json'), vault);
    await store2.load();
    expect(store2.list().map(x => x.id)).toEqual([b.id]);
  });
});

describe('Devin terminal login flow', () => {
  it('waits for the toml in an isolated XDG dir → collects credentials (falls back to the key suffix as label if identity lookup fails) → cleans up the dir', async () => {
    const { existsSync } = await import('node:fs');
    const { mkdir, writeFile } = await import('node:fs/promises');
    const scratch = tmp();
    const p = new DevinAccountProvider(scratch, async () => '/nonexistent/devin');
    const flow = await p.login();
    expect(flow).toMatchObject({ command: '/nonexistent/devin', args: ['auth', 'login'] });
    expect(flow.env.ACP_BACKEND).toBeNull();
    const dir = flow.env.XDG_DATA_HOME as string;
    expect(dir.startsWith(scratch)).toBe(true);
    const ctrl = new AbortController();
    const collecting = flow.collect(ctrl.signal);
    // simulate the CLI login writing to disk
    await new Promise(r => setTimeout(r, 300));
    await mkdir(join(dir, 'devin'), { recursive: true });
    await writeFile(join(dir, 'devin', 'credentials.toml'), tomlOf({ secret: 'devin-key-wxyz', meta: { api_server_url: 'https://s' } }));
    const draft = await collecting;
    expect(draft).toEqual({ secret: 'devin-key-wxyz', meta: { api_server_url: 'https://s' }, label: 'Devin …wxyz', detail: undefined });
    expect(existsSync(dir)).toBe(false);
    // abort: nothing written, collect returns undefined and the dir is cleaned up
    const flow2 = await p.login();
    const ctrl2 = new AbortController();
    setTimeout(() => ctrl2.abort(), 50);
    expect(await flow2.collect(ctrl2.signal)).toBeUndefined();
    expect(existsSync(flow2.env.XDG_DATA_HOME as string)).toBe(false);
  });
});

describe('Devin credentials file and auth status parsing', () => {
  it('toml write/read round-trip; status output yields email / tier / name', async () => {
    const dir = tmp();
    const cred: AccountCredential = { secret: 'devin-abc', meta: { api_server_url: 'https://server.codeium.com', devin_webapp_host: 'app.devin.ai', devin_api_url: 'https://api.devin.ai' } };
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'credentials.toml'), tomlOf(cred));
    expect(await readCredentials(join(dir, 'credentials.toml'))).toEqual(cred);
    expect(await readCredentials(join(dir, 'nope.toml'))).toBeUndefined();
    const out = 'Logged in (via Devin).\n\nUser:\n  Name:              Someone\n  Email:             someone@example.com\n\nAccount:\n  Tier:              Devin Max\n  Plan:              Max\n';
    expect(parseStatus(out)).toEqual({ label: 'someone@example.com', detail: 'Devin Max · Someone' });
    expect(parseStatus('Not logged in.')).toBeUndefined();
  });
});

function setup() {
  const dir = tmp();
  const provider = new FakeProvider();
  const store = new AccountStore(join(dir, 'accounts.json'), new MemoryVault());
  const toasts: string[] = [];
  const accounts = new AccountManager({ store, providers: [provider], log: () => {}, runInTerminal: () => {}, toast: (_l, t) => toasts.push(t) });
  const registry = new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE] } });
  const m = new SessionManager({
    registry, store: new TranscriptStore(join(dir, 'sessions')), log: () => {}, cwd: () => '/tmp/acpilot-needs-auth', defaultAgent: () => 'fake',
    runInTerminal: () => {}, toast: (_l, t) => toasts.push(t), accounts,
  });
  return { m, accounts, store, provider, toasts, registry };
}

describe('account layer wired into sessions', () => {
  it('no account → auth_required and the agent flagged accounts; after import a reopened session is ready and bound to the account; switching accounts opens a new session and changes the default', async () => {
    const { m, accounts, store } = setup();
    await m.init();
    expect(m.agents().find(a => a.id === 'fake')?.accounts).toBe(true);
    await m.newSession();
    expect(m.active()?.status).toBe('auth_required');
    const empty = m.activeId!;

    await m.handle({ type: 'addAccount', agent: 'fake', via: 'import' });
    const [one] = accounts.list();
    expect(one).toMatchObject({ agent: 'fake', label: 'one@example.com' });
    // the empty session stuck on login is replaced; the new session is bound to the account and ready
    expect(m.activeId).not.toBe(empty);
    expect(m.sessions().map(s => s.id)).toEqual([m.activeId]);
    expect(m.active()).toMatchObject({ status: 'ready', accountId: one!.id });
    await m.handle({ type: 'send', text: 'hi' });

    // second account: switching to it = a new session bound to it; the default account switches too
    const two = await store.add('fake', { label: 'two@example.com', secret: 'good-key' });
    const first = m.activeId!;
    await m.handle({ type: 'selectAccount', id: two.id });
    expect(m.activeId).not.toBe(first);
    expect(m.active()).toMatchObject({ status: 'ready', accountId: two.id });
    expect(accounts.defaultFor('fake')?.id).toBe(two.id);
    expect(m.sessions().find(s => s.id === first)?.accountId).toBe(one!.id);
    await m.dispose();
  }, 20_000);

  it('"+" auto-decides: import when the local login was never imported; fall back to terminal login when already imported or not logged in locally', async () => {
    const { accounts, provider, toasts } = setup();
    // first time: the local login is not in the list yet → import directly
    expect(await accounts.add('fake')).toMatchObject({ label: 'one@example.com' });
    expect(toasts.at(-1)).toContain('one@example.com');
    // second time: already imported → goes to login (the fake provider's login throws, proving that path was taken)
    await expect(accounts.add('fake')).rejects.toThrow('not in test');
    // not logged in locally → also goes to login
    provider.importDraft = undefined;
    await expect(accounts.add('fake')).rejects.toThrow('not in test');
    expect(accounts.list()).toHaveLength(1);
  });

  it('invalid key → auth_required with a reason; removing the account removes its credential', async () => {
    const { m, accounts, store } = setup();
    await m.init();
    const bad = await store.add('fake', { label: 'bad@example.com', secret: 'bad-key' });
    await m.newSession('fake', bad.id);
    expect(m.active()?.status).toBe('auth_required');
    await m.handle({ type: 'removeAccount', id: bad.id });
    expect(accounts.list()).toEqual([]);
    expect(await store.credential(bad.id)).toBeUndefined();
    await m.dispose();
  }, 20_000);

  it('AcpSession using the hooks directly: a missing credential raises AccountAuthError, enters auth_required and keeps the reason', async () => {
    const registry = new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE] } });
    const s = AcpSession.fresh('fake', '/tmp/acpilot-needs-auth', {
      registry, log: () => {}, onChange: () => {}, blobs: { saveBlob: async () => ({ name: 'x', path: '/tmp/x' }), readBlob: async () => new Uint8Array() },
      accounts: { spawnEnv: async () => undefined, authenticate: async () => { throw new Error('账号 x 的凭据不在了'); } },
    }, 'missing');
    await s.start();
    expect(s.view()).toMatchObject({ status: 'auth_required', error: '账号 x 的凭据不在了', accountId: 'missing' });
    s.dispose();
  });
});
