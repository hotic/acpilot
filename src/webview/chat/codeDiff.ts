import type { DiffLine, DiffSource } from '@shared/transcript';
import { diffLineNumbers } from './diffLineNumbers';
import { codeLanguage, tokenizeCode, type CodeToken } from './codeSyntax';

export interface CodeDiffRow extends DiffLine { tokens: CodeToken[] }

export function plainDiffRows(lines: DiffLine[]): CodeDiffRow[] {
  return diffLineNumbers(lines).map(line => ({ ...line, tokens: [{ text: line.kind === 'hunk' ? line.text : line.text.slice(1) }] }));
}

export function diffCopyText(lines: DiffLine[], source?: DiffSource): string {
  // Historical records have no omitted source: label this explicitly as visible code.
  return source?.newText ?? lines.filter(line => line.kind === 'add' || line.kind === 'ctx').map(line => line.text.slice(1)).join('\n');
}

export async function highlightDiff(lines: DiffLine[], source?: DiffSource, path = ''): Promise<CodeDiffRow[]> {
  const rows = plainDiffRows(lines);
  const language = codeLanguage(source?.path ?? path);
  if (!language) return rows;
  if (source) {
    const [oldTokens, newTokens] = await Promise.all([tokenizeCode(source.oldText, language), tokenizeCode(source.newText, language)]);
    return rows.map(row => {
      const number = row.kind === 'del' ? row.oldLine : row.newLine;
      const tokens = number === undefined ? undefined : (row.kind === 'del' ? oldTokens : newTokens)[number - 1];
      return row.kind === 'hunk' || !tokens ? row : { ...row, tokens };
    });
  }
  // Old records can only restore grammar state within each visible context segment.
  // Tokenize each side separately so deleted lines cannot affect new-side syntax.
  let start = 0;
  for (let end = 0; end <= rows.length; end++) {
    if (end < rows.length && rows[end]!.kind !== 'hunk') continue;
    const segment = rows.slice(start, end);
    const old = segment.filter(row => row.kind !== 'add');
    const next = segment.filter(row => row.kind !== 'del');
    const [oldTokens, newTokens] = await Promise.all([
      tokenizeCode(old.map(row => row.text.slice(1)).join('\n'), language),
      tokenizeCode(next.map(row => row.text.slice(1)).join('\n'), language),
    ]);
    old.forEach((row, index) => { if (row.kind === 'del' && oldTokens[index]) row.tokens = oldTokens[index]!; });
    next.forEach((row, index) => { if (newTokens[index]) row.tokens = newTokens[index]!; });
    start = end + 1;
  }
  return rows;
}
