import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '../ui/Button';
import { t } from '../i18n';

export function OutputCopy({ text, label: idleLabel }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => { setState('idle'); }, [text]);
  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [state]);
  const label = state === 'copied' ? t('code.copied') : state === 'failed' ? t('code.copyFailed')
    : idleLabel;
  return <div className="code-copy absolute z-3 top-gap-half right-gap-half opacity-0 transition-opacity duration-(--code-copy-duration) ease-out group-hover/code-output:opacity-100 group-focus-within/code-output:opacity-100 [@media(hover:none)]:opacity-100 motion-reduce:transition-none">
    <IconButton size="sm" className="bg-bg-2 ring ring-conversation-line" title={label} aria-label={label} onClick={async () => {
      try { await navigator.clipboard.writeText(text); setState('copied'); } catch { setState('failed'); }
    }}>{state === 'copied' ? <Check /> : <Copy />}</IconButton>
    <span className="sr-only" role="status">{state === 'idle' ? '' : label}</span>
  </div>;
}
