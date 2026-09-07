import type { ConfigControl, SessionOption } from './transcript';

export type ModelSources = Record<string, NonNullable<SessionOption['source']>>;

// Agent-specific aliases are interpreted here; the generic model UI treats IDs as opaque.
export function applyModelSources(agent: string, controls: ConfigControl[], configured: ModelSources = {}) {
  for (const control of controls) {
    if (control.category !== 'model') continue;
    for (const option of control.options) {
      if (agent === 'kimi') {
        const slash = option.id.indexOf('/');
        if (slash < 1) continue;
        const provider = option.id.slice(0, slash);
        option.source = { id: provider, name: provider, kind: provider === 'kimi-code' ? 'official' : 'custom' };
      } else if (agent === 'grok') {
        const source = configured[option.id];
        if (source) option.source = source;
        // Known built-in aliases from Grok's modelState; a configured endpoint takes precedence.
        else if (/^grok-\d/.test(option.id) || option.id === 'grok-build') option.source = { id: 'grok', name: 'Grok', kind: 'official' };
      }
    }
  }
}
