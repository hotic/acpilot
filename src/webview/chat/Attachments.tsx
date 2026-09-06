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

// Composer drafts: one wrapping row above the textarea. Images are square thumbnails (click to preview), text / files are icon + name pills; hovering shows the remove button
export function DraftChips({ drafts, onRemove }: { drafts: Draft[]; onRemove: (index: number) => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  if (!drafts.length) return null;
  return (
    <div className="flex flex-wrap gap-1 px-2 pt-2">
      {drafts.map((d, i) => (
        <Removable key={i} label={t('common.removeNamed', { name: d.name ?? t('common.image') })} onRemove={() => onRemove(i)}>
          {d.kind === 'image'
            ? <Thumb src={`data:${d.mimeType};base64,${d.data}`} name={d.name} onPreview={src => setPreview({ src, name: d.name })} />
            : <Pill icon={d.kind === 'file' && imageMimeOf(d.name) ? <ImageIcon strokeWidth={1.5} /> : <FileText strokeWidth={1.5} />} name={d.name} />}
        </Removable>
      ))}
      {preview && <Lightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

// Attachments of a sent user turn, same visual language; image payloads load from the session's blob directory (blobUrl) and open in the
// Lightbox on click, a placeholder tile stands in when there is nothing to load (no blobBase in the LAB, or the blob never made it to disk)
export function TurnAttachments({ attachments, blobUrl }: { attachments: Attachment[]; blobUrl?: (blob: string) => string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  return (
    <div className="flex flex-wrap gap-1">
      {attachments.map((a, i) => a.kind === 'image'
        ? blobUrl && a.blob
          ? <SentImage key={i} src={blobUrl(a.blob)} name={a.name} onPreview={src => setPreview({ src, name: a.name })} />
          : <span key={i} className="flex size-thumb items-center justify-center rounded-md bg-hover text-fg-3 [&_svg]:size-icon-ctl"><ImageIcon strokeWidth={1.5} /></span>
        : <Pill key={i} icon={<FileText strokeWidth={1.5} />} name={a.name} title={a.kind === 'file' ? a.uri : undefined} />)}
      {preview && <Lightbox src={preview.src} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}

function Thumb({ src, name, onPreview }: { src: string; name?: string; onPreview: (src: string) => void }) {
  return (
    <button type="button" aria-label={t('common.previewImage', { name: name ?? t('common.image') })} title={name} onClick={() => onPreview(src)} className="block cursor-zoom-in rounded-md outline-none focus-visible:ring-1 focus-visible:ring-focus">
      <img src={src} alt={name ?? t('common.image')} className="size-thumb rounded-md bg-hover object-cover" />
    </button>
  );
}

function SentImage({ src, name, onPreview }: { src: string; name?: string; onPreview: (src: string) => void }) {
  return (
    <button type="button" aria-label={t('common.previewImage', { name: name ?? t('common.image') })} title={name} onClick={() => onPreview(src)} className="block max-w-full cursor-zoom-in rounded-md outline-none focus-visible:ring-1 focus-visible:ring-focus">
      <img src={src} alt={name ?? t('common.image')} className="max-h-[calc(3*var(--thumb))] max-w-full rounded-md object-contain" />
    </button>
  );
}

function Pill({ icon, name, title }: { icon: ReactNode; name: string; title?: string }) {
  return (
    <span title={title ?? name} className="inline-flex h-ctl max-w-full min-w-0 items-center gap-1 rounded-md bg-chip px-2 text-3 text-fg-2 [&_svg]:size-icon [&_svg]:shrink-0 [&_svg]:text-fg-3">
      {icon}
      <span className="truncate font-mono text-mono">{name}</span>
    </span>
  );
}

// Wraps a chip with a remove button in its top-right corner, shown on hover / focus
function Removable({ label, onRemove, children }: { label: string; onRemove: () => void; children: ReactNode }) {
  return (
    <span className="group/chip relative inline-flex max-w-full">
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
