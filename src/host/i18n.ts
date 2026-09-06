import { translate, type Locale, type MsgKey, type Params } from '@shared/i18n';

// Host-side strings: one process-wide locale, set on activation and whenever acpilot.language changes.
// Only user-visible text (toasts, error texts, default titles) goes through here; log lines stay as they are
let current: Locale = 'zh-CN';

export function setHostLocale(locale: Locale) { current = locale; }
export function hostLocale(): Locale { return current; }

export function t(key: MsgKey, params?: Params): string {
  return translate(current, key, params);
}
