import { createContext, useContext, useImperativeHandle, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { Menu as Base } from '@base-ui/react/menu';
import { ShellLayerContext, overlayWidth, popupClass, useOpenLifecycle, useShellPosition, type OverlayWidth } from './Overlay';
import { cn, cnState } from './cn';

const PopupRefContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

function Root({ open: controlled, defaultOpen = false, onOpenChange, onOpenChangeComplete, onOpenLifecycle, ...props }: ComponentProps<typeof Base.Root> & { onOpenLifecycle?: (open: boolean) => void }) {
  const [inner, setInner] = useState(defaultOpen);
  const popup = useRef<HTMLDivElement>(null);
  const open = controlled ?? inner;
  useOpenLifecycle(open, onOpenLifecycle);
  return <PopupRefContext.Provider value={popup}><Base.Root {...props} modal={false} open={open} onOpenChange={(next, details) => {
    onOpenChange?.(next, details);
    if (!details.isCanceled) setInner(next);
  }} onOpenChangeComplete={next => {
    // Run after Base UI's opening focus lifecycle, for both pointer and keyboard.
    // Radio menus resume at the current value; action menus start at the first row.
    if (next) {
      const rows = popup.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"]):not([disabled])');
      const selected = rows && [...rows].find(row => row.getAttribute('aria-checked') === 'true');
      (selected || rows?.[0])?.focus({ preventScroll: true });
    }
    onOpenChangeComplete?.(next);
  }} /></PopupRefContext.Provider>;
}
function Portal(props: Omit<ComponentProps<typeof Base.Portal>, 'container'>) {
  const layer = useContext(ShellLayerContext);
  return layer ? <Base.Portal {...props} container={layer} /> : null;
}
function Positioner({ width = 'md', className, side = 'bottom', align = 'start', sideOffset, collisionPadding, collisionBoundary, collisionAvoidance, ...props }: ComponentProps<typeof Base.Positioner> & { width?: OverlayWidth }) {
  const { shell, gap, pad, width: shellWidth } = useShellPosition();
  return <Base.Positioner side={side} align={align} sideOffset={sideOffset ?? gap}
    collisionBoundary={collisionBoundary ?? shell} collisionPadding={collisionPadding ?? pad}
    collisionAvoidance={collisionAvoidance ?? { side: 'flip', align: 'shift' }}
    {...props} className={cnState(cn('z-30', overlayWidth[width]), className)}
    style={state => ({ maxWidth: shellWidth ? shellWidth - pad * 2 : undefined, ...(typeof props.style === 'function' ? props.style(state) : props.style) })} />;
}
function Popup({ className, ref: forwardedRef, ...props }: ComponentProps<typeof Base.Popup>) {
  const contextRef = useContext(PopupRefContext);
  const localRef = useRef<HTMLDivElement>(null);
  const ref = contextRef ?? localRef;
  useImperativeHandle(forwardedRef, () => ref.current!, [ref]);
  return <Base.Popup {...props} ref={ref} className={cnState(cn(popupClass), className)} />;
}
export const optionClass = 'flex min-h-row w-full items-center gap-2 rounded-md px-2 text-left text-2 text-fg-1 outline-none transition-colors hover:bg-hover focus-visible:bg-hover data-[highlighted]:bg-hover disabled:text-fg-3 data-[disabled]:text-fg-3 disabled:hover:bg-transparent';
const radioClass = 'data-[checked]:bg-active data-[checked]:text-fg-strong data-[checked]:hover:bg-active data-[checked]:data-[highlighted]:bg-active data-[checked]:focus-visible:bg-active';
function Item({ className, ...props }: ComponentProps<typeof Base.Item>) {
  return <Base.Item render={<button type="button" />} nativeButton {...props} className={cnState(cn(optionClass), className)} />;
}
function RadioItem({ className, closeOnClick = true, ...props }: ComponentProps<typeof Base.RadioItem>) {
  return <Base.RadioItem render={<button type="button" />} nativeButton closeOnClick={closeOnClick} {...props} className={cnState(cn(optionClass, radioClass), className)} />;
}
export const DropdownMenu = { Root, Trigger: Base.Trigger, Portal, Positioner, Popup, Item, RadioItem, RadioGroup: Base.RadioGroup, CheckboxItem: Base.CheckboxItem, Group: Base.Group, GroupLabel: Base.GroupLabel, Separator: Base.Separator };
