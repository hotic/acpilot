import { useEffect, useState } from 'react';
import type { Draft } from '@shared/transcript';

// Unsent drafts by session id. Each session has its own composer state: switching away parks what was typed / pasted here, switching back
// restores it, and a draft never leaks into another session's field. Webview memory only — a window reload starts clean
const DRAFTS = new Map<string, { text: string; drafts: Draft[] }>();

export function useComposerDraft(draftKey?: string, editText?: string) {
  const parked = draftKey ? DRAFTS.get(draftKey) : undefined;
  const [text, setText] = useState(editText ?? parked?.text ?? '');
  const [drafts, setDrafts] = useState<Draft[]>(parked?.drafts ?? []);
  useEffect(() => {
    if (!draftKey) return;
    if (text || drafts.length) DRAFTS.set(draftKey, { text, drafts }); else DRAFTS.delete(draftKey);
  }, [draftKey, text, drafts]);
  return { text, setText, drafts, setDrafts };
}
