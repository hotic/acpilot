import { describe, expect, it } from 'vitest';
import { diffLines } from '../src/host/acp/diff';
import { applyUpdate, emptyState } from '../src/host/acp/normalize';
import { codeLanguage } from '../src/webview/chat/codeSyntax';
import { diffCopyText, highlightDiff } from '../src/webview/chat/codeDiff';

describe('production code details', () => {
  it('keeps exact source for copying while omitting unchanged display context', () => {
    const before = Array.from({ length: 30 }, (_, i) => `const value${i} = ${i};`).join('\n') + '\n';
    const after = before.replace('value15 = 15', 'value15 = 150');
    const state = emptyState();
    applyUpdate(state, { sessionUpdate: 'tool_call', toolCallId: 'edit', title: 'Edit', kind: 'edit', content: [{ type: 'diff', path: 'values.ts', oldText: before, newText: after }] });
    const turn = state.turns[0];
    const block = turn?.role === 'agent' ? turn.blocks[0] : undefined;
    const diff = block?.type === 'tool_call' ? block.content : undefined;
    if (diff?.type !== 'diff') throw new Error('Missing diff');
    expect(diff.lines.some(line => line.kind === 'hunk')).toBe(true);
    expect(diffCopyText(diff.lines, diff.source)).toBe(after);
    expect(diffCopyText(diff.lines)).not.toContain('value0 =');
  });

  it('preserves Python multiline grammar across omitted lines and both source sides', async () => {
    const oldText = ['text = """', ...Array.from({ length: 20 }, (_, i) => `line ${i}`), '"""', 'print(text)', ''].join('\n');
    const newText = oldText.replace('line 10', 'new text');
    const source = { path: 'example.py', oldText, newText };
    const rows = await highlightDiff(diffLines(oldText, newText), source);
    const added = rows.find(row => row.kind === 'add')!;
    const deleted = rows.find(row => row.kind === 'del')!;
    expect(added.tokens.map(token => token.text).join('')).toBe('new text');
    expect(added.tokens[0]?.dark).toBe('#CE9178');
    expect(deleted.tokens[0]?.dark).toBe('#CE9178');
  });

  it.each([
    ['file.tsx', 'export const View = () => <div title="hello" />;'],
    ['file.py', 'import json\nprint("hello")'],
    ['file.json', '{"enabled": true, "count": 3}'],
  ])('uses real syntax tokens for %s in both themes', async (path, newText) => {
    const rows = await highlightDiff(diffLines('', newText), { path, oldText: '', newText });
    expect(new Set(rows.flatMap(row => row.tokens.map(token => token.dark))).size).toBeGreaterThan(2);
    expect(rows.flatMap(row => row.tokens).some(token => token.dark !== token.light)).toBe(true);
  });

  it('keeps unknown filenames plain and recovers visible historical syntax', async () => {
    expect(codeLanguage('NOTES')).toBeNull();
    const lines = diffLines('', 'const answer = "yes";');
    const plain = await highlightDiff(lines, undefined, 'NOTES');
    expect(plain[0]?.tokens).toEqual([{ text: 'const answer = "yes";' }]);
    const legacy = await highlightDiff(lines.map(({ kind, text }) => ({ kind, text })), undefined, 'answer.ts');
    expect(legacy[0]?.tokens.some(token => token.dark)).toBe(true);
  });

  it('does not manufacture a trailing blank line and retains empty-file copy', () => {
    expect(diffLines('', 'a\r\nb\r\n').map(line => line.text)).toEqual(['+a', '+b']);
    expect(diffLines('', '')).toEqual([]);
    expect(diffCopyText(diffLines('old', ''), { path: 'empty', oldText: 'old', newText: '' })).toBe('');
  });
});
