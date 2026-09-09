import type { PlanEntry, ToolCallBlock } from './transcript';

// The tool identity survives later ACP packets that rename the display title.
export function isTodoTool(block: Pick<ToolCallBlock, 'verbKey'>): boolean {
  return block.verbKey === 'verb.todo';
}

// Parse confirmed tool results only. Input may be a partial merge request and
// must never be presented as the resulting list or used to replace the live plan.
export function todoEntries(value: unknown): PlanEntry[] | undefined {
  if (typeof value === 'string') {
    // Kimi returns a text receipt with the resulting list, followed by a hint.
    const receipt = /^Todo list updated\.\r?\nCurrent todo list:\r?\n([\s\S]*?)(?:\r?\n\r?\n|$)/.exec(value);
    if (receipt) {
      const entries: PlanEntry[] = [];
      for (const line of receipt[1]!.split(/\r?\n/).filter(Boolean)) {
        const item = /^  \[(pending|in_progress|completed|done)\] (.+)$/.exec(line);
        if (!item) return;
        entries.push({ title: item[2]!, status: item[1] === 'done' ? 'completed' : item[1] as PlanEntry['status'] });
      }
      return entries;
    }
    try { value = JSON.parse(value); } catch { return; }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const object = value as Record<string, unknown>;
  const result = object.type === 'Todo' ? object.TodosUpdated : object;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return;
  const todos = (result as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return;
  const entries: PlanEntry[] = [];
  for (const item of todos) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return;
    const { content, status, priority } = item as Record<string, unknown>;
    if (typeof content !== 'string' || !content.trim()) return;
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return;
    if (priority !== undefined && priority !== 'low' && priority !== 'medium' && priority !== 'high') return;
    entries.push({ title: content, status, ...(priority ? { priority } : {}) });
  }
  return entries;
}

// Old transcripts retain the result as JSON text; render them with the same UI.
export function toolTodoEntries(block: ToolCallBlock): PlanEntry[] | undefined {
  if (!isTodoTool(block) || block.status !== 'completed') return;
  return block.todoEntries ?? (block.content?.type === 'text' ? todoEntries(block.content.text) : undefined);
}
