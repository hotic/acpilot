import type { ReactNode } from 'react';
import { cn } from './cn';

// Form controls that live inside menus (the model panel's params): a switch row and a row of radio pills.
// Both are neutral like every other button — the on state is the inverted solid shared with the primary button, not an accent color

export interface SwitchRowProps {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

// A --row-tall row with the label on the left and the switch at the end; the whole row is the hit target
export function SwitchRow({ label, checked, disabled, onChange }: SwitchRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-row w-full items-center gap-2 rounded-md px-2 text-left text-2 text-fg-1 outline-none transition-colors hover:bg-hover focus-visible:bg-hover disabled:text-fg-3 disabled:hover:bg-transparent"
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn('relative flex h-4 w-7 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-btn-1' : 'bg-active', disabled && 'opacity-50')}>
        <span className={cn('size-3 rounded-full transition-transform', checked ? 'translate-x-3.5 bg-btn-1-fg' : 'translate-x-0.5 bg-fg-3')} />
      </span>
    </button>
  );
}

export interface RadioPillsProps<V extends string> {
  label: string;
  options: { value: V; label: string; disabled?: boolean }[];
  value: V;
  onChange: (value: V) => void;
}

// Single-select as a wrapping row of pills: every level visible, one click to switch (a nested menu would cost two). The checked pill gets the pressed look.
// No inset: a pill's background starts where a menu row's hover background does, so its text lines up with the row text and headings
export function RadioPills<V extends string>({ label, options, value, onChange }: RadioPillsProps<V>) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-ctl items-center rounded-md px-2 text-3 outline-none transition-colors disabled:text-fg-3 disabled:hover:bg-transparent',
            o.value === value ? 'bg-active text-fg-1' : 'text-fg-2 hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
