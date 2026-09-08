import { useState } from 'react';
import { ListEnd, Pencil, Trash2 } from 'lucide-react';
import type { Draft, QueuedPrompt, SessionControls } from '@shared/transcript';
import { t } from '../i18n';
import { IconButton } from '../ui/Button';
import { Row, RowTarget } from '../ui/Row';
import { Composer, type ComposerProps } from './Composer';
import { AttachmentTiles, EditAttachments } from './Attachments';

export interface QueueHandlers {
  remove: (id: string) => void;
  edit: (id: string, text: string, retainedAttachments: number[], attachments: Draft[]) => void;
}

// Prompts waiting for the running turn, stacked right above the composer the way Cursor shows them: one row each — queue glyph, the attachments
// as small tiles, the first line of the text — with a pencil and a bin at the end. The pencil (or the text) swaps the row for an inline editor;
// saving replaces the entry in place, so it keeps its position in the queue
export function Queue({ items, composer, blobUrl, on }: { items: QueuedPrompt[]; composer: ComposerProps; blobUrl?: (blob: string) => string; on?: QueueHandlers }) {
  const [editing, setEditing] = useState<string>();
  return (
    <div className="flex flex-col gap-gap px-page pt-2">
      {items.map(item => (
        editing === item.id && on
          ? <QueuedEditor key={item.id} item={item} composer={composer} blobUrl={blobUrl} onSave={(text, retained, drafts) => on.edit(item.id, text, retained, drafts)} onClose={() => setEditing(undefined)} />
          : <QueuedRow key={item.id} item={item} blobUrl={blobUrl} onEdit={on && (() => setEditing(item.id))} onRemove={on && (() => on.remove(item.id))} />
      ))}
    </div>
  );
}

function QueuedRow({ item, blobUrl, onEdit, onRemove }: { item: QueuedPrompt; blobUrl?: (blob: string) => string; onEdit?: () => void; onRemove?: () => void }) {
  const first = item.text.trim().split('\n')[0];
  return (
    <Row
      lead={<ListEnd className="size-icon" strokeWidth={1.5} />}
      title={t('queue.title')}
      className="queue-card rounded-lg px-pad py-1 text-1 text-fg-1"
      trailing={(onEdit || onRemove) && <>
        {onEdit && <IconButton title={t('queue.edit')} aria-label={t('queue.edit')} onClick={onEdit}><Pencil /></IconButton>}
        {onRemove && <IconButton title={t('queue.remove')} aria-label={t('queue.remove')} onClick={onRemove}><Trash2 /></IconButton>}
      </>}
    >
      {item.attachments.length > 0 && <AttachmentTiles attachments={item.attachments} blobUrl={blobUrl} />}
      {first && (
        <RowTarget className={onEdit && 'cursor-text'}>
          {onEdit
            ? <button type="button" onClick={onEdit} className="text-left">{first}</button>
            : first}
        </RowTarget>
      )}
    </Row>
  );
}

// The queued prompt goes out with whatever mode / model the session has when its turn comes, so the editor carries no option chips: text, kept attachments, new drafts
const NO_CONTROLS: SessionControls = { modes: [], options: [] };
const noop = () => undefined;

function QueuedEditor({ item, composer, blobUrl, onSave, onClose }: {
  item: QueuedPrompt; composer: ComposerProps; blobUrl?: (blob: string) => string;
  onSave: (text: string, retainedAttachments: number[], attachments: Draft[]) => void; onClose: () => void;
}) {
  const [retained, setRetained] = useState(() => item.attachments.map((_, i) => i));
  return (
    <div className="fade-in min-w-0">
      <Composer {...composer} running={false} disabled={false} controls={NO_CONTROLS} hidden={undefined} usage={undefined} canCompact={false} turns={[]}
        onSetMode={noop} onSetConfig={noop}
        edit={{ text: item.text, hasAttachments: retained.length > 0, onCancel: onClose,
          attachments: <EditAttachments attachments={item.attachments} retained={retained} blobUrl={blobUrl} onRemove={i => setRetained(r => r.filter(n => n !== i))} /> }}
        onSend={(text, drafts) => { onSave(text, retained, drafts); onClose(); }}
      />
    </div>
  );
}
