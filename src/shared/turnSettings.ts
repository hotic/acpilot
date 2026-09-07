import type { SessionControls, TurnSettings } from './transcript';

// Persist wire IDs rather than display names, including model effort variants.
export function captureTurnSettings(controls: SessionControls): TurnSettings {
  return {
    modeId: controls.modeId,
    config: Object.fromEntries(controls.options.flatMap(c => c.value === undefined ? [] : [[c.id, c.value]])),
  };
}

// Historical selections may disappear after a CLI update. Use current choices
// for unavailable values; never guess a replacement from a model's display name.
export function controlsForTurn(controls: SessionControls, settings?: TurnSettings): SessionControls {
  return {
    ...controls,
    modeId: controls.modes.some(m => m.id === settings?.modeId) ? settings!.modeId : controls.modeId,
    options: controls.options.map(c => ({
      ...c,
      value: c.options.some(o => o.id === settings?.config[c.id]) ? settings!.config[c.id] : c.value,
    })),
  };
}
