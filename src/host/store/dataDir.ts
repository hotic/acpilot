import { access, chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { accountSecretKey, type SecretVault } from '../accounts/AccountStore';
import { msg } from '../errors';

const MARKER = '.migrated';
const INFLIGHT = '.migrating';

// ACPIRA_HOME when set (tests, isolated profiles); otherwise ~/.acpira. Shared by Cursor, VS Code, and a future standalone app.
export function acpiraHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env.ACPIRA_HOME?.trim();
  if (override) return resolve(override);
  return join(home, '.acpira');
}

export interface MigrateOnceOpts {
  from: string;
  to: string;
  oldVault: SecretVault;
  newVault: SecretVault;
  log?: (line: string) => void;
}

// One-shot copy from VS Code globalStorage + SecretStorage into ~/.acpira. The old tree is left in place.
// .migrating stays if a copy fails so a partial dest is not mistaken for "already in use" on the next launch.
export async function migrateOnce(opts: MigrateOnceOpts): Promise<void> {
  const { from, to, oldVault, newVault, log = () => {} } = opts;
  await mkdir(to, { recursive: true, mode: 0o700 });
  try { await chmod(to, 0o700); } catch { /* Windows */ }

  if (await exists(join(to, MARKER))) return;

  const inflight = await exists(join(to, INFLIGHT));
  if (!inflight && (await exists(join(to, 'accounts.json')) || await exists(join(to, 'sessions', 'index.json')))) {
    await stamp(to);
    return;
  }

  if (!await exists(join(from, 'accounts.json')) && !await exists(join(from, 'sessions'))) {
    await stamp(to);
    return;
  }

  try {
    await writeFile(join(to, INFLIGHT), '');
    await copyData(from, to, oldVault, newVault);
    await stamp(to);
    await rm(join(to, INFLIGHT), { force: true });
    log(`Migrated session and account data to ${to}`);
  } catch (e) {
    log(`Migration to ${to} failed (${msg(e)}); will retry on next start`);
  }
}

async function stamp(to: string) {
  await writeFile(join(to, MARKER), `${new Date().toISOString()}\n`);
}

async function copyData(from: string, to: string, oldVault: SecretVault, newVault: SecretVault) {
  const accFrom = join(from, 'accounts.json');
  if (await exists(accFrom)) await copyFile(accFrom, join(to, 'accounts.json'));

  const sessFrom = join(from, 'sessions');
  if (await exists(sessFrom)) {
    const sessTo = join(to, 'sessions');
    await rm(sessTo, { recursive: true, force: true });
    await cp(sessFrom, sessTo, { recursive: true });
  }

  await copySecrets(accFrom, oldVault, newVault);
}

async function copySecrets(accountsFile: string, oldVault: SecretVault, newVault: SecretVault) {
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(accountsFile, 'utf8')); }
  catch { return; }
  if (!Array.isArray(parsed)) return;
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || typeof (item as { id?: unknown }).id !== 'string') continue;
    const key = accountSecretKey((item as { id: string }).id);
    const secret = await oldVault.get(key);
    if (secret !== undefined) await newVault.store(key, secret);
  }
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; }
  catch { return false; }
}
