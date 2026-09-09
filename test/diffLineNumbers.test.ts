import { describe, expect, it } from 'vitest';
import { diffLines } from '../src/host/acp/diff';
import { diffLineNumbers } from '../src/webview/chat/diffLineNumbers';

describe('diff source positions', () => {
  it('preserves both source positions across omitted context and inserted lines', () => {
    const old = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const next = [...old];
    next.splice(10, 1, 'replacement', 'inserted');
    const lines = diffLines(old.join('\n'), next.join('\n'));
    expect(lines.find(l => l.text === '-line 11')).toMatchObject({ oldLine: 11 });
    expect(lines.find(l => l.text === '+replacement')).toMatchObject({ newLine: 11 });
    expect(lines.find(l => l.text === '+inserted')).toMatchObject({ newLine: 12 });
    expect(lines.find(l => l.text === ' line 12')).toMatchObject({ oldLine: 12, newLine: 13 });
    expect(lines[0]?.kind).toBe('hunk');
    // Stored transcripts without positions must retain the same visible numbers.
    expect(diffLineNumbers(lines.map(({ kind, text }) => ({ kind, text })))).toEqual(lines);
  });

  it('numbers new files and the bounded replacement output', () => {
    expect(diffLines('', 'a\nb').map(l => l.newLine)).toEqual([1, 2]);
    const lines = diffLines('old\n'.repeat(450), 'new\n'.repeat(450));
    expect(lines.filter(l => l.kind === 'del').map(l => l.oldLine)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(diffLineNumbers(lines.map(({ kind, text }) => ({ kind, text })))).toEqual(lines);
  });

  it.each(['@@ … 90 unchanged lines … @@', '@@ … 90 行未变 … @@'])('restores localized historical omissions: %s', text => {
    expect(diffLineNumbers([{ kind: 'hunk', text }, { kind: 'del', text: '-old' }, { kind: 'add', text: '+new' }]).slice(1))
      .toMatchObject([{ oldLine: 91 }, { newLine: 91 }]);
  });

  it('keeps unknown positions blank until the source supplies an explicit position', () => {
    const rows = diffLineNumbers([
      { kind: 'hunk', text: '@@ unknown omission @@' },
      { kind: 'add', text: '+unknown' },
      { kind: 'add', text: '+known', newLine: 80 },
      { kind: 'add', text: '+next' },
    ]);
    expect(rows.map(l => l.newLine)).toEqual([undefined, undefined, 80, 81]);
  });
});
