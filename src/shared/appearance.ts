// Appearance axes: one-to-one with the acpilot.appearance.* settings. The order is the digit order of the combo code — do not reorder.
export interface Appearance {
  density: 'cozy' | 'compact' | 'airy';
  radius: '12' | '8' | '16';
  surface: 'hairline' | 'tonal' | 'stroke';
  font: 'system' | 'inter' | 'geist';
  userMessage: 'bubble' | 'block' | 'plain';
  toolLine: 'text' | 'icon' | 'rich';
  thought: 'text' | 'shimmer' | 'orb';
  sessions: 'dropdown' | 'drawer';
  composer: 'island' | 'flush';
  beam: 'line' | 'none' | 'pulse' | 'full';
  beamColor: 'mono' | 'ocean' | 'colorful';
  send: 'accent' | 'icon' | 'metal';
  accent: 'brand' | 'agent' | 'vscode';
  motion: 'subtle' | 'none' | 'full';
}

export type AxisKey = keyof Appearance;

export interface AxisDef<K extends AxisKey = AxisKey> {
  key: K;
  label: string;
  group: '骨架' | '对话' | 'Composer' | '氛围';
  options: { value: Appearance[K]; label: string }[];
}

export const AXES: AxisDef[] = [
  { key: 'density', label: '密度', group: '骨架', options: [{ value: 'cozy', label: '舒适' }, { value: 'compact', label: '紧凑' }, { value: 'airy', label: '宽松' }] },
  { key: 'radius', label: '圆角', group: '骨架', options: [{ value: '12', label: '12' }, { value: '8', label: '8' }, { value: '16', label: '16' }] },
  { key: 'surface', label: '表面', group: '骨架', options: [{ value: 'hairline', label: 'hairline' }, { value: 'tonal', label: '无边分层' }, { value: 'stroke', label: '描边' }] },
  { key: 'font', label: '字体', group: '骨架', options: [{ value: 'system', label: '系统' }, { value: 'inter', label: 'Inter' }, { value: 'geist', label: 'Geist' }] },
  { key: 'userMessage', label: '用户消息', group: '对话', options: [{ value: 'bubble', label: '右对齐气泡' }, { value: 'block', label: '色块' }, { value: 'plain', label: '纯文本' }] },
  { key: 'toolLine', label: '工具行', group: '对话', options: [{ value: 'text', label: '纯文字' }, { value: 'icon', label: '加图标' }, { value: 'rich', label: '图标 + 元信息' }] },
  { key: 'thought', label: '思考', group: '对话', options: [{ value: 'text', label: '纯文字' }, { value: 'shimmer', label: '微光' }, { value: 'orb', label: 'Orb' }] },
  { key: 'sessions', label: '会话', group: '对话', options: [{ value: 'dropdown', label: '下拉' }, { value: 'drawer', label: '抽屉' }] },
  { key: 'composer', label: '输入框', group: 'Composer', options: [{ value: 'island', label: '浮岛' }, { value: 'flush', label: '贴底' }] },
  { key: 'beam', label: 'Beam', group: 'Composer', options: [{ value: 'line', label: '底线' }, { value: 'none', label: '无' }, { value: 'pulse', label: '呼吸' }, { value: 'full', label: '全边框' }] },
  { key: 'beamColor', label: 'Beam 色', group: 'Composer', options: [{ value: 'mono', label: 'mono' }, { value: 'ocean', label: 'ocean' }, { value: 'colorful', label: 'colorful' }] },
  { key: 'send', label: '发送钮', group: 'Composer', options: [{ value: 'accent', label: '强调色' }, { value: 'icon', label: '纯图标' }, { value: 'metal', label: 'MetalFx' }] },
  { key: 'accent', label: '强调色', group: '氛围', options: [{ value: 'brand', label: '琥珀' }, { value: 'agent', label: '每 agent 一色' }, { value: 'vscode', label: '跟随 VS Code' }] },
  { key: 'motion', label: '动效', group: '氛围', options: [{ value: 'subtle', label: '克制' }, { value: 'none', label: '无' }, { value: 'full', label: '拉满' }] },
];

// Combo code ↔ Appearance: one option index digit per axis
export function encodeAppearance(a: Appearance): string {
  return AXES.map(ax => ax.options.findIndex(o => o.value === a[ax.key])).join('');
}
export function decodeAppearance(code: string, fallback: Appearance): Appearance {
  if (code.length !== AXES.length || !/^\d+$/.test(code)) return fallback;
  const out = { ...fallback } as Record<AxisKey, string>;
  AXES.forEach((ax, i) => {
    const opt = ax.options[Number(code[i])];
    if (opt) out[ax.key] = opt.value;
  });
  return out as unknown as Appearance;
}

// Baseline: finalized as 20110020030210
export const BASE_APPEARANCE: Appearance = decodeAppearance('20110020030210', {
  density: 'airy', radius: '12', surface: 'tonal', font: 'inter',
  userMessage: 'bubble', toolLine: 'text', thought: 'orb', sessions: 'dropdown',
  composer: 'island', beam: 'full', beamColor: 'mono', send: 'metal',
  accent: 'agent', motion: 'subtle',
});

// Builds an Appearance from a bag of setting values (acpilot.appearance.<axis>); invalid values fall back to the baseline
export function appearanceFromSettings(get: (key: AxisKey) => unknown): Appearance {
  const out = { ...BASE_APPEARANCE } as Record<AxisKey, string>;
  for (const ax of AXES) {
    const v = get(ax.key);
    if (typeof v === 'string' && ax.options.some(o => o.value === v)) out[ax.key] = v;
  }
  return out as unknown as Appearance;
}
