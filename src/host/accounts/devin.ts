import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import type { AgentProcess } from '../acp/AgentProcess';
import type { AccountCredential, AccountDraft, AccountProvider, LoginFlow } from './types';
import { t } from '../i18n';

// Devin CLI login = a PKCE exchange for a long-lived API key, stored in $XDG_DATA_HOME/devin/credentials.toml (four keys).
// ACP mode does not read that file (so usage isn't billed to another account); the host must hand the key over via _meta.api_key in authenticate —
// that's what the Windsurf client inside Devin.app does (method windsurf-api-key + api_key / api_server_url).
// The browser login method (devin-browser) authenticates only the current process; the key is neither returned nor persisted, so a durable account can only come from the toml:
// import a local login, or run `devin auth login` once inside an isolated XDG directory and collect the toml.
// Identity (email / plan) comes from `devin auth status` reading the toml temporarily written into the isolated directory.

const TOML_KEYS = ['api_server_url', 'devin_webapp_host', 'devin_api_url'] as const;
const SECRET_KEY = 'windsurf_api_key';

export class DevinAccountProvider implements AccountProvider {
  readonly agent = 'devin';

  // scratchDir: root of the temp directories used for isolated login / identity lookup; binary: locate the devin executable
  constructor(private scratchDir: string, private binary: () => Promise<string | null>) {}

  async importLocal(): Promise<AccountDraft | undefined> {
    const cred = await readCredentials(join(dataHome(), 'devin', 'credentials.toml'));
    if (!cred) return undefined;
    return { ...cred, ...(await this.identify(cred)) };
  }

  async login(): Promise<LoginFlow> {
    const bin = await this.binary();
    if (!bin) throw new Error(t('host.notFound', { command: 'devin', agent: 'Devin' }));
    const dir = join(this.scratchDir, `login-${randomUUID()}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, 'devin', 'credentials.toml');
    return {
      command: bin, args: ['auth', 'login'],
      // ACP_BACKEND makes the CLI ignore local credentials; it must be removed from the login environment
      env: { XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir, ACP_BACKEND: null },
      collect: async signal => {
        try {
          const cred = await waitFor(() => readCredentials(file), signal);
          return cred && { ...cred, ...(await this.identify(cred)) };
        } finally { await rm(dir, { recursive: true, force: true }); }
      },
    };
  }

  // Write the credential into an isolated directory, run `devin auth status`, and parse email / plan / name; on failure, fall back to the key's last 4 chars as the label
  async identify(cred: AccountCredential): Promise<{ label: string; detail?: string }> {
    const fallback = { label: `Devin …${cred.secret.slice(-4)}` };
    const bin = await this.binary();
    if (!bin) return fallback;
    const dir = join(this.scratchDir, `whoami-${randomUUID()}`);
    try {
      await mkdir(join(dir, 'devin'), { recursive: true, mode: 0o700 });
      await writeFile(join(dir, 'devin', 'credentials.toml'), tomlOf(cred), { mode: 0o600 });
      const out = await run(bin, ['auth', 'status'], { XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir }, 20_000);
      return parseStatus(out) ?? fallback;
    } catch { return fallback; }
    finally { await rm(dir, { recursive: true, force: true }); }
  }

  async authenticate(proc: AgentProcess, cred: AccountCredential): Promise<void> {
    const methodId = proc.init.authMethods?.[0]?.id ?? 'devin-browser';
    const meta: Record<string, string> = { api_key: cred.secret };
    if (cred.meta?.api_server_url) meta.api_server_url = cred.meta.api_server_url;
    const req: acp.AuthenticateRequest = { methodId, _meta: meta };
    await proc.agent.request(acp.methods.agent.authenticate, req);
  }
}

export function dataHome(): string {
  return process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
}

// Accepts only flat toml with one `key = "value"` per line — the shape of Devin's credentials file
export async function readCredentials(file: string): Promise<AccountCredential | undefined> {
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { return undefined; }
  const kv = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (m) kv.set(m[1]!, m[2]!.replace(/\\(.)/g, '$1'));
  }
  const secret = kv.get(SECRET_KEY);
  if (!secret) return undefined;
  const meta: Record<string, string> = {};
  for (const k of TOML_KEYS) { const v = kv.get(k); if (v) meta[k] = v; }
  return { secret, meta };
}

export function tomlOf(cred: AccountCredential): string {
  const q = (v: string) => `"${v.replace(/[\\"]/g, '\\$&')}"`;
  const lines = [`${SECRET_KEY} = ${q(cred.secret)}`];
  for (const k of TOML_KEYS) if (cred.meta?.[k]) lines.push(`${k} = ${q(cred.meta[k]!)}`);
  return lines.join('\n') + '\n';
}

// `devin auth status` output is indented key-value lines like "  Email:   x@y"
export function parseStatus(out: string): { label: string; detail?: string } | undefined {
  const field = (name: string) => new RegExp(`^\\s*${name}:\\s+(.+?)\\s*$`, 'm').exec(out)?.[1];
  const email = field('Email'), name = field('Name'), tier = field('Tier') ?? field('Plan');
  if (!email && !name) return undefined;
  const detail = [tier, name && name !== email ? name : undefined].filter(Boolean).join(' · ') || undefined;
  return { label: email ?? name!, detail };
}

function run(bin: string, args: string[], env: Record<string, string>, timeout: number): Promise<string> {
  const merged = { ...process.env, ...env };
  delete merged.ACP_BACKEND;
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env: merged, timeout, maxBuffer: 1 << 20 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// Check once a second whether the file exists; give up as soon as the signal fires
async function waitFor<T>(read: () => Promise<T | undefined>, signal: AbortSignal): Promise<T | undefined> {
  while (!signal.aborted) {
    const v = await read();
    if (v) return v;
    await new Promise(r => setTimeout(r, 1000));
  }
  return undefined;
}
