import { ArrowUp, Square } from 'lucide-react';
import { MetalFx } from 'metal-fx';
import { useAppearance } from '../appearance';
import { cn } from '../ui/cn';
import { t } from '../i18n';
import { METAL_PRESET, METAL_VARIANT } from './presets';

export interface SendButtonProps {
  running: boolean;
  filled: boolean;
  // metal mode hands the theme to metal-fx (it follows the OS prefers-color-scheme by default, not the shell)
  theme?: 'dark' | 'light';
  onClick?: () => void;
}

// metal-fx throws directly inside an effect when there's no WebGL, tearing down the whole React tree; probe once, and fall back to the inverted-neutral look without it
let webgl: boolean | undefined;
function hasWebGL(): boolean {
  if (webgl === undefined) {
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') ?? c.getContext('webgl'));
    } catch { webgl = false; }
  }
  return webgl;
}

// Send / stop in one, a --ctl-sm flat button, one tier below the toolbar chips' neighbors. Dim when empty, lit when there's text or a run in progress.
// Three modes: accent lights up with the accent color; icon is inverted-neutral; metal adds a silver ring around the same solid surface.
// MetalFx clears the child's background, so the wrapper owns the inverted fill and icon color.
export function SendButton({ running, filled, theme = 'dark', onClick }: SendButtonProps) {
  const { send, motion } = useAppearance();
  const on = filled || running;
  const metal = send === 'metal' && on && hasWebGL();
  const button = (
    <button
      type="button"
      aria-label={running ? t('composer.stop') : t('composer.send')}
      onClick={onClick}
      disabled={!on}
      data-on={on || undefined}
      data-metal={metal || undefined}
      className={cn(
        'send-btn inline-flex size-ctl-sm shrink-0 items-center justify-center rounded-md [&_svg]:size-icon disabled:cursor-default',
        send === 'accent' && on && '[--send-bg-on:var(--accent)] [--send-ink-on:var(--accent-fg)]',
      )}
    >
      {running ? <Square className="size-3! fill-current" strokeWidth={0} /> : <ArrowUp strokeWidth={2} />}
    </button>
  );
  if (!metal) return button;
  return (
    <MetalFx variant={METAL_VARIANT} preset={METAL_PRESET} theme={theme} paused={motion === 'none'} className="shrink-0 rounded-md bg-btn-1! text-btn-1-fg!">
      {button}
    </MetalFx>
  );
}
