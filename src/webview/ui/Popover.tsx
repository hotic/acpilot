import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

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
  // In-flow cards can sit at either viewport edge; prefer the side with room.
  flip?: boolean;
  align?: Align;
  width: PopoverWidth;
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
export function Popover({ side = 'bottom', flip = false, align = 'start', width, trigger = 'click', content, children, panelClassName, role = 'dialog', onOpenChange }: PopoverProps) {
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
    const position = () => {
      const ar = a.getBoundingClientRect(), lr = l.getBoundingClientRect();
      const k = lr.width / l.offsetWidth || 1;
      const pad = parseFloat(getComputedStyle(l).getPropertyValue('--pad')) || 0;
      const w = p.offsetWidth, lw = l.offsetWidth;
      const s: CSSProperties = {};
      const above = ar.top - Math.max(0, lr.top), below = Math.min(window.innerHeight, lr.bottom) - ar.bottom;
      const needed = p.getBoundingClientRect().height + pad * k;
      const placedSide = flip && (side === 'top' ? above < needed && below > above : below < needed && above > below)
        ? (side === 'top' ? 'bottom' : 'top') : side;
      if (placedSide === 'bottom') s.top = `calc(${(ar.bottom - lr.top) / k}px + var(--pop-gap))`;
      else s.bottom = `calc(${(lr.bottom - ar.top) / k}px + var(--pop-gap))`;
      if (align === 'start') s.left = Math.max(pad, Math.min((ar.left - lr.left) / k, lw - pad - w));
      else s.right = Math.max(pad, Math.min((lr.right - ar.right) / k, lw - pad - w));
      setStyle(s);
    };
    position();
    // Sidebar resizing and changed model labels must reposition an open panel.
    const observer = new ResizeObserver(position);
    observer.observe(l);
    observer.observe(a);
    observer.observe(p);
    if (flip) l.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); l.removeEventListener('scroll', position, true); };
  }, [open, side, flip, align, layer]);

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
            WIDTH[width],
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
