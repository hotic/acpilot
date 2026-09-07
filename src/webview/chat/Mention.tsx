import { useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Image as ImageIcon } from 'lucide-react';
import type { FileHit } from '@shared/protocol';
import { imageMimeOf } from '@shared/attachments';
import { ShellLayerContext } from '../ui/Popover';
import { cn } from '../ui/cn';
import { t } from '../i18n';

// An @ token under the caret: where it starts in the text and what has been typed after it
export interface MentionSpan {
  start: number;
  query: string;
}

// The @ must sit at the start or after whitespace, and the query runs up to the caret without whitespace; anything else is a plain @ (emails, decorators)
export function mentionAt(text: string, caret: number): MentionSpan | undefined {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[2]!.length - 1, query: m[2]! } : undefined;
}

// Fetches hits for the current query (debounced, stale replies dropped) and keeps the active row in range.
// `ready` says the hits belong to the current query — until then the previous list is still shown but must not be picked from
export function useMentionHits(query: string | undefined, search: (q: string) => Promise<FileHit[]>) {
  // query is the one the list answers; undefined until the first reply, so an empty query is not mistaken for "already answered"
  const [hits, setHits] = useState<{ query?: string; list: FileHit[] }>({ list: [] });
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    // Closing invalidates whatever is in flight, so a late reply cannot refill the list
    const mine = ++seq.current;
    if (query === undefined) { setHits({ list: [] }); return; }
    const t = setTimeout(() => {
      void search(query).then(r => { if (seq.current === mine) { setHits({ query, list: r }); setActive(0); } });
    }, 60);
    return () => clearTimeout(t);
  }, [query, search]);
  const list = hits.list;
  const move = (dir: 1 | -1) => setActive(i => (list.length ? (i + dir + list.length) % list.length : 0));
  return { hits: list, ready: query !== undefined && hits.query === query, active, setActive, move };
}

interface MentionListProps {
  anchor: RefObject<HTMLElement | null>;
  hits: FileHit[];
  active: number;
  empty: boolean;
  onHover: (index: number) => void;
  onPick: (hit: FileHit) => void;
}

// The file list floating over the composer: as wide as the field, one --row per hit (name bright, directory faint). Keyboard handling stays in the textarea;
// the list only reflects the active row. Portals to the shell root like every overlay, since the composer's beam wrapper clips overflow
export function MentionList({ anchor, hits, active, empty, onHover, onPick }: MentionListProps) {
  const layer = useContext(ShellLayerContext);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>();

  // Re-anchor whenever the field changes size (chips added, text wrapping to a new line) — the field's top edge is what the list sits on
  useLayoutEffect(() => {
    const a = anchor.current, l = layer?.current;
    if (!a || !l) return;
    const place = () => {
      const ar = a.getBoundingClientRect(), lr = l.getBoundingClientRect();
      const k = lr.width / l.offsetWidth || 1;
      setStyle({ bottom: `calc(${(lr.bottom - ar.top) / k}px + var(--pop-gap))`, left: (ar.left - lr.left) / k, width: ar.width / k });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(a);
    return () => ro.disconnect();
  }, [anchor, layer]);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!layer?.current || (!hits.length && !empty)) return null;
  return createPortal(
    <div ref={panel} role="listbox" style={style} className={cn('scroll-thin absolute z-30 flex max-h-pop flex-col overflow-y-auto rounded-lg border border-line bg-bg-1 p-1 shadow-pop', !style && 'invisible')}>
      {!hits.length && <div className="flex min-h-row items-center px-2 text-3 text-fg-3">{t('mention.noFiles')}</div>}
      {hits.map((h, i) => {
        const cut = h.path.lastIndexOf('/');
        const Icon = imageMimeOf(h.path) ? ImageIcon : FileText;
        return (
          <button
            key={h.uri}
            type="button"
            role="option"
            aria-selected={i === active}
            data-active={i === active || undefined}
            onMouseEnter={() => onHover(i)}
            // mousedown would blur the textarea before click fires; preventing it keeps the caret where the @ is
            onMouseDown={e => e.preventDefault()}
            onClick={() => onPick(h)}
            className={cn('flex min-h-row w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-2 text-fg-1 outline-none transition-colors', i === active && 'bg-hover')}
          >
            <Icon className="size-icon shrink-0 text-fg-3" strokeWidth={1.5} />
            <span className="truncate font-mono text-mono">{cut >= 0 ? h.path.slice(cut + 1) : h.path}</span>
            {cut >= 0 && <span className="truncate text-3 text-fg-3">{h.path.slice(0, cut)}</span>}
          </button>
        );
      })}
    </div>,
    layer.current,
  );
}
