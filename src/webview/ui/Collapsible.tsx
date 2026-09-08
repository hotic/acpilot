import type { ComponentProps } from 'react';
import { Collapsible as Base } from '@base-ui/react/collapsible';
import { cn, cnState } from './cn';

function Panel({ children, className, ...props }: ComponentProps<typeof Base.Panel>) {
  return <Base.Panel {...props} keepMounted hidden={false}
    // Inert replaces hidden so nested rails can keep measuring their mounted DOM.
    render={(attributes, state) => <div {...attributes} inert={!state.open} />}
    className={cnState(cn('grid min-w-0 grid-cols-[minmax(0,1fr)] transition-[grid-template-rows,opacity] duration-(--dur-open) ease-out data-[open]:grid-rows-[1fr] data-[open]:opacity-100 data-[closed]:grid-rows-[0fr] data-[closed]:opacity-0'), className)}>
    <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
  </Base.Panel>;
}
export const Collapsible = { Root: Base.Root, Trigger: Base.Trigger, Panel };
