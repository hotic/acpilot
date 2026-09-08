import type { DiffLine } from '@shared/transcript';
import { t } from '../i18n';

// Line-level diff: LCS finds the common lines; the rest are marked add / del; beyond 800 combined lines only stats are given, no LCS
export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText ? oldText.split('\n') : [];
  const b = newText.split('\n');
  if (a.length + b.length > 800) {
    return [
      { kind: 'hunk', text: t('host.hunk', { a: a.length, b: b.length }) },
      ...a.slice(0, 40).map(t => ({ kind: 'del' as const, text: `-${t}` })),
      ...b.slice(0, 40).map(t => ({ kind: 'add' as const, text: `+${t}` })),
    ];
  }
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) {
    dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ kind: 'ctx', text: ` ${a[i]}` }); i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ kind: 'del', text: `-${a[i]}` }); i++; }
    else { out.push({ kind: 'add', text: `+${b[j]}` }); j++; }
  }
  while (i < m) out.push({ kind: 'del', text: `-${a[i++]}` });
  while (j < n) out.push({ kind: 'add', text: `+${b[j++]}` });
  return collapseContext(out);
}

// Keep only 3 lines of context around changes; the middle is collapsed into a hunk line
function collapseContext(lines: DiffLine[], keep = 3): DiffLine[] {
  const out: DiffLine[] = [];
  let run: DiffLine[] = [];
  const flush = (atEnd: boolean) => {
    if (run.length <= keep * 2 || (out.length === 0 && run.length <= keep) || (atEnd && run.length <= keep)) out.push(...run);
    else {
      const head = out.length === 0 ? [] : run.slice(0, keep);
      const tail = atEnd ? [] : run.slice(-keep);
      out.push(...head, { kind: 'hunk', text: t('host.unchanged', { n: run.length - head.length - tail.length }) }, ...tail);
    }
    run = [];
  };
  for (const l of lines) {
    if (l.kind === 'ctx') run.push(l);
    else { flush(false); out.push(l); }
  }
  flush(true);
  return out;
}
