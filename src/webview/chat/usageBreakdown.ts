import type { Turn, Usage } from '@shared/transcript';
import { t } from '../i18n';

// Context breakdown estimate: ACP's usage_update only carries used / size / cost totals, so the breakdown has to be estimated locally from the transcript.
// Token estimate: CJK characters count as 0.7 tokens, the rest as 1 token per 4 chars — reliable order of magnitude, not exact, so the panel always marks counts as approximate

export type UsageSegmentId = 'user' | 'agent' | 'tool' | 'thought' | 'system';

export interface UsageSegment {
  id: UsageSegmentId;
  label: string;
  tokens: number;
  // One line of explanation shown when the segment is selected: what this category is and how it's computed
  hint: string;
}

// CJK unified ideographs, compatibility ideographs, and fullwidth forms
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

// Rough token estimate: CJK fullwidth characters are dense, Latin runs about 4 chars per token
export function estTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return Math.ceil(cjk * 0.7 + (text.length - cjk) / 4);
}

// Buckets the transcript into four conversation usage categories by block type, with the remainder derived as "system & other";
// when the conversation estimate exceeds the total (a post-compaction summary is shorter than the original), scale proportionally to fit the total and zero out the system segment
export function estimateUsage(turns: Turn[], usage: Usage): UsageSegment[] {
  const raw: Record<Exclude<UsageSegmentId, 'system'>, number> = { user: 0, agent: 0, tool: 0, thought: 0 };
  for (const t of turns) {
    if (t.role === 'user') {
      // auto turns are automatic /compact, just a few tokens, folded into the user segment
      raw.user += estTokens(t.text);
      continue;
    }
    for (const b of t.blocks) {
      switch (b.type) {
        case 'text':
          raw.agent += estTokens(b.markdown);
          break;
        case 'thought':
          raw.thought += estTokens(b.text);
          break;
        case 'plan':
          raw.agent += b.entries.reduce((n, e) => n + estTokens(e.title), 0);
          break;
        case 'tool_call':
          raw.tool += estTokens([b.verb, b.target, b.meta].filter(Boolean).join(' '));
          if (b.content) {
            if (b.content.type === 'text') raw.tool += estTokens(b.content.text);
            else if (b.content.type === 'list') raw.tool += b.content.items.reduce((n, i) => n + estTokens(i), 0);
            else raw.tool += b.content.lines.reduce((n, l) => n + estTokens(l.text), 0);
          }
          break;
        case 'permission':
          raw.tool += estTokens([b.title, b.command, b.description].filter(Boolean).join(' '));
          break;
        // compaction status lines themselves don't enter the model context
      }
    }
  }

  const convSum = raw.user + raw.agent + raw.tool + raw.thought;
  const overflow = convSum > usage.used;
  const scale = overflow && convSum > 0 ? usage.used / convSum : 1;
  const seg = (id: Exclude<UsageSegmentId, 'system'>, label: string, hint: string): UsageSegment => ({
    id, label, hint, tokens: Math.round(raw[id] * scale),
  });

  return [
    seg('user', t('usage.seg.user'), t('usage.seg.user.hint')),
    seg('agent', t('usage.seg.agent'), t('usage.seg.agent.hint')),
    seg('tool', t('usage.seg.tool'), t('usage.seg.tool.hint')),
    seg('thought', t('usage.seg.thought'), t('usage.seg.thought.hint')),
    {
      id: 'system', label: t('usage.seg.system'),
      tokens: overflow ? 0 : usage.used - convSum,
      hint: t('usage.seg.system.hint'),
    },
  ];
}
