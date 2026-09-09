import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAccounts, parseGrokQuota, parseKimiQuota } from '../src/host/accounts/local';

const reset = '2026-10-01T00:00:00Z';
describe('official quota parsing', () => {
  it('keeps missing Grok percentages unknown, including separate on-demand balances', () => {
    expect(parseGrokQuota({ config: { currentPeriod: { end: reset }, onDemandCap: { val: 100 }, onDemandUsed: { val: 0 } } })).toBeUndefined();
    expect(parseGrokQuota({ config: { creditUsagePercent: null } })).toBeUndefined();
    expect(parseGrokQuota({ config: { creditUsagePercent: 0 } })?.windows[0]?.remaining).toBe(1);
  });
  it('uses the actual Grok period length and authoritative reset', () => {
    const quota = parseGrokQuota({ config: { creditUsagePercent: 25, currentPeriod: { start: '2026-09-01T00:00:00Z', end: reset } } });
    expect(quota?.windows).toEqual([{ id: 'monthly', remaining: 0.75, resetsAt: new Date(reset).toISOString() }]);
    expect(parseGrokQuota({ config: { creditUsagePercent: 125 } })?.windows[0]?.remaining).toBe(0);
  });
  it('reads Kimi weekly and 5-hour limits, including explicit exhaustion', () => {
    const quota = parseKimiQuota({ usage: { limit: '1000', used: '100', remaining: '900', resetTime: reset }, limits: [
      { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '200', remaining: '0', resetTime: reset } },
    ] });
    expect(quota?.windows.map(w => [w.id, w.remaining])).toEqual([['weekly', 0.9], ['5h', 0]]);
    expect(quota?.windows.every(w => w.resetsAt === new Date(reset).toISOString())).toBe(true);
  });
  it('does not turn missing or invalid Kimi data into full allowance', () => {
    for (const usage of [{}, { limit: 0, used: 0 }, { limit: 100 }, { limit: 100, remaining: null }, { limit: 'NaN', used: 1 }]) {
      expect(parseKimiQuota({ usage })).toBeUndefined();
    }
    expect(parseKimiQuota({ usage: { limit: 100, used: 120, resetTime: 'invalid' } })?.windows).toEqual([{ id: 'weekly', remaining: 0, resetsAt: undefined }]);
  });
});

describe('CLI account monitor', () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'acpira-local-quota-')); });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });
  async function save(path: string, value: unknown) {
    const file = join(home, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
  it('reports missing and expired logins without network requests or credential writes', async () => {
    const fetcher = vi.fn();
    const local = new LocalAccounts({ home, env: () => ({}), fetch: fetcher });
    await local.refresh();
    expect(local.get('grok')?.status).toBe('login_required');
    await save('.kimi-code/credentials/kimi-code.json', { access_token: 'expired-secret', expires_at: 0 });
    await local.refresh('kimi', true);
    expect(local.get('kimi')?.status).toBe('expired');
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(local.get('kimi'))).not.toContain('secret');
  });
  it('deduplicates requests, uses the captured Grok identity, and clears stale quota on failure', async () => {
    await save('.grok/auth.json', { 'https://auth.x.ai::cli': { key: 'local-secret', email: 'one@example.com', expires_at: '2099-01-01T00:00:00Z' } });
    const fetcher = vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).includes('/settings') ? { subscription_tier_display: 'SuperGrok' } : { config: { creditUsagePercent: 30 } })));
    const local = new LocalAccounts({ home, env: () => ({}), fetch: fetcher });
    const changed = vi.fn(); local.subscribe(changed);
    await Promise.all([local.refresh('grok'), local.refresh('grok')]);
    await local.refresh('grok');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledOnce();
    expect(local.get('grok')).toMatchObject({ label: 'one@example.com', detail: 'SuperGrok', status: 'ready' });
    expect(JSON.stringify(local.get('grok'))).not.toContain('local-secret');
    await save('.grok/auth.json', { 'https://auth.x.ai::cli': { key: 'second-secret', email: 'two@example.com' } });
    fetcher.mockResolvedValue(new Response('{}', { status: 503 }));
    await local.refresh('grok', true);
    expect(local.get('grok')).toMatchObject({ label: 'two@example.com', status: 'unavailable' });
    expect(local.get('grok')?.quota).toBeUndefined();
  });
  it('reads Kimi API key usage only at the official endpoint and preserves membership', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ usage: { limit: '100', used: '20' }, user: { membership: { level: 'LEVEL_BASIC' } } })));
    const env = { KIMI_CODE_API_KEY: 'code-secret' };
    const local = new LocalAccounts({ home, env: () => env, fetch: fetcher });
    await local.refresh('kimi');
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.kimi.com/coding/v1/usages');
    expect(local.get('kimi')).toMatchObject({ detail: 'Moderato', status: 'ready' });
    expect(JSON.stringify(local.get('kimi'))).not.toContain('code-secret');
    const custom = new LocalAccounts({ home, env: () => ({ ...env, KIMI_CODE_BASE_URL: 'https://custom.example' }), fetch: fetcher });
    await custom.refresh('kimi');
    expect(custom.get('kimi')?.status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('uses the Kimi CLI device identity with its fresh OAuth credential', async () => {
    await save('.kimi-code/credentials/kimi-code.json', { access_token: 'oauth-secret', expires_at: 4070908800 });
    await writeFile(join(home, '.kimi-code/device_id'), 'test-device');
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ usage: { limit: 100, remaining: 40 } })));
    const local = new LocalAccounts({ home, env: () => ({}), fetch: fetcher });
    await local.refresh('kimi');
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer oauth-secret', 'X-Msh-Device-Id': 'test-device', 'X-Msh-Platform': 'kimi_code_cli' });
    expect(local.get('kimi')?.quota?.windows[0]?.remaining).toBe(0.4);
  });
});
