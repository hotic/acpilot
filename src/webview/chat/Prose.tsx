import { cloneElement, isValidElement, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Streamdown, type AnimateOptions, type Components } from 'streamdown';
import { createMathPlugin } from '@streamdown/math';
import { mermaid as mermaidDiagram } from '@streamdown/mermaid';
import type { TextBlock } from '@shared/transcript';
import type { Appearance } from '@shared/appearance';
import { useAppearance } from '../appearance';
import { CodeBlock } from './CodeBlock';
import { Link } from './Link';
import { useVsCodeTheme } from '../useVsCodeTheme';

// Full Markdown via streamdown: GFM + KaTeX + Mermaid, streaming-aware (remend repairs incomplete syntax mid-stream).
// All typography lives in tokens.css under .acp-prose — Tailwind never scans node_modules, so streamdown's own classes don't resolve here.

// singleDollarTextMath stays off: "$5 and $10" in prose must not become math
const PLUGINS = { math: createMathPlugin(), mermaid: mermaidDiagram };
// Module-level: streamdown's top-level memo compares props by reference, so every config object must be stable
const LINK_SAFETY = { enabled: false };
// Streamed words fade in one after another instead of a whole chunk landing at once (ACP agents send paragraph-sized updates, so
// without this the reply arrives in slabs). streamdown's animate plugin wraps only the words new since the last render and caps the
// backlog at 320ms, so a fast stream never trails the wire. The rules for `[data-sd-animate]` live in tokens.css, per motion axis
const ANIMATED: Record<Appearance['motion'], AnimateOptions | false> = {
  none: false,
  subtle: { animation: 'fadeIn', duration: 240, stagger: 24 },
  full: { animation: 'blurIn', duration: 320, stagger: 36 },
};
// The animate plugin is only mounted while `isAnimating`; the turn usually ends right after the last chunk, so the plugin
// stays on for one more cascade after the stream stops — otherwise the closing words snap in instead of fading
const SETTLE_MS = 400;

export function Prose({ block }: { block: TextBlock }) {
  const { motion } = useAppearance();
  const streaming = !!block.streaming;
  const animating = useSettled(streaming, ANIMATED[motion] ? SETTLE_MS : 0);
  // The turn heading already indicates waiting before the first visible words.
  if (!block.markdown.trim()) return null;
  return (
    <Streamdown
      mode={streaming || animating ? 'streaming' : 'static'}
      isAnimating={streaming || animating}
      animated={ANIMATED[motion]}
      controls={false}
      lineNumbers={false}
      codeBlockMaxHeight={0}
      tableMaxHeight={0}
      linkSafety={LINK_SAFETY}
      plugins={PLUGINS}
      components={COMPONENTS}
      className="acp-prose flex min-w-0 flex-col gap-gap text-1 text-fg-1"
    >
      {block.markdown}
    </Streamdown>
  );
}

// True while `on` and for `delay` ms after it drops; a zero delay follows `on` directly
function useSettled(on: boolean, delay: number): boolean {
  const [settled, setSettled] = useState(on);
  useEffect(() => {
    if (on || delay === 0) { setSettled(on); return; }
    const timer = setTimeout(() => setSettled(false), delay);
    return () => clearTimeout(timer);
  }, [on, delay]);
  return settled;
}

// streamdown routes fenced code through `code` and inline through `inlineCode`, telling them apart by a `data-block`
// marker that its default `pre` cloneElements onto the code child — so the `pre` override below must replicate that
// marker, and the `code` override must handle mermaid itself (MermaidBlock), since the plugin's renderer only runs inside the default component
const COMPONENTS: Components = {
  pre: ({ children }) => (isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-block': 'true' }) : children),
  code: ({ className, children }) => {
    const lang = /language-(\w+)/.exec(className ?? '')?.[1];
    const code = textOf(children).replace(/\n$/, '');
    return lang === 'mermaid' ? <MermaidBlock chart={code} /> : <CodeBlock code={code} />;
  },
  inlineCode: ({ children }) => <code>{children}</code>,
  a: Link,
  table: ({ children }) => (
    <div className="acp-table scroll-thin overflow-x-auto rounded-lg border border-conversation-line">
      <table>{children}</table>
    </div>
  ),
};

// hast children → plain text (the fenced-code mapping gets elements, not a string)
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

let mmdSeq = 0;

// Mermaid diagram: rendered off-DOM via the plugin's shared instance; while streaming (or on bad syntax) the source shows as a code block
function MermaidBlock({ chart }: { chart: string }) {
  const theme = useVsCodeTheme();
  const [svg, setSvg] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let dead = false;
    setFailed(false);
    // Debounced: the chart text changes with every streamed chunk, and partial syntax usually fails to parse
    const timer = setTimeout(() => {
      const id = `acp-mmd-${++mmdSeq}`;
      mermaidDiagram
        .getMermaid({ startOnLoad: false, theme: theme === 'dark' ? 'dark' : 'default' })
        .render(id, chart)
        .then(({ svg }) => { if (!dead) setSvg(svg); })
        .catch(() => {
          // mermaid drops its error graphic into the document under the render id
          document.getElementById(id)?.remove();
          document.getElementById(`d${id}`)?.remove();
          if (!dead) { setSvg(undefined); setFailed(true); }
        });
    }, 200);
    return () => { dead = true; clearTimeout(timer); };
  }, [chart, theme]);
  if (failed || !svg) return failed ? <CodeBlock code={chart} /> : <div className="acp-mermaid-pending" />;
  return <div className="acp-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}
