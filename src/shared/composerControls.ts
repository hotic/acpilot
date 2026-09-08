import type { ConfigControl, SessionOption } from './transcript';
import { groupModels } from './models';

const LEVELS = ['None', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max', 'Thinking'];

// Normalize presentation only; the original option IDs remain the wire values.
export function effortLabel(option: SessionOption): string {
  const canonical = (value: string) => {
    const key = value.toLowerCase().replace(/(?:reasoning|thinking|effort|level)/g, '').replace(/[\s_-]/g, '');
    return key === 'extrahigh' ? 'XHigh' : LEVELS.find(level => level.toLowerCase() === key);
  };
  return canonical(option.id) ?? canonical(option.name) ?? option.name;
}

export function effortOptions(options: SessionOption[]): SessionOption[] {
  const rank = (name: string) => { const i = LEVELS.indexOf(name); return i < 0 ? LEVELS.length : i; };
  return options.map(o => ({ ...o, name: effortLabel(o) })).sort((a, b) => rank(a.name) - rank(b.name));
}

// ACP capabilities choose the contents of one composer, never its layout.
// Recognize legacy reasoning IDs before applying model-name decomposition.
export function composerControls(options: ConfigControl[]) {
  const models: ConfigControl[] = [], reasoning: ConfigControl[] = [], other: ConfigControl[] = [];
  for (const c of options) {
    if (c.category === 'thought_level' || (!c.category && /^(reasoning_effort|thought_level|thinking|thinking_level)$/.test(c.id))) reasoning.push(c);
    else if (c.category === 'model' || (!c.category && (c.id === 'model' || groupModels(c.options).length < c.options.length))) models.push(c);
    else other.push(c);
  }
  return { models, reasoning, other };
}
