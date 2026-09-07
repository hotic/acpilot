import type { AccountQuota, QuotaWindow } from '@shared/transcript';
import { cn } from './cn';
import { t, tOr } from '../i18n';

// Remaining allowance below this reads as running low (warn), at zero as exhausted (danger); above it the bar stays neutral
const LOW = 0.2;

// One hairline per allowance window: [window label] [track with the remaining share filled] [percent]. Devin Max has a weekly window only,
// Pro adds a daily one, so the count is data-driven rather than a fixed pair. A three-column grid keeps the tracks aligned when the labels
// differ in width. The reset time lives in the tooltip; the rows are text-3 so they sit under a label / description pair without competing
export function QuotaBars({ quota, className }: { quota: AccountQuota; className?: string }) {
  if (!quota.windows.length) return null;
  return (
    <span
      role="img"
      aria-label={quota.windows.map(w => t('quota.aria', { window: windowLabel(w.id), pct: Math.round(w.remaining * 100) })).join(t('common.listSep'))}
      className={cn('grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 pt-0.5 text-3 text-fg-3 tabular-nums', className)}
    >
      {quota.windows.map(w => <QuotaBar key={w.id} window={w} />)}
    </span>
  );
}

function QuotaBar({ window: w }: { window: QuotaWindow }) {
  const pct = Math.round(w.remaining * 100);
  const label = windowLabel(w.id);
  const time = w.resetsAt ? fmtUntil(w.resetsAt) : undefined;
  const hint = time ? t('quota.hint', { window: label, pct, time }) : t('quota.hintNoReset', { window: label, pct });
  return (
    <span className="contents" title={hint}>
      <span>{label}</span>
      <span className="h-1 overflow-hidden rounded-full bg-active">
        <span
          className={cn('block h-full rounded-full', w.remaining <= 0 ? 'bg-danger' : w.remaining <= LOW ? 'bg-warn' : 'bg-fg-3')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span>{pct}%</span>
    </span>
  );
}

// Compact one-line summary for tooltips ("Weekly 94%"); several windows joined with a middle dot
export function quotaSummary(quota: AccountQuota): string {
  return quota.windows.map(w => `${windowLabel(w.id)} ${Math.round(w.remaining * 100)}%`).join(' · ');
}

// Window ids come from the provider; the known ones are translated, anything else is shown as sent
function windowLabel(id: string): string {
  return tOr(`quota.window.${id}`, id);
}

// Coarse time left until a reset, one unit only (minutes under an hour, hours under a day, otherwise days)
function fmtUntil(iso: string): string {
  const ms = Math.max(0, Date.parse(iso) - Date.now());
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return t('quota.time.minutes', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('quota.time.hours', { n: hours });
  return t('quota.time.days', { n: Math.round(hours / 24) });
}
