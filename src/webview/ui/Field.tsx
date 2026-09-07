import type { ReactNode } from 'react';
import { cn } from './cn';

// Neutral form controls for menu footers: switch rows and segmented single-select groups.

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

// Equal-width segments share one track; only the selected segment gets an inset fill.
export function RadioPills<V extends string>({ label, options, value, onChange }: RadioPillsProps<V>) {
  return (
    <div role="radiogroup" aria-label={label} className="grid min-w-fit flex-1 auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-hover p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-ctl-sm min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-sm px-1 text-3 outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fg-2 disabled:text-fg-3 disabled:opacity-50',
            o.value === value ? 'bg-active text-fg-1' : 'text-fg-2 enabled:hover:bg-hover enabled:hover:text-fg-1',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
