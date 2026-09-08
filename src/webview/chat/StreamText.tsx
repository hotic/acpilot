import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAppearance } from '../appearance';
import { STREAM_BACKLOG_MS, STREAM_STAGGER_MS } from './streamMotion';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// Thought text is plain text on the wire. Preserve its literal Markdown, emoji
// and line breaks while sharing the prose animation instead of parsing it anew.
export function StreamText({ text, streaming }: { text: string; streaming?: boolean }) {
  const [animateRun, setAnimateRun] = useState(!!streaming);
  const settle = useCallback(() => setAnimateRun(false), []);
  return animateRun ? <LiveStreamText text={text} streaming={streaming} onSettled={settle} /> : text;
}

function LiveStreamText({ text, streaming, onSettled }: { text: string; streaming?: boolean; onSettled: () => void }) {
  const { motion } = useAppearance();
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef({ text: '', count: 0, lastStart: 0 });
  const glyphs = useMemo(() => [...segmenter.segment(text)].map(part => part.segment), [text]);
  const now = performance.now();
  const appended = text.startsWith(previous.current.text);
  const start = appended ? previous.current.count : 0;
  const count = Math.max(0, glyphs.length - start);
  const base = appended ? Math.max(now, previous.current.lastStart) : now;
  const stagger = Math.min(STREAM_STAGGER_MS, Math.max(0, now + STREAM_BACKLOG_MS - base) / Math.max(1, count));
  useLayoutEffect(() => {
    previous.current = { text, count: glyphs.length, lastStart: count ? base + (count - 1) * stagger : previous.current.lastStart };
  });
  useLayoutEffect(() => {
    if (streaming) return;
    // Finished CSS animations with fill-mode both retain their effects. Release
    // the glyph tree after the actual final animation settles, including cancellation.
    const pending = ref.current?.getAnimations({ subtree: true }).filter(animation => animation.playState !== 'finished') ?? [];
    if (!pending.length) { onSettled(); return; }
    let disposed = false;
    void Promise.allSettled(pending.map(animation => animation.finished)).then(() => {
      if (!disposed) onSettled();
    });
    return () => { disposed = true; };
  }, [streaming, text, motion, onSettled]);
  // Motion-off retains the live cursor state without creating per-glyph DOM.
  if (motion === 'none') return text;
  return <span ref={ref} className="stream-text">{glyphs.map((glyph, index) => /^\s+$/u.test(glyph) ? glyph : <Glyph key={`${index}:${glyph}`} value={glyph}
    enter={!!streaming && appended && index >= start}
    delay={Math.max(0, base - now + (index - start) * stagger)} />)}</span>;
}

const Glyph = memo(function Glyph({ value, enter, delay }: { value: string; enter: boolean; delay: number }) {
  // A glyph owns its birth animation; later chunks cannot restart or cancel it.
  const [birth] = useState({ enter, delay });
  return <span className={birth.enter ? 'stream-glyph' : undefined}
    style={birth.enter ? { '--glyph-delay': `${birth.delay}ms` } as CSSProperties : undefined}>{value}</span>;
}, (previous, next) => previous.value === next.value);
