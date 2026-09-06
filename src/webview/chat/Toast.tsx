import { useEffect } from 'react';
import { Trash2, X } from 'lucide-react';
import { Button, IconButton } from '../ui/Button';

export interface ToastProps {
  text: string;
  // An undoable action (session deletion and the like)
  onUndo?: () => void;
  onClose: () => void;
  // Milliseconds before it dismisses itself
  ttl?: number;
}

// A capsule floating above the bottom of the conversation flow: icon · text · undo · close. Dismisses itself when time's up
export function Toast({ text, onUndo, onClose, ttl = 8000 }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, ttl);
    return () => clearTimeout(t);
  }, [onClose, ttl]);
  return (
    <div role="status" className="enter pointer-events-auto flex max-w-[calc(100%-2*var(--pad))] items-center gap-2 rounded-lg border border-line bg-bg-2 py-1 pr-1 pl-3 text-2 text-fg-1 shadow-pop">
      <Trash2 className="size-icon shrink-0 text-fg-3" strokeWidth={1.5} />
      <span className="truncate">{text}</span>
      {onUndo && <Button variant="secondary" onClick={onUndo} className="ml-1">撤销</Button>}
      <IconButton aria-label="关闭" onClick={onClose}><X strokeWidth={1.5} /></IconButton>
    </div>
  );
}
