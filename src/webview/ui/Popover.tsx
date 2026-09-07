import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Search, X } from 'lucide-react';
import { cn } from './cn';
import { t } from '../i18n';

// Overlays attach to the shell root (not body): tokens / data-theme live on the shell root, and portaling out would lose the theme.
// The composer is wrapped in a BorderBeam (overflow hidden), so overlays can't live inside it — they must portal.
export const ShellLayerContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

type Side = 'top' | 'bottom';
type Align = 'start' | 'end';
// Width tiers (--pop-w-*): panels pick one instead of sizing to content, so menus opened from neighbouring chips look like one family
export type PopoverWidth = 'sm' | 'md' | 'lg' | 'xl';

const WIDTH: Record<PopoverWidth, string> = { sm: 'w-pop-sm', md: 'w-pop-md', lg: 'w-pop-lg', xl: 'w-pop-xl' };

export interface PopoverApi {
  open: boolean;
  toggle: () => void;
  ref: RefObject<HTMLButtonElement | null>;
  // Hover-trigger mode only: spread onto the trigger element
  hover?: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
}

export interface PopoverProps {
  side?: Side;
  align?: Align;
  width?: PopoverWidth;
  // click (default): toggle on click, close on outside / Esc. hover: open while the trigger or the panel is hovered / focused
  // (Cursor's context card) — the panel joins the hover area so its buttons stay reachable, a short close grace bridges the gap
  trigger?: 'click' | 'hover';
  content: (close: () => void) => ReactNode;
  children: (api: PopoverApi) => ReactNode;
  panelClassName?: string;
  role?: 'menu' | 'dialog';
  // Notifies the outside on open / close (the composer uses it to know "a menu is open"); true on open, false on close or full unmount, always paired
  onOpenChange?: (open: boolean) => void;
}

// Trigger + panel. The panel position is computed from the anchor, with coordinates relative to the shell root; in the LAB the shell is CSS-zoomed, so measured width / layout width corrects for it
export function Popover({ side = 'bottom', align = 'start', width, trigger = 'click', content, children, panelClassName, role = 'dialog', onOpenChange }: PopoverProps) {
  const layer = useContext(ShellLayerContext);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const id = useId();
  const close = () => setOpen(false);

  const hoverMode = trigger === 'hover';
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  // Enter opens after a beat so sweeping past doesn't flash the panel; leaving either surface starts the close grace
  const enter = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(true), 120); };
  const leave = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 250); };
  // Keyboard focus opens immediately — no dwell for focus
  const focusIn = () => { clearTimeout(timer.current); setOpen(true); };
  const hoverHandlers = hoverMode ? { onMouseEnter: enter, onMouseLeave: leave, onFocus: focusIn, onBlur: leave } : undefined;

  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    notify.current?.(true);
    return () => notify.current?.(false);
  }, [open]);

  useLayoutEffect(() => {
    const a = anchor.current, l = layer?.current, p = panel.current;
    if (!open || !a || !l || !p) return;
    const ar = a.getBoundingClientRect(), lr = l.getBoundingClientRect();
    const k = lr.width / l.offsetWidth || 1;
    const pad = parseFloat(getComputedStyle(l).getPropertyValue('--pad')) || 0;
    const w = p.offsetWidth, lw = l.offsetWidth;
    const s: CSSProperties = {};
    if (side === 'bottom') s.top = `calc(${(ar.bottom - lr.top) / k}px + var(--pop-gap))`;
    else s.bottom = `calc(${(lr.bottom - ar.top) / k}px + var(--pop-gap))`;
    if (align === 'start') s.left = Math.max(pad, Math.min((ar.left - lr.left) / k, lw - pad - w));
    else s.right = Math.max(pad, Math.min((lr.right - ar.right) / k, lw - pad - w));
    setStyle(s);
  }, [open, side, align, layer]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !anchor.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); anchor.current?.focus(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <>
      {children({ open, toggle: () => setOpen(o => !o), ref: anchor, hover: hoverHandlers })}
      {open && layer?.current && createPortal(
        <div
          ref={panel}
          id={id}
          role={role}
          style={style}
          {...hoverHandlers}
          className={cn(
            'absolute z-30 max-w-[calc(100%-2*var(--pad))] rounded-lg border border-line bg-bg-1 p-1 shadow-pop',
            width && WIDTH[width],
            !style && 'invisible',
            panelClassName,
          )}
        >
          {content(close)}
        </div>,
        layer.current,
      )}
    </>
  );
}

