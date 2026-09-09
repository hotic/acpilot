import { useEffect, useRef, useState, type RefObject } from 'react';
import { FileText, Image as ImageIcon } from 'lucide-react';
import type { FileHit } from '@shared/protocol';
import { imageMimeOf } from '@shared/attachments';
import { Popover } from '../ui/Popover';
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
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = panel.current, item = list?.querySelector<HTMLElement>('[data-active]');
    if (!list || !item) return;
    const lr = list.getBoundingClientRect(), ir = item.getBoundingClientRect();
    if (ir.top < lr.top) list.scrollTop += ir.top - lr.top;
    else if (ir.bottom > lr.bottom) list.scrollTop += ir.bottom - lr.bottom;
  }, [active]);

  if (!hits.length && !empty) return null;
  return <Popover.Root open>
    <Popover.Portal><Popover.Positioner anchor={anchor} width="anchor" side="top"
      // Base UI measures at temporary coordinates with opacity zero. Those rows
      // must not receive hover and change the keyboard selection before placement.
      render={attributes => <div {...attributes} style={{ ...attributes.style,
        pointerEvents: attributes.style?.opacity === 0 ? 'none' : attributes.style?.pointerEvents,
      }} />}>
      {/* The popup is the list itself: cap at min(8 rows, available height) so the two max-height rules don't collide. */}
      <Popover.Popup finalFocus={false} ref={panel} role="listbox" className="scroll-thin flex max-h-[min(var(--spacing-pop),var(--available-height))] flex-col overflow-y-auto">
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
            // Layout can dispatch enter events under a stationary pointer. Only
            // deliberate mouse movement changes the keyboard's active result.
            onMouseMove={() => onHover(i)}
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
      </Popover.Popup>
    </Popover.Positioner></Popover.Portal>
  </Popover.Root>;
}
