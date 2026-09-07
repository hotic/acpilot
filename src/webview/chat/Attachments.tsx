import { useState, type ReactNode } from 'react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import type { Attachment, Draft } from '@shared/transcript';
import { imageMimeOf } from '@shared/attachments';
import { t } from '../i18n';
import { cn } from '../ui/cn';
import { Lightbox } from './Lightbox';

// An image open in the Lightbox: the source to show and the name for labels
interface Preview {
  src: string;
  name?: string;
}

// Composer attachments use compact, equal-height labels. Image previews stay
// inline with file icons; names truncate only when the composer runs out of room.
export function DraftChips({ drafts, onRemove }: { drafts: Draft[]; onRemove: (index: number) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  if (!drafts.length) return null;
  return (
    <div className="flex flex-wrap gap-1 px-2 pt-2">
      {drafts.map((d, i) => (
        <Removable key={i} label={t('common.removeNamed', { name: d.name ?? t('common.image') })} onRemove={() => onRemove(i)}>
          <AttachmentTag
            name={d.name}
            image={d.kind === 'image' || (d.kind === 'file' && !!imageMimeOf(d.name))}
            src={d.kind === 'image' ? `data:${d.mimeType};base64,${d.data}` : undefined}
            onPreview={src => setPreview({ src, name: d.name })}
          />
        </Removable>
      ))}
      {preview && <Lightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

// Sent attachments reuse the composer labels. Images load from the session's blob
// directory; unavailable blobs retain an image icon and name without a preview action.
export function TurnAttachments({ attachments, blobUrl }: { attachments: Attachment[]; blobUrl?: (blob: string) => string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  return (
    <div className="scroll-thin flex shrink-0 gap-1 overflow-x-auto">
      {attachments.map((a, i) => (
        <AttachmentTag
          key={i}
          name={a.name}
          image={a.kind === 'image' || (a.kind === 'file' && !!imageMimeOf(a.name))}
          src={a.kind === 'image' && blobUrl && a.blob ? blobUrl(a.blob) : undefined}
          title={a.kind === 'file' ? a.uri : undefined}
          onPreview={src => setPreview({ src, name: a.name })}
        />
      ))}
      {preview && <Lightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

function AttachmentTag({ name = 'image.png', src, image, title, onPreview }: {
  name?: string;
  src?: string;
  image: boolean;
  title?: string;
  onPreview: (src: string) => void;
}) {
  const Tag = src ? 'button' : 'span';
  return (
    <Tag
      type={src ? 'button' : undefined}
      title={title ?? name}
      aria-label={src ? t('common.previewImage', { name }) : undefined}
      onClick={src ? () => onPreview(src) : undefined}
      className={cn(
        'inline-flex h-ctl-sm max-w-full min-w-0 shrink-0 items-center gap-1 rounded-sm bg-chip px-2 text-3 font-medium text-fg-2 [&_svg]:size-icon [&_svg]:shrink-0 [&_svg]:text-fg-3',
        src && 'cursor-zoom-in outline-none hover:bg-chip-hover focus-visible:ring-1 focus-visible:ring-focus active:bg-active',
      )}
    >
      {src
        ? <img src={src} alt="" className="size-icon-ctl shrink-0 rounded-xs object-cover" />
        : image ? <ImageIcon strokeWidth={1.5} /> : <FileText strokeWidth={1.5} />}
      <span className="truncate">{name}</span>
    </Tag>
  );
}

// Wraps a chip with a remove button in its top-right corner, shown on hover / focus
function Removable({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <span className="group/chip relative inline-flex max-w-full min-w-0">
      {children}
      <button
        type="button"
        aria-label={label}
        title={t('common.remove')}
        onClick={onRemove}
        className={cn(
          'absolute -top-1 -right-1 flex size-icon-ctl items-center justify-center rounded-full border border-line bg-bg-2 text-fg-2 opacity-0 shadow-pop transition-opacity',
          'hover:text-fg-1 focus-visible:opacity-100 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100',
        )}
      >
        <X className="size-3" strokeWidth={2} />
      </button>
    </span>
  );
}
