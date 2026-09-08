import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Collapse } from './Collapse';
import { Row, type RowProps } from './Row';

// An expandable row: the summary is just a Row (button), the body expands with a height animation, indented to align with the lead slot.
// The parent container is a flex column so the button spans the full row
export interface DisclosureProps extends Omit<RowProps, 'as' | 'interactive' | 'onToggle'> {
  open?: boolean;
  defaultOpen?: boolean;
  body: ReactNode;
  indent?: boolean;
  onToggle?: (open: boolean) => void;
}

// Rule: a body that is indented past the lead slot (i.e. not full width) gets a rail down that slot; full-width bodies (cards, lists) get none
export function Disclosure({ body, open: controlled, defaultOpen = false, indent = true, onToggle, className, ...row }: DisclosureProps) {
  const [inner, setInner] = useState(defaultOpen);
  const open = controlled ?? inner;
  const toggle = () => { setInner(!open); onToggle?.(!open); };
  return (
    <div className={cn('group flex min-w-0 flex-col', className)} data-open={open || undefined}>
      <Row as="button" interactive aria-expanded={open} onClick={toggle} {...row} />
      <Collapse open={open} className="disclosure-body">
        <div className={cn('pt-1 pb-1.5', indent && row.lead !== undefined && 'pl-indent rail')}>{body}</div>
      </Collapse>
    </div>
  );
}
