import { describe, expect, it, vi } from 'vitest';
import { applyUpdate, diffLines, emptyState, endTurn, failTurn } from '../src/host/acp/normalize';

describe('diffLines', () => {
  it('LCS line-level diff, keeping only context near changes', () => {
    const old = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const neu = old.replace('line 10', 'LINE 10');
    const lines = diffLines(old, neu);
    expect(lines.filter(l => l.kind === 'del').map(l => l.text)).toEqual(['-line 10']);
    expect(lines.filter(l => l.kind === 'add').map(l => l.text)).toEqual(['+LINE 10']);
    expect(lines.filter(l => l.kind === 'hunk')).toHaveLength(2);
    expect(lines.filter(l => l.kind === 'ctx')).toHaveLength(6);
  });

  it('new file is all add', () => {
    expect(diffLines('', 'a\nb').map(l => l.kind)).toEqual(['add', 'add']);
  });
});

describe('applyUpdate', () => {
  it('records the full live turn duration once, without inventing replay timestamps', () => {
    const s = emptyState();
    s.turns.push({ role: 'agent', blocks: [], startedAt: 1000 });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(287000);
    try {
      endTurn(s, 'end_turn');
      expect(s.turns[0]).toMatchObject({ startedAt: 1000, endedAt: 287000 });
      clock.mockReturnValue(300000);
      endTurn(s, 'end_turn');
      expect(s.turns[0]).toMatchObject({ endedAt: 287000 });
      const replay = emptyState();
      replay.turns.push({ role: 'agent', blocks: [] });
      endTurn(replay, 'end_turn');
      expect(replay.turns[0]).not.toHaveProperty('endedAt');
    } finally {
      clock.mockRestore();
    }
  });

  it('switching from a thought block to a text block finalizes it and records the duration', () => {
    const s = emptyState();
    applyUpdate(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'a' } });
    applyUpdate(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'b' } });
    applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'x' } });
    const t = s.turns[0];
    if (t?.role !== 'agent') throw new Error();
    expect(t.blocks[0]).toMatchObject({ type: 'thought', text: 'ab', streaming: false });
    expect((t.blocks[0] as { durationSec?: number }).durationSec).toBeGreaterThanOrEqual(1);
    expect(t.blocks[1]).toMatchObject({ type: 'text', markdown: 'x', streaming: true });
  });

  it('tool_call_update without a matching tool_call inserts one; execute uses rawInput.command as the target', () => {
    const s = emptyState();
    applyUpdate(s, { sessionUpdate: 'tool_call_update', toolCallId: 'x', kind: 'execute', status: 'in_progress', rawInput: { command: 'ls -la' } });
    const t = s.turns[0];
    if (t?.role !== 'agent') throw new Error();
    expect(t.blocks[0]).toMatchObject({ type: 'tool_call', id: 'x', verb: '运行', target: 'ls -la', targetMono: true, status: 'in_progress' });
  });

  it('endTurn: cancelled marks running tools cancelled, the rest failed; the stop reason lands on the turn', () => {
    const s = emptyState();
    applyUpdate(s, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 't', status: 'in_progress' });
    endTurn(s, 'cancelled');
    const t = s.turns[0];
    if (t?.role !== 'agent') throw new Error();
    expect(t.blocks[0]).toMatchObject({ status: 'cancelled' });
    expect(t.stop).toBe('cancelled');
    applyUpdate(s, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'partial' } });
    endTurn(s, 'max_tokens');
    expect(t.stop).toBe('max_tokens');
    expect(t.blocks[1]).toMatchObject({ type: 'text', streaming: false });
  });

  it('failTurn: seals the turn like a cancellation and keeps the error on it', () => {
    const s = emptyState();
    applyUpdate(s, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hm' } });
    applyUpdate(s, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 't', status: 'in_progress' });
    failTurn(s, { message: 'Upstream error', code: -32603, kind: 'upstream_error', retryable: true });
    const t = s.turns[0];
    if (t?.role !== 'agent') throw new Error();
    expect(t.stop).toBe('error');
    expect(t.error).toEqual({ message: 'Upstream error', code: -32603, kind: 'upstream_error', retryable: true });
    expect(t.activity).toBeUndefined();
    expect(t.blocks[0]).toMatchObject({ type: 'thought', streaming: false });
    expect(t.blocks[1]).toMatchObject({ status: 'cancelled' });
  });

  it('plan: entries keep their priority, a later plan replaces the whole list within the turn', () => {
    const s = emptyState();
    applyUpdate(s, { sessionUpdate: 'plan', entries: [{ content: 'a', priority: 'high', status: 'in_progress' }, { content: 'b', priority: 'low', status: 'pending' }] });
    applyUpdate(s, { sessionUpdate: 'plan', entries: [{ content: 'a', priority: 'high', status: 'completed' }, { content: 'b', priority: 'low', status: 'in_progress' }] });
    const t = s.turns[0];
    if (t?.role !== 'agent') throw new Error();
    expect(t.blocks).toHaveLength(1);
    expect(t.blocks[0]).toEqual({ type: 'plan', entries: [{ title: 'a', status: 'completed', priority: 'high' }, { title: 'b', status: 'in_progress', priority: 'low' }] });
  });

  it('configOptions: every select becomes a control, groups flattened, sorted by category, boolean hidden, category=mode promoted to modes', () => {
    const s = emptyState();
    applyUpdate(s, {
      sessionUpdate: 'config_option_update',
      configOptions: [
        { id: 'verbose', name: 'Verbose', type: 'boolean', currentValue: true },
        { id: 'custom', name: 'Style', type: 'select', currentValue: 'x', options: [{ value: 'x', name: 'X' }] },
        { id: 'effort', name: 'Effort', category: 'thought_level', type: 'select', currentValue: 'hi', options: [{ value: 'lo', name: 'Lo' }, { value: 'hi', name: 'Hi' }] },
        { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'plan', options: [{ value: 'agent', name: 'Agent' }, { value: 'plan', name: 'Plan' }] },
        {
          id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'b',
          options: [{ group: 'g1', name: 'Group 1', options: [{ value: 'a', name: 'A' }] }, { group: 'g2', name: 'Group 2', options: [{ value: 'b', name: 'B' }] }],
        },
      ],
    });
    expect(s.controls.options.map(o => o.id)).toEqual(['model', 'effort', 'custom']);
    expect(s.controls.options[0]!.options).toEqual([{ id: 'a', name: 'A', description: 'Group 1' }, { id: 'b', name: 'B', description: 'Group 2' }]);
    expect(s.controls.options[0]!.value).toBe('b');
    expect(s.controls.modes.map(m => m.id)).toEqual(['agent', 'plan']);
    expect(s.controls.modeId).toBe('plan');
    expect(s.controls.modeConfigId).toBe('mode');
  });

  it('configOptions: when modes is non-empty, category=mode is a duplicate (Kimi sends both) and stays out of the control list', () => {
    const s = emptyState();
    s.controls.modes = [{ id: 'default', name: 'Default' }, { id: 'yolo', name: 'YOLO' }];
    s.controls.modeId = 'default';
    applyUpdate(s, {
      sessionUpdate: 'config_option_update',
      configOptions: [
        { id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: 'default', options: [{ value: 'default', name: 'Default' }, { value: 'yolo', name: 'YOLO' }] },
        { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: 'k3', options: [{ value: 'k3', name: 'K3' }] },
      ],
    });
    expect(s.controls.options.map(o => o.id)).toEqual(['model']);
    expect(s.controls.modes.map(m => m.id)).toEqual(['default', 'yolo']);
    expect(s.controls.modeId).toBe('default');
    expect(s.controls.modeConfigId).toBeUndefined();
  });
});
