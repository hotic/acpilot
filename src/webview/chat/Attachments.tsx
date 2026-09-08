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

// Composer images use individual thumbnails; other attachments keep compact file labels.
export function DraftChips({ drafts, onRemove }: { drafts: Draft[]; onRemove?: (index: number) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  if (!drafts.length) return null;
  return (
    <div className="flex flex-wrap items-start gap-gap px-pad pt-gap">
      {drafts.map((d, i) => (
        <Removable key={d.kind === 'file' ? d.uri : `${d.name ?? d.kind}-${i}`} label={t('common.removeNamed', { name: d.name ?? t('common.image') })} onRemove={onRemove ? () => onRemove(i) : undefined}>
          <AttachmentTag
            thumbnail
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
          key={a.kind === 'file' ? a.uri : a.blob ?? `${a.kind}-${i}`}
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

// Attachments of a queued prompt, inline before its text: images as square tiles (the "little grid" Cursor shows), the rest as the usual pill
export function AttachmentTiles({ attachments, blobUrl }: { attachments: Attachment[]; blobUrl?: (blob: string) => string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  return (
    <span className="flex shrink-0 self-center items-center gap-1">
      {attachments.map((a, i) => {
        const key = a.kind === 'file' ? a.uri : a.blob ?? `${a.kind}-${i}`;
        const src = a.kind === 'image' && blobUrl && a.blob ? blobUrl(a.blob) : undefined;
        return src
          ? <button key={key} type="button" title={a.name} aria-label={t('common.previewImage', { name: a.name ?? t('common.image') })} onClick={() => setPreview({ src, name: a.name })}
              className="flex size-lead shrink-0 cursor-zoom-in overflow-hidden rounded-xs outline-none hover:ring-1 hover:ring-fg-3 focus-visible:ring-1 focus-visible:ring-focus">
              <img src={src} alt="" className="size-full object-cover" />
            </button>
          : <AttachmentTag key={key} name={a.name} image={a.kind === 'image' || (a.kind === 'file' && !!imageMimeOf(a.name))} title={a.kind === 'file' ? a.uri : undefined} onPreview={() => undefined} />;
      })}
      {preview && <Lightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />}
    </span>
  );
}

// Retained attachments share the draft thumbnails, including the corner removal button.
export function EditAttachments({ attachments, retained, blobUrl, disabled, onRemove }: {
  attachments: Attachment[]; retained: number[]; blobUrl?: (blob: string) => string; disabled?: boolean; onRemove: (index: number) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  if (!retained.length) return null;
  return (
    <div className="flex flex-wrap gap-gap px-pad pt-gap">
      {retained.map(i => {
        const attachment = attachments[i]!;
        const src = attachment.kind === 'image' && blobUrl && attachment.blob ? blobUrl(attachment.blob) : undefined;
        return <Removable key={i} disabled={disabled} label={t('common.removeNamed', { name: attachment.name ?? t('common.image') })} onRemove={() => onRemove(i)}>
          <AttachmentTag thumbnail name={attachment.name} src={src}
            image={attachment.kind === 'image' || (attachment.kind === 'file' && !!imageMimeOf(attachment.name))}
            title={attachment.kind === 'file' ? attachment.uri : undefined}
            onPreview={src => setPreview({ src, name: attachment.name })} />
        </Removable>;
      })}
      {preview && <Lightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

function AttachmentTag({ name = 'image.png', src, image, title, thumbnail, onPreview }: {
  name?: string;
  src?: string;
  image: boolean;
  title?: string;
  thumbnail?: boolean;
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
        'inline-flex max-w-full min-w-0 shrink-0 items-center rounded-sm bg-chip text-fg-2 [&_svg]:size-icon [&_svg]:shrink-0 [&_svg]:text-fg-3',
        thumbnail && image ? 'size-thumb justify-center overflow-hidden' : 'h-ctl-sm gap-1 px-2 text-3 font-medium',
        src && 'cursor-zoom-in outline-none hover:bg-chip-hover focus-visible:ring-1 focus-visible:ring-focus active:bg-active',
      )}
    >
      {src
        ? <img src={src} alt="" className={thumbnail && image ? 'size-full object-cover' : 'size-icon-ctl shrink-0 rounded-xs object-cover'} />
        : image ? <ImageIcon strokeWidth={1.5} /> : <FileText strokeWidth={1.5} />}
      {!(thumbnail && image) && <span className="truncate">{name}</span>}
    </Tag>
  );
}

// Wraps a chip with a remove button in its top-right corner, shown on hover / focus
function Removable({ label, onRemove, disabled, children }: { label: string; onRemove?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <span className="group/chip relative inline-flex max-w-full min-w-0">
      {children}
      {onRemove && <button
        type="button"
        disabled={disabled}
        aria-label={label}
        title={t('common.remove')}
        onClick={onRemove}
        className={cn(
          'absolute top-0 right-0 flex size-icon-ctl items-center justify-center rounded-xs bg-bg-2 text-fg-2 opacity-0 transition-opacity',
          'hover:text-fg-1 focus-visible:opacity-100 group-hover/chip:opacity-100 group-focus-within/chip:opacity-100',
        )}
      >
        <X className="size-3" strokeWidth={2} />
      </button>}
    </span>
  );
}
