import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '../ui/cn';
import { Card } from '../ui/Card';
import { Chip, IconButton } from '../ui/Button';
import { Menu, type MenuItem } from '../ui/Popover';
import { t } from '../i18n';
import { useLayout } from './layout';

// Building blocks of the settings surface. Vertical rhythm: top bar → page switch → page (title-less in a sidebar) → Sections, each a titled Group of rows.
// Controls sit at a row's right edge; labels and descriptions wrap on the left

// The bar at the top of the surface, same anatomy as the chat Header: back at the left edge, title, one action at the right edge
export function TopBar({ title, onBack, action }: { title: ReactNode; onBack?: () => void; action?: ReactNode }) {
  return (
    <div className="flex h-hdr shrink-0 items-center gap-1 px-page shadow-[inset_0_-1px_0_0_var(--line)]">
      {onBack && (
        <IconButton onClick={onBack} title={t('common.back')} aria-label={t('common.back')} className="-ml-1.5">
          <ChevronLeft strokeWidth={1.5} />
        </IconButton>
      )}
      <span className="min-w-0 flex-1 truncate text-2 font-medium text-fg-strong">{title}</span>
      {action && <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">{action}</div>}
    </div>
  );
}

// Page body: one column of blocks; the editor host centres it at the content measure, the sidebar just fills
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto flex w-full max-w-(--content-w) flex-col gap-pad px-page py-pad-y', className)}>{children}</div>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="m-0 text-(length:--text-title) leading-(--text-title-lh) font-semibold text-fg-strong">{children}</h1>;
}

// Heading of a top-level section when several are stacked on one page (nav=stack / fold); the Section heads below sit one level under it
export function SectionHead({ children, count, action, className }: { children: ReactNode; count?: number; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-ctl items-center gap-gap', className)}>
      <h2 className="m-0 flex min-w-0 flex-1 items-baseline gap-2 text-(length:--text-h) leading-(--text-h-lh) font-medium text-fg-strong">
        <span className="truncate">{children}</span>
        {count !== undefined && <Count n={count} />}
      </h2>
      {action}
    </div>
  );
}

export function Count({ n, className }: { n: number; className?: string }) {
  return <span className={cn('shrink-0 text-3 font-normal text-fg-3 tabular-nums', className)}>{n}</span>;
}

export interface SectionProps {
  title?: ReactNode;
  desc?: ReactNode;
  count?: number;
  // One small action (a quiet Chip / IconButton), at the right of the title line
  action?: ReactNode;
  // Children are already Cards (several groups), not rows to be wrapped in one Group
  cards?: boolean;
  children: ReactNode;
}

