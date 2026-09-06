import type { SessionOption } from './transcript';

// Reconstructing the model list: Devin flattens the cartesian product of "model × reasoning effort × Fast × 1M" into 210 flat options
// (no grouping, and no separate thought_level configOption; _meta only has supportsImages), so the structure can only be recovered
// from the names.
// Name pattern: <family> [effort] [Thinking] [Fast] [1M]; see parseModelName for how effort words combine with Thinking.
// When no structure can be parsed (Grok's 4 monolithic names), groupModels yields family count = option count, and callers just render flat as before

export interface ModelVariant {
  // Option value of the configOption; required when calling set_config_option
  id: string;
  name: string;
  // Reasoning effort label: None / Minimal / Low / Medium / High / XHigh / Max / Thinking; '' means this dimension is absent (Standard)
  effort: string;
  fast: boolean;
  // 1M context variant
  long: boolean;
}

export interface ModelFamily {
  name: string;
  variants: ModelVariant[];
  // Effort labels sorted by strength (deduplicated)
  efforts: string[];
  hasFast: boolean;
  hasLong: boolean;
}

// Effort word → unified label (both X-High and XHigh spellings occur)
const LEVEL: Record<string, string> = {
  none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', 'x-high': 'XHigh', max: 'Max',
};
const EFFORT_ORDER = ['', 'Thinking', 'None', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'];

export function parseModelName(name: string): Omit<ModelVariant, 'id' | 'name'> & { family: string } {
  const t = name.trim().split(/\s+/);
  let fast = false, long = false, thinking = false, effort = '';
  // Strip suffixes first: Fast / 1M may both be present, in either order
  for (;;) {
    const last = t[t.length - 1]?.toLowerCase();
    if (t.length > 1 && last === 'fast') { fast = true; t.pop(); }
    else if (t.length > 1 && last === '1m') { long = true; t.pop(); }
    else break;
  }
  if (t.length > 1 && t[t.length - 1]!.toLowerCase() === 'thinking') { thinking = true; t.pop(); }
  const last = t[t.length - 1]!.toLowerCase();
  if (t.length > 1 && last in LEVEL) { effort = LEVEL[last]!; t.pop(); }
  else if (t.length > 1 && last === 'no' && thinking) { effort = 'None'; thinking = false; t.pop(); }
  // For names like "Claude Opus 4.6 Thinking" with no effort word, just a toggle, Thinking itself counts as a level
  if (!effort && thinking) effort = 'Thinking';
  return { family: t.join(' '), effort, fast, long };
}

export function groupModels(options: SessionOption[]): ModelFamily[] {
  const map = new Map<string, ModelFamily>();
  for (const o of options) {
    const p = parseModelName(o.name);
    let f = map.get(p.family);
    if (!f) { f = { name: p.family, variants: [], efforts: [], hasFast: false, hasLong: false }; map.set(p.family, f); }
    f.variants.push({ id: o.id, name: o.name, effort: p.effort, fast: p.fast, long: p.long });
  }
  const rank = (e: string) => { const i = EFFORT_ORDER.indexOf(e); return i < 0 ? EFFORT_ORDER.length : i; };
  for (const f of map.values()) {
    f.variants.sort((a, b) => rank(a.effort) - rank(b.effort) || Number(a.fast) - Number(b.fast) || Number(a.long) - Number(b.long));
    f.efforts = [...new Set(f.variants.map(v => v.effort))];
    f.hasFast = f.variants.some(v => v.fast);
    f.hasLong = f.variants.some(v => v.long);
  }
  return [...map.values()];
}

// Find a variant: exact match first; otherwise drop 1M → Fast → both in turn, finally fall back to the first variant at that effort
export function findVariant(f: ModelFamily, effort: string, fast: boolean, long: boolean): ModelVariant | undefined {
  const hit = (fa: boolean, lo: boolean) => f.variants.find(v => v.effort === effort && v.fast === fa && v.long === lo);
  return hit(fast, long) ?? hit(fast, false) ?? hit(false, long) ?? hit(false, false) ?? f.variants.find(v => v.effort === effort);
}

// Text on the params chip: "Max · Fast · 1M"; when the family has an effort dimension but this variant has no effort word, call it Standard; also Standard when there's nothing at all
export function variantLabel(v: ModelVariant, f: ModelFamily): string {
  const parts = [v.effort || (f.efforts.length > 1 ? 'Standard' : ''), v.fast && 'Fast', v.long && '1M'].filter(Boolean);
  return parts.join(' · ') || 'Standard';
}
