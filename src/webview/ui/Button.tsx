import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

type Variant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  kbd?: string;
}

const VARIANT: Record<Variant, string> = {
  // All three variants neutral: inverted solid / grey fill / outline; no colored buttons (accent is reserved for status dots)
  primary: 'bg-btn-1 text-btn-1-fg font-medium hover:brightness-90 focus-visible:brightness-90',
  secondary: 'bg-hover text-fg-1 border border-line hover:bg-active focus-visible:bg-active',
  ghost: 'border border-line text-fg-2 hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1',
};

// All buttons share --ctl height, --r-md radius, and 12px horizontal padding
export function Button({ variant = 'secondary', kbd, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-ctl items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-2 transition-colors',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
      {kbd && <kbd className="font-sans text-3 opacity-60">{kbd}</kbd>}
    </button>
  );
}

// Square icon button: --ctl × --ctl, icon --icon-ctl; as a menu trigger pass data-open to keep the pressed look
export function IconButton({ className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement>; children: ReactNode }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-ctl shrink-0 items-center justify-center rounded-md text-fg-2 transition-colors hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1 [&_svg]:size-icon-ctl',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// Selector that opens a menu (session title / mode / model / agent): --ctl tall, --r-md radius, truncatable text, trailing arrow.
// Sets data-open while open to keep the pressed look
export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  caret?: boolean;
  // Small mark before the text (e.g. agent vendor mark), --icon sized
  icon?: ReactNode;
  children: ReactNode;
}

export function Chip({ className, children, caret = true, icon, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex h-ctl min-w-0 items-center gap-1 rounded-md px-2 text-3 text-fg-2 transition-colors',
        'hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1 data-[open]:bg-active data-[open]:text-fg-1',
        className,
      )}
      {...rest}
    >
      {icon && <span className="flex shrink-0 items-center text-fg-3">{icon}</span>}
      <span className="truncate">{children}</span>
      {caret && <ChevronDown className="size-3 shrink-0 text-fg-3" strokeWidth={1.75} />}
    </button>
  );
}
