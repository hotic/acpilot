import { readFile } from 'node:fs/promises';
import { arch, homedir, hostname, release, type } from 'node:os';
import { join } from 'node:path';
import type { AccountQuota, LocalAccountInfo, QuotaWindow } from '@shared/transcript';
import { VERSION } from '../version';

const NAMES: Record<string, string> = { grok: 'Grok Build', kimi: 'Kimi Code' };
const MAX_AGE = 30_000;
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Json : {};
const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v.trim() : undefined;
const number = (v: unknown): number | undefined => (typeof v === 'number' || typeof v === 'string' && v.trim() !== '') && Number.isFinite(Number(v)) ? Number(v) : undefined;
const iso = (v: unknown): string | undefined => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;
const clamp = (n: number) => Math.max(0, Math.min(1, n));

// CLI-owned credentials remain on disk. Only safe identity, quota and status fields reach the webview.
// Endpoints and schemas: CodexBar docs/grok.md, docs/kimi.md and the official Kimi CLI managed-usage module.
export class LocalAccounts {
  private snapshots = new Map<string, LocalAccountInfo>();
  private checked = new Map<string, number>();
  private fetching = new Map<string, Promise<void>>();
  private listeners = new Set<() => void>();

  constructor(private options: {
    env?: (agent: string) => NodeJS.ProcessEnv;
    home?: string;
    fetch?: typeof fetch;
  } = {}) {}

