import { zhCN } from './zh-CN';
import { en } from './en';
import type { MsgKey } from './keys';

export type { MsgKey } from './keys';

// Locales the UI ships; `auto` (the acpilot.language setting's default) follows the host's display language
export type Locale = 'zh-CN' | 'en';
export type Language = 'auto' | Locale;
export const LOCALES: Locale[] = ['zh-CN', 'en'];
export const LANGUAGES: Language[] = ['auto', ...LOCALES];

export type Params = Record<string, string | number>;

const DICTS: Record<Locale, Record<MsgKey, string>> = { 'zh-CN': zhCN, en };

// Looks the key up in the locale, falls back to zh-CN, then to the key itself; {name} placeholders are filled from params
export function translate(locale: Locale, key: MsgKey, params?: Params): string {
  const s = DICTS[locale][key] ?? zhCN[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

// Maps the setting plus the host's display language (vscode.env.language / navigator.language, e.g. "zh-cn", "en-US") onto a shipped locale
export function resolveLocale(language: Language | undefined, hostLanguage: string | undefined): Locale {
  if (language && language !== 'auto') return language;
  return (hostLanguage ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function isLocale(v: unknown): v is Locale {
  return typeof v === 'string' && (LOCALES as string[]).includes(v);
}

export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && (LANGUAGES as string[]).includes(v);
}

export { zhCN, en };
