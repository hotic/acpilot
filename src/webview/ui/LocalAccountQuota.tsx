import type { LocalAccountInfo } from '@shared/transcript';
import { t } from '../i18n';
import { QuotaBars } from './QuotaBars';

export function LocalAccountQuota({ account }: { account: LocalAccountInfo }) {
  return account.quota
    ? <QuotaBars quota={account.quota} />
    : <span className="pt-1 text-3 text-fg-2">{t(`quota.status.${account.status}`)}</span>;
}
