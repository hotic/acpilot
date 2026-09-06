import type { ReactNode } from 'react';
import { FileText, Image as ImageIcon, X } from 'lucide-react';
import type { Attachment, Draft } from '@shared/transcript';
import { imageMimeOf } from '@shared/attachments';
import { cn } from '../ui/cn';

// Composer drafts: one wrapping row above the textarea. Images are square thumbnails, text / files are icon + name pills; hovering shows the remove button
export function DraftChips({ drafts, onRemove }: { drafts: Draft[]; onRemove: (index: number) => void }) {
  if (!drafts.length) return null;
  return (
    <div className="flex flex-wrap gap-1 px-2 pt-2">
      {drafts.map((d, i) => (
        <Removable key={i} label={`移除 ${d.name ?? '图片'}`} onRemove={() => onRemove(i)}>
          {d.kind === 'image'
            ? <Thumb src={`data:${d.mimeType};base64,${d.data}`} name={d.name} />
            : <Pill icon={d.kind === 'file' && imageMimeOf(d.name) ? <ImageIcon strokeWidth={1.5} /> : <FileText strokeWidth={1.5} />} name={d.name} />}
        </Removable>
      ))}
    </div>
  );
}

// Attachments of a sent user turn, same visual language; image payloads load from the session's blob directory (blobUrl), a placeholder tile stands in
// when there is nothing to load (no blobBase in the LAB, or the blob never made it to disk)
export function TurnAttachments({ attachments, blobUrl }: { attachments: Attachment[]; blobUrl?: (blob: string) => string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {attachments.map((a, i) => a.kind === 'image'
        ? blobUrl && a.blob
          ? <img key={i} src={blobUrl(a.blob)} alt={a.name ?? '图片'} title={a.name} className="max-h-[calc(3*var(--thumb))] max-w-full rounded-md object-contain" />
          : <span key={i} className="flex size-thumb items-center justify-center rounded-md bg-hover text-fg-3 [&_svg]:size-icon-ctl"><ImageIcon strokeWidth={1.5} /></span>
        : <Pill key={i} icon={<FileText strokeWidth={1.5} />} name={a.name} title={a.kind === 'file' ? a.uri : undefined} />)}
    </div>
  );
}

function Thumb({ src, name }: { src: string; name?: string }) {
  return <img src={src} alt={name ?? '图片'} title={name} className="size-thumb rounded-md bg-hover object-cover" />;
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
        title="移除"
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
