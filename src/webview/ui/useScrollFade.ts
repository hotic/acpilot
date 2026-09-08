import { useCallback } from 'react';

// Fade only edges with hidden content. Observe text updates and disclosure sizing,
// so streaming, resizing and mounting an initially empty output update immediately.
export function useScrollFade<T extends HTMLElement>() {
  return useCallback((element: T | null) => {
    if (!element) return;
    const update = () => {
      const overflow = element.scrollHeight - element.clientHeight;
      element.toggleAttribute('data-more-above', overflow > 1 && element.scrollTop > 1);
      element.toggleAttribute('data-more-below', overflow > 1 && overflow - element.scrollTop > 1);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const size = new ResizeObserver(update);
    size.observe(element);
    const content = new MutationObserver(update);
    content.observe(element, { childList: true, characterData: true, subtree: true });
    return () => {
      element.removeEventListener('scroll', update);
      size.disconnect();
      content.disconnect();
    };
  }, []);
}
