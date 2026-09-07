import { createContext, useContext, useState } from 'react';
import { X } from 'lucide-react';
import type { EditTurnRequest } from '@shared/protocol';
import type { UserTurn } from '@shared/transcript';
import { captureTurnSettings, controlsForTurn } from '@shared/turnSettings';
import { Composer, type ComposerProps } from './Composer';
import { TurnAttachments } from './Attachments';
import { UserMessage } from './Turns';
import { IconButton } from '../ui/Button';
import { t } from '../i18n';

interface HistoryContextValue {
  sessionId: string;
  composer: ComposerProps;
  edit: (request: EditTurnRequest) => Promise<void>;
  editing?: number;
  select: (index?: number) => void;
}

export const HistoryContext = createContext<HistoryContextValue | undefined>(undefined);

export function HistoryMessage(p: { turn: UserTurn; index: number; turnIndex: number; blobUrl?: (blob: string) => string }) {
  const context = useContext(HistoryContext);
  if (!context || p.turn.auto) return <UserMessage {...p} />;
  if (context.editing === p.turnIndex) return <HistoryEditor {...p} context={context} />;
  return <UserMessage {...p} editDisabled={context.composer.disabled || context.composer.running} onEdit={() => context.select(p.turnIndex)} />;
}

function HistoryEditor({ turn, turnIndex, blobUrl, context: c }: {
  turn: UserTurn; turnIndex: number; blobUrl?: (blob: string) => string; context: HistoryContextValue;
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
      edit={{ text: turn.text, hasAttachments: retained.length > 0, onCancel: () => c.select(undefined),
        attachments: retained.length > 0 && <div className="flex flex-wrap gap-gap px-pad pt-gap">{retained.map(i => <div key={i} className="flex min-w-0 items-center gap-gap">
          <TurnAttachments attachments={[turn.attachments![i]!]} blobUrl={blobUrl} />
          <IconButton disabled={pending} title={t('common.remove')} aria-label={t('common.removeNamed', { name: turn.attachments![i]!.name ?? t('common.image') })} onClick={() => setRetained(r => r.filter(n => n !== i))}><X /></IconButton>
        </div>)}</div>,
      }}
      onSend={async (text, attachments) => {
        setError(undefined);
        setPending(true);
        try {
          await c.edit({ sessionId: c.sessionId, turnIndex, turnCount, originalText: turn.text, turnId: turn.id,
            text, attachments, retainedAttachments: retained, settings: captureTurnSettings(controls) });
          c.select(undefined);
        } finally { setPending(false); }
      }}
    />
    <p className="px-pad text-3 text-fg-3">{t('history.replace')}</p>
    {error && <p role="alert" className="px-pad text-2 text-danger">{error}</p>}
  </div>;
}
