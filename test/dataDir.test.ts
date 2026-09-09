import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileVault, MemoryVault, accountSecretKey } from '../src/host/accounts/AccountStore';
import { acpiraHome, migrateOnce } from '../src/host/store/dataDir';

function tmp() { return mkdtempSync(join(tmpdir(), 'acpira-home-')); }

describe('acpiraHome', () => {
  it('uses ACPIRA_HOME when non-empty, otherwise ~/.acpira', () => {
    expect(acpiraHome({}, '/home/u')).toBe(join('/home/u', '.acpira'));
    expect(acpiraHome({ ACPIRA_HOME: '' }, '/home/u')).toBe(join('/home/u', '.acpira'));
    expect(acpiraHome({ ACPIRA_HOME: '  ' }, '/home/u')).toBe(join('/home/u', '.acpira'));
    expect(acpiraHome({ ACPIRA_HOME: '/tmp/iso' }, '/home/u')).toBe('/tmp/iso');
    expect(acpiraHome({ ACPIRA_HOME: '  /tmp/iso  ' }, '/home/u')).toBe('/tmp/iso');
    expect(acpiraHome({ ACPIRA_HOME: 'rel' }, '/home/u')).toBe(resolve('rel'));
  });
});

describe('migrateOnce', () => {
  it('copies accounts, sessions (not scratch) and secrets into an empty dest and writes .migrated', async () => {
    const from = tmp();
    const to = tmp();
    mkdirSync(join(from, 'sessions', 's1'), { recursive: true });
    mkdirSync(join(from, 'scratch', 'login-x'), { recursive: true });
    const accounts = [{ id: 'a1', agent: 'devin', label: 'a@x.io', addedAt: '2026-01-01T00:00:00.000Z' }];
    writeFileSync(join(from, 'accounts.json'), JSON.stringify(accounts));
    writeFileSync(join(from, 'sessions', 'index.json'), JSON.stringify([{ id: 's1' }]));
    writeFileSync(join(from, 'sessions', 'prefs.json'), JSON.stringify({ lastSettings: {} }));
    writeFileSync(join(from, 'sessions', 's1.json'), JSON.stringify({ id: 's1', title: 'hello' }));
    writeFileSync(join(from, 'sessions', 's1', 'blob.txt'), 'img');
    writeFileSync(join(from, 'scratch', 'login-x', 'keep.txt'), 'no');
    const oldVault = new MemoryVault();
    await oldVault.store(accountSecretKey('a1'), 'sec');
    const logs: string[] = [];
    const newVault = new FileVault(join(to, 'secrets.json'));
    await migrateOnce({ from, to, oldVault, newVault, log: l => logs.push(l) });
    expect(existsSync(join(to, '.migrated'))).toBe(true);
    expect(JSON.parse(readFileSync(join(to, 'accounts.json'), 'utf8'))).toEqual(accounts);
    expect(JSON.parse(readFileSync(join(to, 'sessions', 's1.json'), 'utf8')).title).toBe('hello');
    expect(readFileSync(join(to, 'sessions', 's1', 'blob.txt'), 'utf8')).toBe('img');
    expect(existsSync(join(to, 'sessions', 'prefs.json'))).toBe(true);
    expect(existsSync(join(to, 'scratch'))).toBe(false);
    expect(await newVault.get(accountSecretKey('a1'))).toBe('sec');
    expect(existsSync(join(from, 'accounts.json'))).toBe(true);
    expect(logs.some(l => l.includes('Migrated'))).toBe(true);

    await migrateOnce({ from, to, oldVault, newVault, log: l => logs.push(l) });
    expect(logs.filter(l => l.includes('Migrated'))).toHaveLength(1);
  });

  it('skips the copy when .migrated already exists', async () => {
    const from = tmp();
    const to = tmp();
    writeFileSync(join(from, 'accounts.json'), JSON.stringify([{ id: 'a1' }]));
    writeFileSync(join(to, '.migrated'), 'already\n');
    await migrateOnce({ from, to, oldVault: new MemoryVault(), newVault: new MemoryVault() });
    expect(existsSync(join(to, 'accounts.json'))).toBe(false);
    expect(readFileSync(join(to, '.migrated'), 'utf8')).toBe('already\n');
  });

  it('stamps .migrated without copying when the dest already has data', async () => {
    const from = tmp();
    const to = tmp();
    writeFileSync(join(from, 'accounts.json'), JSON.stringify([{ id: 'from' }]));
    writeFileSync(join(to, 'accounts.json'), JSON.stringify([{ id: 'keep' }]));
    await migrateOnce({ from, to, oldVault: new MemoryVault(), newVault: new MemoryVault() });
    expect(existsSync(join(to, '.migrated'))).toBe(true);
    expect(JSON.parse(readFileSync(join(to, 'accounts.json'), 'utf8'))).toEqual([{ id: 'keep' }]);
  });

  it('stamps .migrated without copying when there is no legacy data', async () => {
    const from = tmp();
    const to = tmp();
    await migrateOnce({ from, to, oldVault: new MemoryVault(), newVault: new MemoryVault() });
    expect(existsSync(join(to, '.migrated'))).toBe(true);
    expect(existsSync(join(to, 'accounts.json'))).toBe(false);
  });

  it('does not write .migrated when the copy fails, then retries', async () => {
    const from = tmp();
    const to = tmp();
    mkdirSync(join(from, 'sessions'), { recursive: true });
    writeFileSync(join(from, 'accounts.json'), JSON.stringify([{ id: 'a1', agent: 'devin', label: 'a', addedAt: '2026-01-01T00:00:00.000Z' }]));
    writeFileSync(join(from, 'sessions', 'index.json'), '[]');
    chmodSync(join(from, 'sessions'), 0o000);
    const logs: string[] = [];
    try {
      await migrateOnce({ from, to, oldVault: new MemoryVault(), newVault: new MemoryVault(), log: l => logs.push(l) });
      expect(existsSync(join(to, '.migrated'))).toBe(false);
      expect(logs.some(l => l.includes('failed'))).toBe(true);
    } finally {
      chmodSync(join(from, 'sessions'), 0o755);
    }
    await migrateOnce({ from, to, oldVault: new MemoryVault(), newVault: new MemoryVault() });
    expect(existsSync(join(to, '.migrated'))).toBe(true);
    expect(existsSync(join(to, 'sessions', 'index.json'))).toBe(true);
  });
});
