import { X } from 'lucide-react';
import { t } from '../i18n';
import { Dialog } from '../ui/Dialog';

// Full-shell image preview, portaled into the shell layer (same home as Popover, so theme tokens and the shell's
// positioning context apply). The image keeps its natural size, capped to the shell; backdrop click / Esc / the corner button close it
export function Lightbox({ src, name, onClose }: { src: string; name?: string; onClose: () => void }) {
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Popup aria-label={name ?? t('common.image')} onClick={onClose} className="absolute inset-0 z-40 flex items-center justify-center bg-scrim p-pad">
      <img
        src={src}
        alt={name ?? t('common.image')}
        title={name}
        onClick={e => e.stopPropagation()}
        className="max-h-full max-w-full rounded-md object-contain shadow-pop"
      />
      <button
        type="button"
        aria-label={t('common.close')}
        title={t('common.close')}
        onClick={onClose}
        className="absolute top-pad right-pad flex size-ctl items-center justify-center rounded-md text-fg-2 outline-none transition-colors hover:bg-chip-hover hover:text-fg-1 focus-visible:bg-chip-hover focus-visible:text-fg-1 [&_svg]:size-icon"
      >
        <X strokeWidth={1.5} />
      </button>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
