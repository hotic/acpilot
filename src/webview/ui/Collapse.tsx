import type { ReactNode } from 'react';
import { cn } from './cn';

// Expand / collapse height animation: grid-template-rows 0fr ⇄ 1fr, no height measuring needed, works for any content length.
// Inert when collapsed, so its contents are neither focusable nor in the accessibility tree
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      inert={!open}
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-(--dur-open) ease-out',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        className,
      )}
    >
      <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
    </div>
  );
}
