import { createContext, useContext } from 'react';

// Layout axes of the settings surface while it is being picked in the LAB (#page=settings). Each axis is one independent decision;
// the components read the current combination from LayoutContext. Once a combination is settled the losing branches go and this file with them

// How the pages (General / one per agent) are reached in a 380-wide sidebar
export type SwitchStyle = 'strip' | 'home' | 'rail';
// The identity block at the top of an agent page
export type HeadStyle = 'hero' | 'bar' | 'facts';
// How the four inventory sections (MCP / skills / rules / config) are reached
export type NavStyle = 'pills' | 'tabs' | 'stack' | 'fold';
// How a group of rows is titled
export type SectionStyle = 'heading' | 'label' | 'inset';
// How much rides at a row's right edge
export type TrailingStyle = 'tags' | 'lean';
// How rows that come from several files / directories are grouped
export type GroupStyle = 'pathrow' | 'cards' | 'flat';

export interface SettingsLayout {
  switch: SwitchStyle;
  head: HeadStyle;
  nav: NavStyle;
  section: SectionStyle;
  trailing: TrailingStyle;
  group: GroupStyle;
}

export const LAYOUT_AXES = {
  switch: ['strip', 'home', 'rail'],
  head: ['hero', 'bar', 'facts'],
  nav: ['pills', 'tabs', 'stack', 'fold'],
  section: ['heading', 'label', 'inset'],
  trailing: ['tags', 'lean'],
  group: ['pathrow', 'cards', 'flat'],
} as const satisfies { [K in keyof SettingsLayout]: readonly SettingsLayout[K][] };

export type LayoutAxis = keyof SettingsLayout;
export const LAYOUT_AXIS_NAMES = Object.keys(LAYOUT_AXES) as LayoutAxis[];

// Named combinations: the editor-tab design carried over as-is, the recommended compact one, and a drill-down one
export const LAYOUT_PRESETS = {
  baseline: { switch: 'strip', head: 'hero', nav: 'pills', section: 'heading', trailing: 'tags', group: 'pathrow' },
  tidy: { switch: 'strip', head: 'bar', nav: 'stack', section: 'label', trailing: 'lean', group: 'cards' },
  drill: { switch: 'home', head: 'facts', nav: 'tabs', section: 'inset', trailing: 'lean', group: 'flat' },
} as const satisfies Record<string, SettingsLayout>;

export type LayoutPreset = keyof typeof LAYOUT_PRESETS;

export const DEFAULT_LAYOUT: SettingsLayout = LAYOUT_PRESETS.tidy;

export function presetOf(layout: SettingsLayout): LayoutPreset | undefined {
  return (Object.keys(LAYOUT_PRESETS) as LayoutPreset[]).find(p => LAYOUT_AXIS_NAMES.every(a => LAYOUT_PRESETS[p][a] === layout[a]));
}

export function encodeLayout(layout: SettingsLayout): string {
  return LAYOUT_AXIS_NAMES.map(a => `${a}=${layout[a]}`).join(' · ');
}

export const LayoutContext = createContext<SettingsLayout>(DEFAULT_LAYOUT);
export const useLayout = () => useContext(LayoutContext);
