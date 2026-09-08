import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

// The one shared "row": thought / plan / tool / status / session items all grow on this row.
// Row height --row; lead slot --lead (icon 14 or Orb 20 centered); label area gap --gap; trailing meta right-aligned.
export interface RowProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  lead?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
  interactive?: boolean;
  as?: 'div' | 'button';
  className?: string;
  dense?: boolean;
}

export function Row({ lead, trailing, children, interactive, as = 'div', className, dense, ...rest }: RowProps) {
  const Tag = as;
  return (
    <Tag
      {...(as === 'button' ? { type: 'button' } : {})}
      className={cn(
        'flex items-center gap-gap text-2 text-fg-2 select-none list-none text-left',
        dense ? 'min-h-[calc(var(--row)-4px)]' : 'min-h-row',
        interactive && 'row-interactive cursor-pointer rounded-md hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1 transition-colors',
        className,
      )}
      {...rest}
    >
      {lead !== undefined && <span className="flex size-lead shrink-0 items-center justify-center text-fg-3">{lead}</span>}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">{children}</span>
      {trailing !== undefined && <span className="ml-auto flex shrink-0 items-center gap-2 text-3 text-fg-3 tabular-nums">{trailing}</span>}
    </Tag>
  );
}

// Keep short labels intact; the adjacent target gives up space and truncates first.
export function RowLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('shrink-0 whitespace-nowrap', className)}>{children}</span>;
}

// Target text within a row (file name / command), one step brighter than the verb
export function RowTarget({ children, mono, className }: { children: ReactNode; mono?: boolean; className?: string }) {
  return <span className={cn('truncate text-fg-1/85', mono && 'font-mono text-mono', className)}>{children}</span>;
}
