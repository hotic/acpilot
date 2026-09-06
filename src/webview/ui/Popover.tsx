import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pin, Search, X } from 'lucide-react';
import { cn } from './cn';

// Overlays attach to the shell root (not body): tokens / data-theme live on the shell root, and portaling out would lose the theme.
// The composer is wrapped in a BorderBeam (overflow hidden), so overlays can't live inside it — they must portal.
export const ShellLayerContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

type Side = 'top' | 'bottom';
type Align = 'start' | 'end';

export interface PopoverApi {
  open: boolean;
  toggle: () => void;
  ref: RefObject<HTMLButtonElement | null>;
}

export interface PopoverProps {
  side?: Side;
  align?: Align;
  content: (close: () => void) => ReactNode;
  children: (api: PopoverApi) => ReactNode;
  panelClassName?: string;
  role?: 'menu' | 'dialog';
  // Notifies the outside on open / close (the composer uses it to know "a menu is open"); true on open, false on close or full unmount, always paired
  onOpenChange?: (open: boolean) => void;
}

// Trigger + panel. The panel position is computed from the anchor, with coordinates relative to the shell root; in the LAB the shell is CSS-zoomed, so measured width / layout width corrects for it
export function Popover({ side = 'bottom', align = 'start', content, children, panelClassName, role = 'dialog', onOpenChange }: PopoverProps) {
  const layer = useContext(ShellLayerContext);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>();
  const id = useId();
  const close = () => setOpen(false);

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
      {children({ open, toggle: () => setOpen(o => !o), ref: anchor })}
      {open && layer?.current && createPortal(
        <div
          ref={panel}
          id={id}
          role={role}
          style={style}
          className={cn(
            'absolute z-30 max-w-[calc(100%-2*var(--pad))] rounded-lg border border-line bg-bg-1 p-1 shadow-pop',
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
  description?: string;
  // Lead mark (agent vendor mark and the like), --icon sized
  icon?: ReactNode;
  // Faint small text at the row's end (e.g. the current family's params), before the check
  meta?: string;
  checked?: boolean;
  // radio (default): single-select with a check; checkbox: toggle row where checked means on
  kind?: 'radio' | 'checkbox';
  disabled?: boolean;
  // Group heading: inserts a small heading line before this item when it differs from the previous one (the first group's heading shows too)
  section?: string;
  // Remove button at the row's end (shows on hover / focus); clicking it doesn't close the menu
  onRemove?: () => void;
  // Pinning: items with onPin show a pin button on hover; pinned items show it permanently (faint), clicking again unpins. Doesn't close the menu
  pinned?: boolean;
  onPin?: (pinned: boolean) => void;
}

export interface MenuListProps {
  items: MenuItem[];
  onSelect: (id: string) => void;
  // Top search box, filters by label / description as you type; typing directly on the list also goes into the search box
  searchable?: boolean;
  // Text shown when filtering leaves nothing
  empty?: string;
  // A footer at the bottom (built with MenuFooter): note / entry on the left, one action button on the right. The options area only ever holds options; actions live here
  footer?: ReactNode;
}

export interface MenuProps extends Omit<PopoverProps, 'content' | 'role'>, Omit<MenuListProps, 'onSelect' | 'footer'> {
  onSelect: (id: string) => void;
  footer?: (close: () => void) => ReactNode;
}

// Single-select menu: each item is one --row-tall row, the selected item gets a check at its end; ↑↓ move, ⏎ selects, Esc closes
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
export function MenuList({ items, onSelect, searchable, empty = '没有匹配', footer }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const shown = query ? items.filter(it => it.label.toLowerCase().includes(query) || it.description?.toLowerCase().includes(query)) : items;
  const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR) ?? [])];

  // On first open, focus the selected item and scroll to it: must finish before paint (layout effect), or the list flashes its top first and then jumps up
  useLayoutEffect(() => {
    const checked = ref.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]');
    if (searchable) { input.current?.focus(); checked?.scrollIntoView({ block: 'center' }); }
    else (checked ?? buttons()[0])?.focus();
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

  const twoLine = shown.some(it => it.description);
  return (
    <div ref={ref} onKeyDown={onKey} className="flex min-w-[160px] flex-col">
      {searchable && (
        <label className="mb-1 flex h-ctl shrink-0 items-center gap-2 border-b border-line px-2 text-fg-3">
          <Search className="size-icon shrink-0" strokeWidth={1.5} />
          <input
            ref={input}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="搜索"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-2 text-fg-1 outline-none placeholder:text-fg-3"
          />
        </label>
      )}
      <div className="flex max-h-pop flex-col overflow-y-auto">
        {shown.length === 0 && <div className="flex min-h-row items-center px-2 text-3 text-fg-3">{empty}</div>}
        {shown.map((it, i) => {
          const trailing = it.onRemove || it.onPin;
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
                onClick={() => onSelect(it.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 text-left text-2 text-fg-1 outline-none transition-colors',
                  'hover:bg-hover focus-visible:bg-hover disabled:text-fg-3 disabled:hover:bg-transparent',
                  twoLine ? 'py-1.5' : 'min-h-row',
                  trailing && 'pr-8',
                )}
              >
                {it.icon && <span className="flex size-icon shrink-0 items-center justify-center [&_svg]:size-icon">{it.icon}</span>}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{it.label}</span>
                  {it.description && <span className="truncate text-3 text-fg-3">{it.description}</span>}
                </span>
                {it.meta && <span className="shrink-0 text-3 text-fg-3">{it.meta}</span>}
                {it.checked && <Check className="size-icon shrink-0 text-fg-1" strokeWidth={2} />}
              </button>
              {it.onRemove && (
                <TrailingButton label={`移除 ${it.label}`} title="移除" onClick={it.onRemove}>
                  <X className="size-3" strokeWidth={2} />
                </TrailingButton>
              )}
              {it.onPin && (
                <TrailingButton label={`${it.pinned ? '取消钉住' : '钉住'} ${it.label}`} title={it.pinned ? '取消钉住' : '钉住'} shown={it.pinned} onClick={() => it.onPin!(!it.pinned)}>
                  <Pin className="size-3" strokeWidth={2} fill={it.pinned ? 'currentColor' : 'none'} />
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

// Small action button at a row's end: only shows on hover / focus by default, always visible (faint) when shown
function TrailingButton({ label, title, shown, onClick, children }: { label: string; title: string; shown?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title}
      onClick={e => { e.stopPropagation(); onClick(); }}
      className={cn(
        'absolute right-1 top-1/2 flex size-icon-ctl -translate-y-1/2 items-center justify-center rounded-sm text-fg-3 transition-opacity hover:bg-active hover:text-fg-1 focus-visible:opacity-100 group-hover/item:opacity-100 group-focus-within/item:opacity-100',
        shown ? 'opacity-100' : 'opacity-0',
      )}
    >
      {children}
    </button>
  );
}

export interface MenuFooterProps {
  // Left side: a note or an entry (clickable when onClick is given)
  children: ReactNode;
  onClick?: () => void;
  // One action button on the right
  action?: { label: string; icon: ReactNode; onClick: () => void };
}

// A --ctl-tall bar at the menu's bottom (modeled on Devin's agent menu): one divider between it and the options area
export function MenuFooter({ children, onClick, action }: MenuFooterProps) {
  const cls = 'flex h-ctl min-w-0 flex-1 items-center gap-1 px-2 text-left text-3 text-fg-3';
  return (
    <div className="mt-1 flex items-center gap-1 border-t border-line pt-1">
      {onClick
        ? <button type="button" onClick={onClick} className={cn(cls, 'rounded-md outline-none transition-colors hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1 [&_svg]:size-3 [&_svg]:shrink-0')}><span className="truncate">{children}</span></button>
        : <div className={cls}><span className="truncate">{children}</span></div>}
      {action && (
        <button
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
          className="flex size-ctl shrink-0 items-center justify-center rounded-md text-fg-3 outline-none transition-colors hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1 [&_svg]:size-icon"
        >
          {action.icon}
        </button>
      )}
    </div>
  );
}
