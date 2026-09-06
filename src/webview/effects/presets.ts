import type { OrbState } from 'thinking-orbs';
import type { Appearance } from '../appearance';

// All parameters for the Libraries.dev trio live here; props exported from Studio get pasted straight in

// The Orb appears in only two places: Thinking streaming (think) and session connecting (fetch); in-progress tool lines get no Orb, just shimmer
export type OrbKind = 'think' | 'fetch';
export const ORB_STATE: Record<OrbKind, OrbState> = {
  think: 'breathing',
  fetch: 'connecting',
};

export const ORB_SIZE = 20 as const;
export const ORB_SPEED: Record<Appearance['motion'], number> = { none: 1, subtle: 1, full: 1.25 };

export const BEAM_SIZE: Record<Exclude<Appearance['beam'], 'none'>, 'md' | 'line' | 'pulse-inner'> = {
  full: 'md',
  line: 'line',
  pulse: 'pulse-inner',
};
export const BEAM_STRENGTH: Record<Appearance['motion'], number> = { none: 0, subtle: 0.8, full: 1 };
export const BEAM_BRIGHTNESS: Record<Appearance['motion'], number | undefined> = { none: undefined, subtle: undefined, full: 1.5 };

// Send button's metal mode: metal-fx's silver ring; the button variant reads the child's radius (--r-md), 1px ring
export const METAL_PRESET = 'silver' as const;
export const METAL_VARIANT = 'button' as const;