// A titled group of rows. The section axis decides where the title lives: above the card as a heading with the description under it,
// above the card as a faint label with the description as a footnote, or inside the card as its first row
export function Section({ title, desc, count, action, cards, children }: SectionProps) {
  const { section } = useLayout();
  const body = cards ? <div className={cn('flex flex-col gap-2', section === 'inset' && 'acp-nested p-2')}>{children}</div> : children;
  // The action shares the title line only; the description runs the full width under it
  const titleLine = (cls: string) => (title !== undefined || action) && (
    <div className={cn('flex items-center gap-gap', action && 'min-h-ctl')}>
      <span className={cn('flex min-w-0 flex-1 items-baseline gap-2', cls)}><span className="truncate">{title}</span>{count !== undefined && <Count n={count} />}</span>
      {action}
    </div>
  );
  if (section === 'inset') {
    return (
      <Group>
        {(title !== undefined || desc || action) && (
          <div className="flex min-h-[calc(var(--ctl)+var(--pad))] flex-col justify-center px-pad py-1.5">
            {titleLine('text-2 font-medium text-fg-1')}
            {desc && <span className="text-3 text-fg-3">{desc}</span>}
          </div>
        )}
        {cards ? body : children}
      </Group>
    );
  }
  if (section === 'label') {
    return (
      <div className="flex flex-col gap-1.5">
        {(title !== undefined || action) && <div className="pl-pad">{titleLine('text-3 text-fg-3')}</div>}
        {cards ? body : <Group>{children}</Group>}
        {desc && <p className="m-0 px-pad text-3 text-fg-3">{desc}</p>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {(title !== undefined || desc || action) && (
        <div className="flex flex-col">
          {titleLine('text-2 font-medium text-fg-strong')}
          {desc && <p className="m-0 text-3 text-fg-3">{desc}</p>}
        </div>
      )}
      {cards ? body : <Group>{children}</Group>}
    </div>
  );
}

// A small text action for a Section's title line: quiet Chip, no caret
export function SectionAction({ icon, onClick, children, title }: { icon?: ReactNode; onClick: () => void; children?: ReactNode; title?: string }) {
  if (children === undefined) {
    return <IconButton onClick={onClick} title={title} aria-label={title} className="-mr-1.5">{icon}</IconButton>;
  }
  return <Chip caret={false} icon={icon} onClick={onClick} title={title} className="-mr-2 shrink-0">{children}</Chip>;
}

export function Group({ className, children }: { className?: string; children: ReactNode }) {
  return <Card className={cn('acp-group flex flex-col divide-y divide-line overflow-hidden', className)}>{children}</Card>;
}

// One setting: label + description on the left, the control on the right. `stack` puts the control under the text (wide controls)
export function Field({ label, desc, htmlFor, stack, children }: { label?: ReactNode; desc?: ReactNode; htmlFor?: string; stack?: boolean; children?: ReactNode }) {
  return (
    <div className={cn('flex gap-pad px-pad py-3', stack ? 'flex-col' : 'items-center')}>
      <div className="min-w-0 flex-1">
        {label !== undefined && <label htmlFor={htmlFor} className="block text-2 text-fg-1">{label}</label>}
        {desc && <div className="mt-0.5 text-3 text-fg-3 [overflow-wrap:anywhere]">{desc}</div>}
      </div>
      {children !== undefined && <div className={cn('flex shrink-0 items-center gap-2', stack && 'self-start')}>{children}</div>}
    </div>
  );
}

// A fact about the agent: name on the left, value at the right edge (mono for paths)
export function FactRow({ label, mono, children }: { label: ReactNode; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-h-[calc(var(--ctl)+var(--pad))] items-center gap-pad px-pad py-1.5">
      <span className="shrink-0 text-2 text-fg-2">{label}</span>
      <span className={cn('flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right text-2 text-fg-1', mono && 'font-mono text-mono')}>{children}</span>
    </div>
  );
}

// A faint single-line row inside a Group (empty states, notes)
export function Note({ children, shimmer }: { children: ReactNode; shimmer?: boolean }) {
  return <div className={cn('flex min-h-row items-center px-pad py-2 text-3 text-fg-3', shimmer && 'shimmer')}>{children}</div>;
}

export interface Option<V extends string> { value: V; label: string; icon?: ReactNode; hint?: string; disabled?: boolean }

// Two to four exclusive choices as a pill strip; the chosen one is filled, the rest are text until hovered
export function Segmented<V extends string>({ options, value, onChange, label }: { options: Option<V>[]; value: V; onChange: (v: V) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-ctl items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
            o.value === value ? 'bg-active text-fg-strong' : 'text-fg-2 hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1',
          )}
        >
          {o.icon && <span className="flex shrink-0 items-center [&_svg]:size-icon">{o.icon}</span>}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface Tab<V extends string> { value: V; label: string; icon?: ReactNode; count?: number; dim?: boolean; hint?: string }

// Underline tabs: a hairline under the whole strip, the selected tab's label underlined in strong ink. Scrolls sideways when the labels don't fit
export function TabStrip<V extends string>({ tabs, value, onChange, label, className }: { tabs: Tab<V>[]; value: V; onChange: (v: V) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cn('acp-tabs', className)}>
      {tabs.map(x => (
        <button key={x.value} type="button" role="tab" aria-selected={x.value === value} data-dim={x.dim || undefined} title={x.hint} onClick={() => onChange(x.value)} className="acp-tab">
          {x.icon && <span className="flex shrink-0 items-center [&_svg]:size-icon">{x.icon}</span>}
          <span className="truncate">{x.label}</span>
          {x.count !== undefined && <Count n={x.count} />}
        </button>
      ))}
    </div>
  );
}

// Dropdown select: a bordered Chip that opens the shared Menu; radio semantics, the current value gets the check
export function Select<V extends string>({ options, value, onChange, label, className }: { options: Option<V>[]; value: V; onChange: (v: V) => void; label: string; className?: string }) {
  const cur = options.find(o => o.value === value);
  const items: MenuItem[] = options.map(o => ({ id: o.value, label: o.label, icon: o.icon, hint: o.hint, disabled: o.disabled, checked: o.value === value }));
  return (
    <Menu side="bottom" align="end" items={items} onSelect={id => onChange(id as V)}>
      {({ open, toggle, ref }) => (
        <Chip
          ref={ref}
          data-open={open || undefined}
          onClick={toggle}
          aria-label={label}
          icon={cur?.icon}
          className={cn('min-w-(--ctl-w) justify-between border border-line bg-hover px-3 text-2 text-fg-1 hover:bg-active data-[open]:bg-active', className)}
        >
          {cur?.label ?? value}
        </Chip>
      )}
    </Menu>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="acp-switch" />;
}

// Numeric field committing on blur / Enter; shows `unit` after the box. Local text state so half-typed values don't round-trip through the host
export function NumberField({ value, onCommit, min, step, unit, label }: { value: number; onCommit: (v: number) => void; min?: number; step?: number; unit?: string; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || (min !== undefined && n < min)) { setText(String(value)); return; }
    if (n !== value) onCommit(n);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setText(String(value)); };
  return (
    <label className="inline-flex h-ctl items-center gap-2 rounded-md border border-line bg-hover px-3 text-2 text-fg-1 transition-colors focus-within:bg-active">
      <input
        type="number"
        inputMode="numeric"
        aria-label={label}
        value={text}
        min={min}
        step={step}
        onChange={e => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        className="w-(--num-w) min-w-0 bg-transparent text-right tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {unit && <span className="text-3 text-fg-3">{unit}</span>}
    </label>
  );
}

// Small label pill: scope (personal / project), transport, disabled …
export function Tag({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'muted'; className?: string }) {
  const TONE = { neutral: 'bg-hover text-fg-2', ok: 'bg-hover text-ok', warn: 'bg-hover text-warn', muted: 'text-fg-3' };
  return <span className={cn('inline-flex h-lead shrink-0 items-center whitespace-nowrap rounded-sm px-1.5 text-3', TONE[tone], className)}>{children}</span>;
}

// Status dot before a status line: ok / off
export function Dot({ ok }: { ok: boolean }) {
  return <span aria-hidden className={cn('inline-block size-(--dot) shrink-0 rounded-full', ok ? 'bg-ok' : 'bg-fg-3')} />;
}

// Filesystem path shortened for display: inside the workspace → relative, under home → ~/…
export function shortPath(path: string, env: { home: string; cwd: string }): string {
  const strip = (root: string) => (root && (path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`)) ? path.slice(root.length).replace(/^\//, '') : undefined);
  const rel = strip(env.cwd);
  if (rel !== undefined) return rel || '.';
  const home = strip(env.home);
  return home !== undefined ? `~/${home}` : path;
}

export interface ItemRowProps {
  lead?: ReactNode;
  title: ReactNode;
  desc?: ReactNode;
  mono?: boolean;
  trailing?: ReactNode;
  // Hover-revealed open button at the right edge (opens a file)
  onOpen?: () => void;
  // The whole row is the button (navigation): a chevron at the right edge
  onClick?: () => void;
  // Greyed out as a whole (disabled server, missing file)
  dim?: boolean;
  className?: string;
}

// A list row: lead slot · text (title + optional second line) · trailing slot. Same anatomy as ui/Row; one control height plus a pad tall,
// so one-line and two-line rows (and rows with a hidden open button) all land on the same height
export function ItemRow({ lead, title, desc, mono, trailing, onOpen, onClick, dim, className }: ItemRowProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'group/row flex min-h-[calc(var(--ctl)+var(--pad))] w-full items-center gap-gap px-pad py-1.5 text-left',
        onClick && 'transition-colors hover:bg-hover focus-visible:bg-hover',
        className,
      )}
    >
      {lead !== undefined && <span className={cn('flex size-lead shrink-0 items-center justify-center text-fg-3 [&_svg]:size-icon', dim && 'opacity-60')}>{lead}</span>}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate text-2', dim ? 'text-fg-3' : 'text-fg-1', mono && 'font-mono text-mono')}>{title}</span>
        {desc && <span className="truncate text-3 text-fg-3">{desc}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2">{trailing}</span>}
      {onOpen && (
        <IconButton title={t('common.open')} aria-label={t('common.open')} onClick={onOpen} className="-mr-1.5 text-fg-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100">
          <ExternalLink strokeWidth={1.5} />
        </IconButton>
      )}
      {onClick && <ChevronRight className="-mr-1 size-icon shrink-0 text-fg-3" strokeWidth={1.5} />}
    </Tag>
  );
}

// Path shown in mono, clickable when onOpen is given
export function PathText({ path, env, onOpen, className }: { path: string; env: { home: string; cwd: string }; onOpen?: (path: string) => void; className?: string }) {
  const text = shortPath(path, env);
  if (!onOpen) return <span title={path} className={cn('truncate font-mono text-mono text-fg-2', className)}>{text}</span>;
  return (
    <button type="button" title={path} onClick={() => onOpen(path)} className={cn('min-w-0 truncate rounded-sm font-mono text-mono text-fg-2 underline decoration-line-strong underline-offset-2 transition-colors hover:text-fg-1 hover:decoration-fg-3 focus-visible:text-fg-1', className)}>
      {text}
    </button>
  );
}

// The file / directory a run of rows came from. As a row inside a shared card (group=pathrow) it is the underlined path;
// as the head of its own card (group=cards) it is a plain mono path with the open button revealed on hover
export function SourceHead({ path, env, onOpen, variant }: { path: string; env: { home: string; cwd: string }; onOpen: (path: string) => void; variant: 'pathrow' | 'cards' }) {
  if (variant === 'pathrow') {
    return (
      <div className="flex min-h-row items-center px-pad pt-2 pb-0.5 text-3">
        <PathText path={path} env={env} onOpen={onOpen} className="text-fg-3" />
      </div>
    );
  }
  return (
    <div className="group/row flex min-h-row items-center gap-gap px-pad py-1">
      <PathText path={path} env={env} className="text-fg-2" />
      <span className="flex-1" />
      <IconButton title={t('common.open')} aria-label={t('common.open')} onClick={() => onOpen(path)} className="-mr-1.5 size-lead text-fg-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 [&_svg]:size-icon">
        <ExternalLink strokeWidth={1.5} />
      </IconButton>
    </div>
  );
}
