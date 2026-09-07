import { describe, expect, it } from 'vitest';
import { captureTurnSettings, controlsForTurn } from '../src/shared/turnSettings';
import type { SessionControls } from '../src/shared/transcript';

const controls: SessionControls = {
  modes: [{ id: 'default', name: 'Agent' }, { id: 'plan', name: 'Plan' }], modeId: 'default',
  options: [{ id: 'model', category: 'model', name: 'Model', value: 'official/k3', options: [
    { id: 'official/k3', name: 'K3' }, { id: 'custom/k3', name: 'K3' },
  ] }, { id: 'effort', name: 'Effort', value: 'high', options: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] }],
};

describe('historical turn selections', () => {
  it('keeps source IDs distinct and edits settings without changing the live controls', () => {
    const saved = { modeId: 'plan', config: { model: 'custom/k3', effort: 'low' } };
    const editor = controlsForTurn(controls, saved);
    expect(captureTurnSettings(editor)).toEqual(saved);
    editor.options[0]!.value = 'official/k3';
    expect(saved.config.model).toBe('custom/k3');
    expect(controls.modeId).toBe('default');
    expect(controls.options[1]!.value).toBe('high');
  });

  it('uses live defaults for old records and unavailable historical values', () => {
    expect(controlsForTurn(controls)).toEqual(controls);
    expect(controlsForTurn(controls, { modeId: 'removed', config: { model: 'removed', effort: 'removed' } })).toEqual(controls);
  });
});