export interface MenuItem {
  id: string;
  label: string;
  // Second line under the label; makes the whole list two-line
  description?: string;
  // Tooltip only (title attribute): explanation that shouldn't cost a second line, e.g. a mode's description
  hint?: string;
  // Lead mark (agent vendor mark and the like), --icon sized
  icon?: ReactNode;
  // Faint small text at the row's end (e.g. the current family's params), before the check
  meta?: string;
  // A line under the label / description, spanning the text column (an account's quota bars); makes the row taller like description does
  extra?: ReactNode;
  checked?: boolean;
  // radio (default): single-select with a check; checkbox: toggle row where checked means on
  kind?: 'radio' | 'checkbox';
  disabled?: boolean;
  // Group heading: inserts a small heading line before this item when it differs from the previous one (the first group's heading shows too)
  section?: string;
  // Remove button at the row's end (shows on hover / focus); clicking it doesn't close the menu
  onRemove?: () => void;
}

export interface MenuListProps {
  items: MenuItem[];
  onSelect: (id: string) => void;
  // Top search box, filters by label / description as you type; typing directly on the list also goes into the search box
  searchable?: boolean;
  // Text shown when filtering leaves nothing
  empty?: string;
  // A bar above the list (built with MenuHeader): the navigation bar of a sub-page — back button, title, one action
  header?: ReactNode;
  // Below the list: a MenuFooter (entry / action) or a small form tied to the current selection. The options area only ever holds options; everything else lives here
  footer?: ReactNode;
}

export interface MenuProps extends Omit<PopoverProps, 'content' | 'role'>, Omit<MenuListProps, 'onSelect' | 'footer'> {
  onSelect: (id: string) => void;
  footer?: (close: () => void) => ReactNode;
}

// Single-select menu: each item is one --row-tall row, the selected item is tinted and gets a check at its end; ↑↓ move, ⏎ selects, Esc closes
export function Menu({ items, onSelect, searchable, empty, footer, ...pop }: MenuProps) {
  return (
    <Popover
      role="menu"
      {...pop}
      content={close => <MenuList items={items} searchable={searchable} empty={empty} footer={footer?.(close)} onSelect={id => { onSelect(id); close(); }} />}
    />
  );
}

const ITEM_SELECTOR = 'button[role="menuitemradio"]:not(:disabled), button[role="menuitemcheckbox"]:not(:disabled)';

