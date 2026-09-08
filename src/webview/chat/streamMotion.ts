import { useEffect, useState } from 'react';
import type { AnimateOptions } from 'streamdown';
import { useAppearance } from '../appearance';

// Incoming chunks render immediately. Only visual starts are staggered, with a
// bounded backlog so low-throughput agents never wait for a client-side batch.
export const STREAM_STAGGER_MS = 22;
export const STREAM_BACKLOG_MS = 320;
export const STREAM_DURATION_MS = 380;
const STREAM_ANIMATION: AnimateOptions = {
  animation: 'acpCharIn', sep: 'char', duration: STREAM_DURATION_MS,
  stagger: STREAM_STAGGER_MS, maxBacklogMs: STREAM_BACKLOG_MS,
};

export function useStreamMotion(streaming: boolean) {
  const { motion } = useAppearance();
  const [settling, setSettling] = useState(streaming);
  useEffect(() => {
    if (streaming || motion === 'none') { setSettling(streaming); return; }
    // Keep the renderer mounted until the final delayed character has settled.
    const timer = setTimeout(() => setSettling(false), STREAM_BACKLOG_MS + STREAM_DURATION_MS);
    return () => clearTimeout(timer);
  }, [streaming, motion]);
  return { animated: motion === 'none' ? false as const : STREAM_ANIMATION, animating: streaming || settling };
}
