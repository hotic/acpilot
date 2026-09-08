import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import type { ThoughtBlock } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { Disclosure } from '../ui/Disclosure';
import { cn } from '../ui/cn';
import { useScrollFade } from '../ui/useScrollFade';

// Thought row: localized verb plus faint seconds. Live seconds tick from startedAt; durationSec freezes them when the block seals.
// The turn heading owns the Orb; thought rows keep a static icon and shimmer only while streaming.
export function Thought({ block }: { block: ThoughtBlock }) {
  const { toolLine } = useAppearance();
  const sec = useThoughtSeconds(block);
  const fade = useScrollFade<HTMLParagraphElement>();
  const lead = toolLine === 'text' ? undefined : <Brain className="size-icon" strokeWidth={1.5} />;
  return (
    <Disclosure lead={lead} body={<p ref={fade} className="thought-body scroll-fade scroll-thin m-0 text-2 text-fg-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{block.text}</p>}>
      <span className={cn(block.streaming && 'shimmer')}>
        {block.streaming ? t('host.thinking') : t('thought.label')}
      </span>
      {sec !== undefined && <span className="text-fg-3 tabular-nums">{t('turns.elapsed.s', { s: sec })}</span>}
    </Disclosure>
  );
}

// While running, ticks one second at a time from startedAt; once done, uses the host-computed durationSec
function useThoughtSeconds(block: ThoughtBlock): number | undefined {
  const live = !!block.streaming && block.startedAt !== undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  if (live) return Math.max(1, Math.round((now - block.startedAt!) / 1000));
  return block.durationSec;
}
