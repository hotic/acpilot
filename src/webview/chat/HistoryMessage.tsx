import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import type { EditTurnRequest } from '@shared/protocol';
import type { UserTurn } from '@shared/transcript';
import { captureTurnSettings, controlsForTurn } from '@shared/turnSettings';
import { useAppearance } from '../appearance';
import { Composer, type ComposerProps } from './Composer';
import { EditAttachments } from './Attachments';
import { UserMessage } from './Turns';
import { cn } from '../ui/cn';
import { t } from '../i18n';

interface HistoryContextValue {
  sessionId: string;
  composer: ComposerProps;
  edit: (request: EditTurnRequest) => Promise<void>;
  editing?: number;
  select: (index?: number) => void;
}

export const HistoryContext = createContext<HistoryContextValue | undefined>(undefined);

// One frame per prompt, kept mounted while the card and its inline editor swap inside it: it carries the sticky positioning
// (so a card stuck at the top opens its editor right there instead of jumping back to its natural place) and animates its own
// height across the swap while the incoming content fades in — the card → editor step Cursor makes. Automatic prompts are plain rows
export function HistoryMessage(p: { turn: UserTurn; index: number; turnIndex: number; blobUrl?: (blob: string) => string }) {
  const context = useContext(HistoryContext);
  const { motion } = useAppearance();
  const frame = useRef<HTMLDivElement>(null);
  // Height measured right before a swap; the layout effect animates from it once the replacement has laid out
  const from = useRef<number>(undefined);
  const [swaps, setSwaps] = useState(0);
  const editor = context && context.editing === p.turnIndex ? context : undefined;
  const editing = !!editor;
  const swap = (index?: number) => {
    from.current = frame.current?.offsetHeight;
    setSwaps(n => n + 1);
    context!.select(index);
  };
  useLayoutEffect(() => {
    const el = frame.current;
    const start = from.current;
    from.current = undefined;
    if (!el || start === undefined) return;
    const end = el.offsetHeight;
    if (start === end || motion === 'none' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const duration = parseFloat(getComputedStyle(el).getPropertyValue('--dur-open')) || 0;
    el.style.overflow = 'hidden';
    const animation = el.animate([{ height: `${start}px` }, { height: `${end}px` }], { duration, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' });
    const done = () => { el.style.overflow = ''; };
    animation.onfinish = done;
    animation.oncancel = done;
    return () => animation.cancel();
  }, [editing, motion]);
  if (p.turn.auto) return <UserMessage {...p} />;
  const editable = !!context && !context.composer.disabled && !context.composer.running;
  return (
    <div ref={frame} className="sticky top-0 z-10 flex min-w-0 shrink-0 flex-col">
      <div key={swaps} className={cn('flex min-w-0 flex-col', swaps > 0 && 'fade-in')}>
        {editor
          ? <HistoryEditor {...p} context={editor} onClose={() => swap(undefined)} />
          : <UserMessage {...p} onEdit={editable ? () => swap(p.turnIndex) : undefined} />}
      </div>
    </div>
  );
}

function HistoryEditor({ turn, turnIndex, blobUrl, context: c, onClose }: {
  turn: UserTurn; turnIndex: number; blobUrl?: (blob: string) => string; context: HistoryContextValue; onClose: () => void;
}) {
  const [controls, setControls] = useState(() => controlsForTurn(c.composer.controls, turn.settings));
  const [retained, setRetained] = useState(() => (turn.attachments ?? []).map((_, i) => i));
  const [turnCount] = useState(c.composer.turns.length);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  return <div className="flex min-w-0 flex-col gap-gap">
    <Composer {...c.composer} running={false} disabled={pending || c.composer.disabled || c.composer.running}
      controls={controls} usage={undefined} canCompact={false}
      onNotice={setError}
      onSetMode={modeId => setControls(c => ({ ...c, modeId }))}
      onSetConfig={(id, value) => setControls(c => ({ ...c, options: c.options.map(o => o.id === id ? { ...o, value } : o) }))}
      edit={{ text: turn.text, hasAttachments: retained.length > 0, onCancel: onClose,
        attachments: <EditAttachments attachments={turn.attachments ?? []} retained={retained} blobUrl={blobUrl} disabled={pending} onRemove={i => setRetained(r => r.filter(n => n !== i))} />,
      }}
      onSend={async (text, attachments) => {
        setError(undefined);
        setPending(true);
        try {
          await c.edit({ sessionId: c.sessionId, turnIndex, turnCount, originalText: turn.text, turnId: turn.id,
            text, attachments, retainedAttachments: retained, settings: captureTurnSettings(controls) });
          onClose();
        } finally { setPending(false); }
      }}
    />
    <p className="px-pad text-3 text-fg-3">{t('history.replace')}</p>
    {error && <p role="alert" className="px-pad text-2 text-danger">{error}</p>}
  </div>;
}
