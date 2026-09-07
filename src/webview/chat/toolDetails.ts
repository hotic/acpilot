import type { ToolCallBlock } from '@shared/transcript';

// Only explicit paths become file rows; prose and search patterns remain output.
function fileHit(text: string): string | undefined {
  const hit = /^(.+?):(\d+)(?::\d+)?(?::.*)?$/.exec(text);
  const path = hit?.[1] ?? text;
  if (!/^(?:\.{0,2}\/|[A-Za-z]:[\\/])/.test(path) && !/^[^\s:]+[.][\w-]+$/.test(path)) return;
  return hit ? `${path}:${hit[2]}` : path;
}

export function toolFiles(block: ToolCallBlock): string[] {
  if (block.kind !== 'read' && block.kind !== 'search') return [];
  const files = (block.locations ?? []).map(l => l.line == null ? l.path : `${l.path}:${l.line}`);
  if (block.kind === 'search' && block.content) {
    const lines = block.content.type === 'list' ? block.content.items
      : block.content.type === 'text' ? block.content.text.split('\n') : [];
    for (const line of lines) {
      const hit = fileHit(line.trim());
      if (hit) files.push(hit);
    }
  }
  // Older transcripts retained only a target, so expose that reference when available.
  if (!files.length && block.kind === 'read' && block.target) {
    const hit = fileHit(block.target);
    if (hit) files.push(hit);
  }
  return [...new Set(files)];
}

export function isLineCount(block: ToolCallBlock): boolean {
  return block.kind === 'read' && block.content?.type === 'text' && /^\s*\d+\s+lines?\s*$/i.test(block.content.text);
}
