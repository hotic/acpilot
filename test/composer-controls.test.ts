import { describe, expect, it } from 'vitest';
import { composerControls, effortOptions, familyLabel } from '../src/shared/composerControls';
import { groupModels } from '../src/shared/models';
import type { ConfigControl } from '../src/shared/transcript';

describe('shared composer controls', () => {
  it('keeps native Kimi reasoning out of model-name grouping', () => {
    const thinking: ConfigControl = {
      id: 'thinking', name: 'Thinking', category: 'thought_level', value: 'high',
      options: ['Low', 'High', 'Max'].map(name => ({ id: name.toLowerCase(), name: `Thinking ${name}` })),
    };
    const model: ConfigControl = { id: 'model', name: 'Model', category: 'model', options: [{ id: 'asgard/kimi-k3', name: 'K3' }] };
    expect(composerControls([model, thinking])).toEqual({ models: [model], reasoning: [thinking], other: [] });
    expect(composerControls([{ ...thinking, category: undefined }]).reasoning).toHaveLength(1);
  });

  it('normalizes and orders Grok labels while preserving exact wire IDs', () => {
    expect(effortOptions([
      { id: 'xhigh', name: 'Extra High Effort' },
      { id: 'opaque-high', name: 'High Effort' },
      { id: 'low', name: 'Low Effort' },
      { id: 'vendor-auto', name: 'Adaptive budget' },
    ])).toEqual([
      { id: 'low', name: 'Low' },
      { id: 'opaque-high', name: 'High' },
      { id: 'xhigh', name: 'XHigh' },
      { id: 'vendor-auto', name: 'Adaptive budget' },
    ]);
  });

  it('settings thinking rows drop Effort without changing hide keys', () => {
    const control: ConfigControl = {
      id: 'reasoning_effort', name: 'Reasoning', category: 'thought_level',
      options: [
        { id: 'xhigh', name: 'Extra High Effort' },
        { id: 'high', name: 'High Effort' },
        { id: 'medium', name: 'Medium Effort' },
        { id: 'low', name: 'Low Effort' },
      ],
    };
    const families = groupModels(control.options);
    expect(families.map(f => f.name)).toEqual(['Extra High Effort', 'High Effort', 'Medium Effort', 'Low Effort']);
    expect(families.map(f => familyLabel(control, f))).toEqual(['XHigh', 'High', 'Medium', 'Low']);
  });

  it('retains legacy Devin model variants and respects explicit custom categories', () => {
    const model: ConfigControl = { id: 'legacy', name: 'Model', options: [
      { id: 'penguin-medium', name: 'Penguin Medium' }, { id: 'penguin-max', name: 'Penguin Max' },
    ] };
    const custom = { ...model, id: 'custom', category: 'custom' };
    expect(composerControls([model, custom])).toEqual({ models: [model], reasoning: [], other: [custom] });
  });
});
