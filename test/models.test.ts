import { describe, expect, it } from 'vitest';
import { findVariant, groupModels, parseModelName, variantLabel, visibleOptions } from '../src/shared/models';

// Real name samples issued by Devin (measured via pnpm probe devin), covering all suffix combinations
const DEVIN = [
  'Claude Opus 5 Medium', 'Claude Opus 5 Low', 'Claude Opus 5 Max', 'Claude Opus 5 Low Fast', 'Claude Opus 5 Max Fast',
  'GPT-5.6 Sol Medium Thinking', 'GPT-5.6 Sol No Thinking', 'GPT-5.6 Sol XHigh Thinking', 'GPT-5.6 Sol No Thinking Fast', 'GPT-5.6 Sol Low Thinking Fast',
  'GLM-5.2 High', 'GLM-5.2 Max 1M', 'GLM-5.2 No Thinking', 'GLM-5.2 No Thinking 1M',
  'Claude Opus 4.6', 'Claude Opus 4.6 Thinking', 'Claude Opus 4.6 1M', 'Claude Opus 4.6 Thinking 1M',
  'GPT-5.3-Codex X-High', 'GPT-5.3-Codex XHigh Fast', 'Gemini 3 Flash Minimal', 'Inkling None', 'Nemotron 3 Ultra None',
  'SWE-1.7 Max', 'SWE-1.7 Lightning Medium', 'SWE-1.6', 'SWE-1.6 Fast', 'Adaptive', 'Kimi K2.7',
];
const opts = (names: string[]) => names.map(n => ({ id: n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: n }));

