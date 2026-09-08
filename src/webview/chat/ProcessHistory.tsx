import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { t } from '../i18n';

// The process has its own viewport: growing history must not grow the conversation.
// Follow only while reading the bottom; scrolling up keeps the current place.
export function ProcessHistory({ open, running = false, children }: { open: boolean; running?: boolean; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  useLayoutEffect(() => {
    if (!open) return;
    const el = viewport.current!;
    const body = content.current!;
    const follow = () => { if (running && following.current) el.scrollTop = el.scrollHeight; };
    follow();
    // Observe both streamed content and responsive viewport changes, including
    // expanded tool outputs; no timer or smooth-scroll backlog is needed.
    const observer = new ResizeObserver(follow);
    observer.observe(body);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, running]);

  return (
    <div ref={viewport} className="process-history" role="region" aria-label={t('turns.processHistory')} tabIndex={0}
      onScroll={event => {
        const el = event.currentTarget;
        // Opening a disclosure can reset its scroll offset before layout settles.
        // Only user input suspends following; layout-generated scroll events cannot.
        if (open && el.scrollHeight - el.clientHeight - el.scrollTop <= 2) following.current = true;
      }}
      onWheel={event => { if (event.deltaY < 0) following.current = false; }}
      onPointerDown={() => { following.current = false; }}
      onTouchMove={() => { following.current = false; }}
      onKeyDown={event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) following.current = false; }}
    >
      <div ref={content} className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}
