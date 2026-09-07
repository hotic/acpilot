import { describe, expect, it } from 'vitest';
import type { AgentTurn, PermissionBlock, ToolCallBlock } from '../src/shared/transcript';
import { elapsedLabel, foldActivity, splitCodexBlocks, toolVerb } from '../src/webview/chat/folding';

const read: ToolCallBlock = { type: 'tool_call', id: 'read', kind: 'read', verb: '读取', target: 'README.md', status: 'completed' };
const run: ToolCallBlock = { type: 'tool_call', id: 'run', kind: 'execute', verb: '运行', target: 'pnpm test', targetMono: true, status: 'in_progress' };

describe('Codex process folding', () => {
  it('keeps one process history across commentary and leaves the trailing reply outside', () => {
    const intro = { type: 'text' as const, markdown: '先检查项目。' };
    const progress = { type: 'text' as const, markdown: '继续验证。' };
    const reply = { type: 'text' as const, markdown: '检查完成。' };
    expect(splitCodexBlocks([intro, read, progress, run, reply])).toEqual({
      process: [intro, read, progress, run], reply: [reply], permissions: [],
    });
    // Appending an action reclassifies the previous prose as history without duplicating it.
    expect(splitCodexBlocks([intro, read, progress]).reply).toEqual([progress]);
    expect(splitCodexBlocks([intro, read, progress, run]).process).toEqual([intro, read, progress, run]);
  });

  it('keeps approval actions accessible outside a collapsed process', () => {
    const permission: PermissionBlock = { type: 'permission', id: 'p', title: '运行测试', options: [] };
    const blocks = [read, run, permission];
    expect(splitCodexBlocks(blocks)).toEqual({ process: [read, run], reply: [], permissions: [permission] });
    expect(foldActivity({ role: 'agent', blocks })).toEqual({ kind: 'other', label: '等待批准' });
  });

  it('selects the actual pending action despite stale activity or later completed calls', () => {
    const turn: AgentTurn = { role: 'agent', blocks: [run, read], activity: { kind: 'think', label: '正在思考' } };
    expect(foldActivity(turn)).toEqual({ kind: 'execute', label: '正在运行', target: 'pnpm test', mono: true });
    expect(foldActivity({ role: 'agent', blocks: [{ ...run, status: 'completed' }], activity: turn.activity }).label).toBe('正在思考');
    expect(foldActivity({ role: 'agent', blocks: [{ type: 'compaction', id: 'c', status: 'in_progress' }] }).label).toBe('正在压缩上下文');
  });

  it('preserves failed and cancelled outcomes in action labels', () => {
    expect(toolVerb(read)).toBe('已读取');
    expect(toolVerb({ ...run, status: 'failed' })).toBe('运行失败');
    expect(toolVerb({ ...run, status: 'cancelled' })).toBe('已取消运行');
  });

  it('uses elapsed wall time and Chinese units, without appending action summaries', () => {
    const turn: AgentTurn = { role: 'agent', blocks: [{ type: 'thought', text: '', durationSec: 5 }, run], startedAt: 1000, endedAt: 287000 };
    expect(elapsedLabel(turn)).toBe('用时 4分钟 46秒');
    expect(elapsedLabel({ ...turn, endedAt: 61000 })).toBe('用时 1分钟');
    expect(elapsedLabel({ ...turn, endedAt: 6000 })).toBe('用时 5秒');
    expect(elapsedLabel({ ...turn, startedAt: undefined, endedAt: undefined })).toBe('已完成');
  });
});
