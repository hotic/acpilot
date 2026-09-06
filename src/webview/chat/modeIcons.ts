import { Bug, CircleDashed, Code, Infinity as InfinityIcon, ListTodo, MessageCircleQuestionMark, ShieldOff, Sparkles, type LucideIcon } from 'lucide-react';
import type { SessionOption } from '@shared/transcript';

// ACP modes carry only id / name / description, so the glyph is inferred from keywords in id + name (Devin: code / smart / ask / plan / bypass;
// Grok synthetic: default / plan / yolo; Kimi and custom agents fall through the same table). First match wins; unknown modes get a dashed circle
const RULES: [RegExp, LucideIcon][] = [
  [/bypass|yolo|auto[\s-]?accept|full[\s-]?access|unsafe/, ShieldOff],
  [/debug/, Bug],
  [/plan/, ListTodo],
  [/\bask\b|chat|question/, MessageCircleQuestionMark],
  [/smart|\bauto\b/, Sparkles],
  [/code|edit|build/, Code],
  [/agent|default|normal/, InfinityIcon],
];

export function modeIcon(mode: SessionOption): LucideIcon {
  const key = `${mode.id} ${mode.name}`.toLowerCase();
  return RULES.find(([re]) => re.test(key))?.[1] ?? CircleDashed;
}