  get(agent: string): LocalAccountInfo | undefined {
    return NAMES[agent] ? this.snapshots.get(agent) ?? { label: NAMES[agent], status: 'loading' } : undefined;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async refresh(agent?: string, force = false): Promise<void> {
    if (!agent) { await Promise.all(Object.keys(NAMES).map(id => this.refresh(id, force))); return; }
    if (!NAMES[agent]) return;
    const pending = this.fetching.get(agent);
    if (pending) return pending;
    if (!force && Date.now() - (this.checked.get(agent) ?? 0) < MAX_AGE) return;
    const run = (async () => {
      let account: LocalAccountInfo;
      try {
        const env = this.options.env?.(agent) ?? process.env;
        account = agent === 'grok' ? await this.grok(env) : await this.kimi(env);
      } catch {
        // Do not retain a previous account's quota after a login changes or a request fails.
        account = { label: NAMES[agent]!, status: 'unavailable' };
      }
      this.snapshots.set(agent, account);
      this.checked.set(agent, Date.now());
      for (const listener of this.listeners) listener();
    })();
    this.fetching.set(agent, run);
    try { await run; } finally { this.fetching.delete(agent); }
  }

  private async request(url: string, headers: Record<string, string>): Promise<Json> {
    const res = await (this.options.fetch ?? fetch)(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    if (!res.ok) throw new Error(`Quota HTTP ${res.status}`);
    return object(await res.json());
  }

  private async grok(env: NodeJS.ProcessEnv): Promise<LocalAccountInfo> {
    const auth = await jsonFile(join(env.GROK_HOME || join(this.options.home ?? homedir(), '.grok'), 'auth.json'));
    const entries = Object.entries(auth).filter(([key]) => key.startsWith('https://auth.x.ai::') || key === 'https://accounts.x.ai/sign-in');
    entries.sort(([a], [b]) => Number(b.startsWith('https://auth.x.ai::')) - Number(a.startsWith('https://auth.x.ai::')));
    const credential = entries.map(([, value]) => object(value)).find(value => str(value.key));
    if (!credential) return { label: NAMES.grok!, status: 'login_required' };
    const account = { label: str(credential.email) ?? NAMES.grok! };
    const expires = iso(credential.expires_at);
    if (expires && Date.parse(expires) <= Date.now()) return { ...account, status: 'expired' };
    const headers = { Authorization: `Bearer ${str(credential.key)!}`, 'x-xai-token-auth': 'xai-grok-cli' };
    const [billing, settings] = await Promise.allSettled([
      this.request('https://cli-chat-proxy.grok.com/v1/billing?format=credits', headers),
      this.request('https://cli-chat-proxy.grok.com/v1/settings', headers),
    ]);
    const quota = billing.status === 'fulfilled' ? parseGrokQuota(billing.value) : undefined;
    const detail = settings.status === 'fulfilled' ? str(settings.value.subscription_tier_display) : undefined;
    return { ...account, detail, quota, status: quota ? 'ready' : 'unavailable' };
  }

  private async kimi(env: NodeJS.ProcessEnv): Promise<LocalAccountInfo> {
    const account = { label: NAMES.kimi! };
    // Official subscription usage must not inherit an arbitrary custom model endpoint or its API key.
    if (env.KIMI_CODE_BASE_URL || env.KIMI_CODE_OAUTH_HOST || env.KIMI_OAUTH_HOST) return { ...account, status: 'unavailable' };
    const home = env.KIMI_CODE_HOME || join(this.options.home ?? homedir(), '.kimi-code');
    let token = str(env.KIMI_CODE_API_KEY);
    const headers: Record<string, string> = {};
    if (!token) {
      const credential = await jsonFile(join(home, 'credentials', 'kimi-code.json'));
      token = str(credential.access_token);
      if (!token) return { ...account, status: 'login_required' };
      const expires = number(credential.expires_at);
      if (!expires || expires * 1000 <= Date.now() + 60_000) return { ...account, status: 'expired' };
      const device = (await textFile(join(home, 'device_id')))?.trim();
      if (!device) return { ...account, status: 'unavailable' };
      const ascii = (s: string) => s.replace(/[^\x20-\x7e]/g, '').trim() || 'unknown';
      Object.assign(headers, {
        'X-Msh-Platform': 'kimi_code_cli', 'X-Msh-Version': VERSION,
        'X-Msh-Device-Name': ascii(hostname()), 'X-Msh-Device-Model': ascii(`${type()} ${release()} ${arch()}`),
        'X-Msh-Os-Version': ascii(release()), 'X-Msh-Device-Id': ascii(device), 'User-Agent': `Acpira/${VERSION}`,
      });
    }
    headers.Authorization = `Bearer ${token}`;
    const payload = await this.request('https://api.kimi.com/coding/v1/usages', headers);
    const quota = parseKimiQuota(payload);
    return { ...account, detail: kimiPlan(payload), quota, status: quota ? 'ready' : 'unavailable' };
  }
}

export function parseGrokQuota(payload: unknown): AccountQuota | undefined {
  const config = object(object(payload).config);
  const used = number(config.creditUsagePercent);
  // Omitted percentage means unknown. On-demand spending is a separate budget, not included credits.
  if (used === undefined) return undefined;
  const period = object(config.currentPeriod);
  const start = iso(period.start), end = iso(period.end);
  const days = start && end ? (Date.parse(end) - Date.parse(start)) / 86_400_000 : undefined;
  const id = days !== undefined && days >= 6 && days <= 8 ? 'weekly' : days !== undefined && days >= 27 && days <= 32 ? 'monthly' : 'credits';
  return { windows: [{ id, remaining: clamp(1 - used / 100), resetsAt: end ?? iso(config.billingPeriodEnd) }], fetchedAt: new Date().toISOString() };
}

export function parseKimiQuota(payload: unknown): AccountQuota | undefined {
  const data = object(payload);
  const windows: QuotaWindow[] = [];
  const add = (id: string, raw: unknown) => {
    const row = object(raw), limit = number(row.limit), used = number(row.used), remaining = number(row.remaining);
    if (!limit || limit < 0 || remaining === undefined && used === undefined) return;
    windows.push({ id, remaining: clamp((remaining ?? limit - used!) / limit), resetsAt: iso(row.resetTime) });
  };
  add('weekly', data.usage);
  if (Array.isArray(data.limits)) data.limits.forEach((raw, index) => {
    const entry = object(raw), window = object(entry.window);
    const duration = number(window.duration);
    const minutes = duration === undefined ? undefined : duration * ({ TIME_UNIT_MINUTE: 1, TIME_UNIT_HOUR: 60, TIME_UNIT_DAY: 1440, TIME_UNIT_WEEK: 10080 }[String(window.timeUnit)] ?? NaN);
    const id = minutes === 300 ? '5h' : minutes === 1440 ? 'daily' : minutes === 10080 ? 'weekly' : minutes && Number.isFinite(minutes) ? `${minutes} min` : `limit ${index + 1}`;
    add(windows.some(w => w.id === id) ? `${id} ${index + 1}` : id, entry.detail);
  });
  return windows.length ? { windows, fetchedAt: new Date().toISOString() } : undefined;
}

function kimiPlan(payload: Json): string | undefined {
  const level = str(object(object(payload.user).membership).level);
  if (!level || level === 'LEVEL_UNSPECIFIED') return undefined;
  if (payload.version !== undefined && payload.version !== 'GOODS_VERSION_V1') return level;
  return ({ LEVEL_FREE: 'Adagio', LEVEL_TRIAL: 'Andante', LEVEL_BASIC: 'Moderato', LEVEL_INTERMEDIATE: 'Allegretto', LEVEL_ADVANCED: 'Allegro' } as Record<string, string>)[level] ?? level;
}

async function textFile(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch { return undefined; }
}

async function jsonFile(path: string): Promise<Json> {
  const text = await textFile(path);
  try { return text ? object(JSON.parse(text)) : {}; } catch { return {}; }
}
