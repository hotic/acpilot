import { describe, expect, it } from 'vitest';
import { en, LOCALES, resolveLocale, translate, zhCN } from '../src/shared/i18n';

describe('i18n dictionaries', () => {
  it('every locale has exactly the zh-CN key set, no empty strings', () => {
    const keys = Object.keys(zhCN).sort();
    expect(Object.keys(en).sort()).toEqual(keys);
    for (const dict of [zhCN, en] as Record<string, string>[]) for (const k of keys) expect(dict[k], k).toBeTruthy();
  });
  it('placeholders match between locales', () => {
    const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const k of Object.keys(zhCN) as (keyof typeof zhCN)[]) expect(holes(en[k]), k).toEqual(holes(zhCN[k]));
  });
  it('translate fills params and leaves unknown holes alone', () => {
    expect(translate('zh-CN', 'session.deleted', { title: 'x' })).toBe('已删除「x」');
    expect(translate('en', 'turns.readFiles', { n: 3 })).toBe('Read 3 files');
    expect(translate('en', 'host.doing', { verb: 'Read' })).toBe('Read {target}');
  });
  it('resolveLocale: explicit wins, auto follows the host language, unknown → en', () => {
    expect(resolveLocale('en', 'zh-cn')).toBe('en');
    expect(resolveLocale('auto', 'zh-cn')).toBe('zh-CN');
    expect(resolveLocale('auto', 'zh-TW')).toBe('zh-CN');
    expect(resolveLocale('auto', 'en-US')).toBe('en');
    expect(resolveLocale(undefined, undefined)).toBe('en');
    expect(LOCALES).toEqual(['zh-CN', 'en']);
  });
});
