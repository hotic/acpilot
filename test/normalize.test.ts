import { describe, expect, it } from 'vitest';
import { applyUpdate, diffLines, emptyState, endTurn } from '../src/host/acp/normalize';

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

  it('endTurn: cancelled marks running tools cancelled, the rest failed', () => {
    const s = emptyState();
    applyUpdate(s, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 't', status: 'in_progress' });
    endTurn(s, 'cancelled');
    const t = s.turns[0];
    if (t?.role !== 'agent') throw new Error();
    expect(t.blocks[0]).toMatchObject({ status: 'cancelled' });
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
