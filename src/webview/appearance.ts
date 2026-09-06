import { createContext, useContext } from 'react';
import { BASE_APPEARANCE, type Appearance } from '@shared/appearance';

export * from '@shared/appearance';

// Structural axes are read from context by components; token-type axes go to CSS via data-* attributes
export function appearanceDataAttrs(a: Appearance) {
  return {
    'data-density': a.density,
    'data-radius': a.radius,
    'data-surface': a.surface,
    'data-font': a.font,
    'data-accent': a.accent,
    'data-motion': a.motion,
  } as const;
}

export const AppearanceContext = createContext<Appearance>(BASE_APPEARANCE);
export const useAppearance = () => useContext(AppearanceContext);

// Temporary LAB axis, delete once finalized. Default value = current behavior; the production App provides no provider, only LAB pages switch it
export interface Lab {
  // Line folding style: none lays everything flat / cursor folds runs of read-only actions into one row / codex folds a whole message's lines into one row after the turn ends
  fold: 'none' | 'cursor' | 'codex';
  // Kimi-style timeline: a dashed hairline runs down the lead-slot column through a fold's expanded body (icon mode only)
  timeline: boolean;
}
export const BASE_LAB: Lab = { fold: 'none', timeline: false };
export const LabContext = createContext<Lab>(BASE_LAB);
export const useLab = () => useContext(LabContext);
