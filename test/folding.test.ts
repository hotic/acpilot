import { afterEach, describe, expect, it } from 'vitest';
import type { AgentTurn, PermissionBlock, ToolCallBlock } from '../src/shared/transcript';
import { setLocale } from '../src/webview/i18n';
import { elapsedLabel, foldActivity, splitCodexBlocks, toolVerb } from '../src/webview/chat/folding';

const read: ToolCallBlock = { type: 'tool_call', id: 'read', kind: 'read', verb: 'Read', target: 'README.md', status: 'completed' };
const run: ToolCallBlock = { type: 'tool_call', id: 'run', kind: 'execute', verb: 'Run', target: 'pnpm test', targetMono: true, status: 'in_progress' };

// folding renders through the webview dictionary; the default locale is en
afterEach(() => setLocale('en'));

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
    expect(foldActivity({ role: 'agent', blocks })).toEqual({ kind: 'other', label: 'Awaiting approval' });
  });

  it('selects the actual pending action despite stale activity or later completed calls', () => {
    const turn: AgentTurn = { role: 'agent', blocks: [run, read], activity: { kind: 'think', label: 'Thinking' } };
    expect(foldActivity(turn)).toEqual({ kind: 'execute', label: 'Run…', target: 'pnpm test', mono: true, active: true });
    expect(foldActivity({ role: 'agent', blocks: [{ ...run, status: 'completed' }], activity: turn.activity }).label).toBe('Run');
    expect(foldActivity({ role: 'agent', blocks: [{ type: 'compaction', id: 'c', status: 'in_progress' }] }).label).toBe('Compacting context');
  });

  it('preserves failed and cancelled outcomes in action labels', () => {
    expect(toolVerb(read)).toBe('Read');
    expect(toolVerb({ ...run, status: 'failed' })).toBe('Run failed');
    expect(toolVerb({ ...run, status: 'cancelled' })).toBe('Run cancelled');
  });

  it('uses elapsed wall time with compact units, without appending action summaries', () => {
    const turn: AgentTurn = { role: 'agent', blocks: [{ type: 'thought', text: '', durationSec: 5 }, run], startedAt: 1000, endedAt: 287000 };
    expect(elapsedLabel(turn)).toBe('Took 4m 46s');
    expect(elapsedLabel({ ...turn, endedAt: 61000 })).toBe('Took 1m');
    expect(elapsedLabel({ ...turn, endedAt: 6000 })).toBe('Took 5s');
    expect(elapsedLabel({ ...turn, startedAt: undefined, endedAt: undefined })).toBe('Done');
  });

  it('follows the locale: zh-CN renders the same labels in Chinese', () => {
    setLocale('zh-CN');
    const turn: AgentTurn = { role: 'agent', blocks: [run], startedAt: 1000, endedAt: 287000 };
    expect(elapsedLabel(turn)).toBe('用时 4 分钟 46 秒');
    expect(toolVerb({ ...run, status: 'failed' })).toBe('运行失败');
    expect(foldActivity({ role: 'agent', blocks: [{ type: 'compaction', id: 'c', status: 'in_progress' }] }).label).toBe('正在压缩上下文');
  });
});