describe('model name parsing', () => {
  it('suffix split: effort / Thinking / No Thinking / Fast / 1M in various combinations', () => {
    expect(parseModelName('Claude Opus 5 Low Fast')).toEqual({ family: 'Claude Opus 5', effort: 'Low', fast: true, long: false });
    expect(parseModelName('GPT-5.6 Sol No Thinking Fast')).toEqual({ family: 'GPT-5.6 Sol', effort: 'None', fast: true, long: false });
    expect(parseModelName('GPT-5.6 Sol Low Thinking')).toEqual({ family: 'GPT-5.6 Sol', effort: 'Low', fast: false, long: false });
    expect(parseModelName('GLM-5.2 No Thinking 1M')).toEqual({ family: 'GLM-5.2', effort: 'None', fast: false, long: true });
    expect(parseModelName('Claude Opus 4.6 Thinking 1M')).toEqual({ family: 'Claude Opus 4.6', effort: 'Thinking', fast: false, long: true });
    expect(parseModelName('Claude Opus 4.6')).toEqual({ family: 'Claude Opus 4.6', effort: '', fast: false, long: false });
    expect(parseModelName('GPT-5.3-Codex X-High')).toEqual({ family: 'GPT-5.3-Codex', effort: 'XHigh', fast: false, long: false });
    expect(parseModelName('Gemini 3 Flash Minimal').effort).toBe('Minimal');
    expect(parseModelName('Inkling None')).toEqual({ family: 'Inkling', effort: 'None', fast: false, long: false });
    // Lightning is not an effort word, it's another family (Devin groups it the same way)
    expect(parseModelName('SWE-1.7 Lightning Medium')).toEqual({ family: 'SWE-1.7 Lightning', effort: 'Medium', fast: false, long: false });
    expect(parseModelName('SWE-1.6 Fast')).toEqual({ family: 'SWE-1.6', effort: '', fast: true, long: false });
    // a single-word name must not be split away as pure suffix
    expect(parseModelName('Adaptive')).toEqual({ family: 'Adaptive', effort: '', fast: false, long: false });
    expect(parseModelName('Max')).toEqual({ family: 'Max', effort: '', fast: false, long: false });
  });

  it('grouping: keep first-seen order, variants sorted by strength, efforts / hasFast / hasLong aggregated', () => {
    const fams = groupModels(opts(DEVIN));
    expect(fams.map(f => f.name)).toEqual([
      'Claude Opus 5', 'GPT-5.6 Sol', 'GLM-5.2', 'Claude Opus 4.6', 'GPT-5.3-Codex', 'Gemini 3 Flash', 'Inkling', 'Nemotron 3 Ultra',
      'SWE-1.7', 'SWE-1.7 Lightning', 'SWE-1.6', 'Adaptive', 'Kimi K2.7',
    ]);
    const opus = fams[0]!;
    expect(opus.efforts).toEqual(['Low', 'Medium', 'Max']);
    expect(opus.hasFast).toBe(true);
    expect(opus.variants.map(v => v.name)).toEqual(['Claude Opus 5 Low', 'Claude Opus 5 Low Fast', 'Claude Opus 5 Medium', 'Claude Opus 5 Max', 'Claude Opus 5 Max Fast']);
    const sol = fams[1]!;
    expect(sol.efforts).toEqual(['None', 'Low', 'Medium', 'XHigh']);
    const glm = fams[2]!;
    expect(glm).toMatchObject({ efforts: ['None', 'High', 'Max'], hasFast: false, hasLong: true });
    const opus46 = fams[3]!;
    expect(opus46.efforts).toEqual(['', 'Thinking']);
    expect(fams.find(f => f.name === 'SWE-1.6')).toMatchObject({ efforts: [''], hasFast: true, hasLong: false });
  });

  it('list with no parseable structure (Grok): family count = option count', () => {
    const fams = groupModels(opts(['Grok 4.6', 'Grok 4.5', 'grok-4.6', 'grok-build']));
    expect(fams).toHaveLength(4);
    expect(fams.every(f => f.variants.length === 1)).toBe(true);
  });

  it('findVariant: exact match first, else drop 1M → Fast, finally fall back to any variant of that effort', () => {
    const [opus, , glm] = groupModels(opts(DEVIN));
    expect(findVariant(opus!, 'Max', true, false)?.name).toBe('Claude Opus 5 Max Fast');
    // Medium has no Fast version → fall back to Medium
    expect(findVariant(opus!, 'Medium', true, false)?.name).toBe('Claude Opus 5 Medium');
    // GLM High has no 1M → fall back to High; Max does
    expect(findVariant(glm!, 'High', false, true)?.name).toBe('GLM-5.2 High');
    expect(findVariant(glm!, 'Max', false, true)?.name).toBe('GLM-5.2 Max 1M');
    expect(findVariant(glm!, 'Low', false, false)).toBeUndefined();
  });

  it('variant label: effort · Fast · 1M; families without effort words use Standard', () => {
    const fams = groupModels(opts(DEVIN));
    const opus = fams[0]!, opus46 = fams[3]!, swe16 = fams.find(f => f.name === 'SWE-1.6')!, adaptive = fams.find(f => f.name === 'Adaptive')!;
    expect(variantLabel(opus.variants.find(v => v.name === 'Claude Opus 5 Max Fast')!, opus)).toBe('Max · Fast');
    expect(variantLabel(opus46.variants.find(v => v.name === 'Claude Opus 4.6 Thinking 1M')!, opus46)).toBe('Thinking · 1M');
    expect(variantLabel(opus46.variants.find(v => v.name === 'Claude Opus 4.6')!, opus46)).toBe('Standard');
    expect(variantLabel(swe16.variants.find(v => v.fast)!, swe16)).toBe('Fast');
    expect(variantLabel(swe16.variants.find(v => !v.fast)!, swe16)).toBe('Standard');
    expect(variantLabel(adaptive.variants[0]!, adaptive)).toBe('Standard');
  });

  it('hidden families: every variant of a hidden family goes, the current value stays, hiding everything hides nothing', () => {
    const all = opts(DEVIN);
    const shown = visibleOptions(all, ['GLM-5.2', 'Adaptive'], 'claude-opus-5-max');
    expect(shown.some(o => o.name.startsWith('GLM-5.2'))).toBe(false);
    expect(shown.some(o => o.name === 'Adaptive')).toBe(false);
    expect(shown).toHaveLength(all.length - 5);
    // the family in use is hidden, but its selected variant is still offered
    expect(visibleOptions(all, ['Claude Opus 5'], 'claude-opus-5-max').filter(o => o.name.startsWith('Claude Opus 5 ')).map(o => o.name)).toEqual(['Claude Opus 5 Max']);
    expect(visibleOptions(all, groupModels(all).map(f => f.name))).toBe(all);
    expect(visibleOptions(all, undefined)).toBe(all);
  });
});
