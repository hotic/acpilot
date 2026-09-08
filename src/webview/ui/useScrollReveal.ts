import { useEffect, type RefObject } from 'react';

const SETTLE_MS = 800;

// Overlay scrollbars: base.css paints a thumb only on elements stamped data-scrolling, so the bar shows while
// its content moves and vanishes once it settles. One capturing listener on the shell root covers every
// scroller inside it, portaled menus included; each element keeps its own settle timer.
export function useScrollReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const onScroll = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      target.setAttribute('data-scrolling', '');
      clearTimeout(timers.get(target));
      timers.set(target, setTimeout(() => { target.removeAttribute('data-scrolling'); timers.delete(target); }, SETTLE_MS));
    };
    el.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll, { capture: true });
      for (const [target, timer] of timers) { clearTimeout(timer); target.removeAttribute('data-scrolling'); }
    };
  }, [root]);
}
