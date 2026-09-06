import { createContext, useContext } from 'react';
import { translate, zhCN, type Locale, type MsgKey, type Params } from '@shared/i18n';

// Webview strings. Components read `t` from module state (no prop threading through twenty components);
// the root remounts the tree with key={locale} when the host pushes a new locale, so every render sees the new dictionary.
// LocaleContext exists for the rare component that needs to know the locale itself (date formatting)
let current: Locale = 'zh-CN';

export function setLocale(locale: Locale) { current = locale; }
export function getLocale(): Locale { return current; }

export function t(key: MsgKey, params?: Params): string {
  return translate(current, key, params);
}

// For keys built at runtime (e.g. `notice.method.<agent>:<methodId>`): the translation when the dictionary knows the key, otherwise the fallback text
export function tOr(key: string, fallback: string, params?: Params): string {
  return key in zhCN ? translate(current, key as MsgKey, params) : fallback;
}

export const LocaleContext = createContext<Locale>('zh-CN');
export const useLocale = () => useContext(LocaleContext);
