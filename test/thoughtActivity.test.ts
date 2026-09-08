import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTurn } from '../src/shared/transcript';
import { activityOf, applyUpdate, emptyState } from '../src/host/acp/normalize';
import { setHostLocale } from '../src/host/i18n';
import { setLocale } from '../src/webview/i18n';
import { foldActivity } from '../src/webview/chat/folding';

afterEach(() => { vi.restoreAllMocks(); setLocale('en'); setHostLocale('en'); });

describe('thought activity without a reasoning-end signal', () => {
  it('keeps an unreported generation gap generic, then switches to the reported tool', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const state = emptyState();
    applyUpdate(state, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'I will write the file.' } });
    clock.mockReturnValue(38000);
    const turn = state.turns[0] as AgentTurn;
    expect(activityOf(state.turns)?.label).toBe('Working');
    expect(foldActivity(turn).label).toBe('Working');
    // Tool arguments were generated during the silence; their first packet ends it.
    applyUpdate(state, { sessionUpdate: 'tool_call', toolCallId: 'write', title: 'write', kind: 'edit', status: 'in_progress', rawInput: { file_path: '/tmp/sample.ts' } });
    expect(turn.blocks[0]).toMatchObject({ text: 'I will write the file.', streaming: false });
    expect(activityOf(state.turns)?.kind).toBe('edit');
    expect(foldActivity(turn)).toMatchObject({ kind: 'edit', target: 'sample.ts', active: true });
  });

  it('uses the same generic label in Chinese for both activity paths', () => {
    setLocale('zh-CN');
    setHostLocale('zh-CN');
    const turn: AgentTurn = { role: 'agent', blocks: [{ type: 'thought', text: 'Preparing a write.', startedAt: 1000, streaming: true }] };
    expect(activityOf([turn])?.label).toBe('正在处理');
    expect(foldActivity(turn).label).toBe('正在处理');
  });

  it('keeps startup and unclassified gaps generic while retaining reported reply activity', () => {
    expect(activityOf([])?.label).toBe('Working');
    expect(activityOf([{ role: 'agent', blocks: [] }])?.label).toBe('Working');
    expect(activityOf([{ role: 'agent', blocks: [{ type: 'text', markdown: 'Done', streaming: true }] }])?.label).toBe('Replying');
  });
});