// Menu body: optional search box + a scroll area of at most --pop-rows rows + optional footer. Custom panels (multi-view) can use it directly
export function MenuList({ items, onSelect, searchable, empty, header, footer }: MenuListProps) {
  const emptyText = empty ?? t('common.noMatch');
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const shown = query ? items.filter(it => it.label.toLowerCase().includes(query) || it.description?.toLowerCase().includes(query)) : items;
  const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? [])];

  // On first open, focus the selected item and center it in the list: must finish before paint (layout effect), or the list flashes its top first
  // and then jumps up. Center by adjusting the list's own scrollTop — scrollIntoView would drag every scrollable ancestor (the chat scroll) along
  useLayoutEffect(() => {
    const checked = ref.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]');
    if (searchable) input.current?.focus();
    else (checked ?? buttons()[0])?.focus();
    const list = ref.current?.querySelector<HTMLElement>('.overflow-y-auto');
    if (searchable && checked && list) {
      const lr = list.getBoundingClientRect(), cr = checked.getBoundingClientRect();
      list.scrollTop += cr.top - lr.top - (lr.height - cr.height) / 2;
    }
  }, []);

  const onKey = (e: ReactKeyboardEvent) => {
    const inInput = e.target === input.current;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const btns = buttons(), dir = e.key === 'ArrowDown' ? 1 : -1;
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      btns[i < 0 ? (dir > 0 ? 0 : btns.length - 1) : (i + dir + btns.length) % btns.length]?.focus();
    } else if (e.key === 'Enter' && inInput) {
      e.preventDefault();
      buttons()[0]?.click();
    } else if (searchable && !inInput && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      input.current?.focus();
    }
  };

  const twoLine = shown.some(it => it.description || it.extra);
  return (
    <div ref={ref} onKeyDown={onKey} className="flex min-w-[160px] flex-col">
      {header}
      {searchable && (
        <label className="mb-1 flex h-ctl shrink-0 items-center gap-2 border-b border-line px-2 text-fg-3">
          <Search className="size-icon shrink-0" strokeWidth={1.5} />
          <input
            ref={input}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={t('common.search')}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-2 text-fg-1 outline-none placeholder:text-fg-3"
          />
        </label>
      )}
      {/* Searchable lists keep their scrollbar gutter while filtering so rows don't jump in width */}
      <div className={cn('scroll-thin flex max-h-pop flex-col overflow-y-auto', searchable && 'scroll-stable')}>
        {shown.length === 0 && <div className="flex min-h-row items-center px-2 text-3 text-fg-3">{emptyText}</div>}
        {shown.map((it, i) => {
          return (
            <div key={it.id} className="group/item relative flex shrink-0 flex-col">
              {it.section && it.section !== shown[i - 1]?.section && (
                <div className={cn('px-2 pb-0.5 text-3 text-fg-3', i > 0 && 'mt-1 border-t border-line pt-1.5')}>{it.section}</div>
              )}
              <button
                type="button"
                role={it.kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitemradio'}
                aria-checked={it.checked || undefined}
                disabled={it.disabled}
                title={it.hint}
                onClick={() => onSelect(it.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 text-left text-2 text-fg-1 outline-none transition-colors',
                  // Radio: the selected row is tinted, and keeps the tint under hover / focus (hover is the lighter of the two, so it would read as un-selecting)
                  it.checked && it.kind !== 'checkbox' ? 'bg-active text-fg-strong' : 'hover:bg-hover focus-visible:bg-hover',
                  'disabled:text-fg-3 disabled:hover:bg-transparent',
                  twoLine ? 'py-1.5' : 'min-h-row',
                  it.onRemove && 'pr-8',
                )}
              >
                {it.icon && <span className="flex size-icon shrink-0 items-center justify-center [&_svg]:size-icon">{it.icon}</span>}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{it.label}</span>
                  {it.description && <span className="truncate text-3 text-fg-3">{it.description}</span>}
                  {it.extra}
                </span>
                {it.meta && <span className="shrink-0 text-3 text-fg-3">{it.meta}</span>}
                {it.checked && <Check className="size-icon shrink-0 text-fg-1" strokeWidth={2} />}
              </button>
              {it.onRemove && (
                <TrailingButton label={t('common.removeNamed', { name: it.label })} title={t('common.remove')} onClick={it.onRemove}>
                  <X className="size-3" strokeWidth={2} />
                </TrailingButton>
              )}
            </div>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

// Small action button at a row's end: only shows on hover / focus
function TrailingButton({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className="absolute right-1 top-1/2 flex size-icon-ctl -translate-y-1/2 items-center justify-center rounded-sm text-fg-3 opacity-0 transition-opacity hover:bg-active hover:text-fg-1 focus-visible:opacity-100 group-hover/item:opacity-100 group-focus-within/item:opacity-100"
    >
      {children}
    </button>
  );
}

export interface FooterAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

export interface MenuBarProps {
  // Square button at the left edge (back to the previous page)
  lead?: FooterAction;
  // Text in the middle: a title / note, or an entry into another page when onClick is given (then it gets a trailing chevron). Text only — icons go in lead / action
  children?: ReactNode;
  onClick?: () => void;
  // Square button at the right edge
  action?: FooterAction;
}

// A --ctl-tall bar at either edge of a menu, one divider between it and the options area (modeled on Devin's agent menu).
// Layout is [lead] [text …spacer…] [action]: the text takes its natural width, so an entry highlights as a small pill rather than the whole bar.
// Text is row-sized (text-2), not caption-sized — the bar is part of the menu, not a footnote to it
function MenuBar({ edge, lead, children, onClick, action }: MenuBarProps & { edge: 'top' | 'bottom' }) {
  const text = 'flex h-ctl min-w-0 items-center gap-1 px-2 text-left text-2';
  return (
    <div className={cn('flex items-center gap-1 border-line', edge === 'top' ? 'mb-1 border-b pb-1' : 'mt-1 border-t pt-1')}>
      {lead && <BarButton {...lead} />}
      {children !== undefined && (onClick
        ? (
          <button type="button" onClick={onClick} className={cn(text, 'rounded-md text-fg-2 outline-none transition-colors hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1')}>
            <span className="truncate">{children}</span>
            <ChevronRight className="size-3 shrink-0 text-fg-3" strokeWidth={1.75} />
          </button>
        )
        : <div className={cn(text, 'text-fg-1')}><span className="truncate">{children}</span></div>)}
      <span className="min-w-0 flex-1" />
      {action && <BarButton {...action} />}
    </div>
  );
}

// Navigation bar of a sub-page: back on the left, title in the middle, one action on the right
export function MenuHeader(p: MenuBarProps) { return <MenuBar edge="top" {...p} />; }
// Footer of a menu: a note or an entry on the left, one action on the right
export function MenuFooter(p: MenuBarProps) { return <MenuBar edge="bottom" {...p} />; }

function BarButton({ label, icon, onClick }: FooterAction) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-ctl shrink-0 items-center justify-center rounded-md text-fg-3 outline-none transition-colors hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1 [&_svg]:size-icon"
    >
      {icon}
    </button>
  );
}
