import { Brain } from 'lucide-react';
import type { ThoughtBlock } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { Disclosure } from '../ui/Disclosure';
import { cn } from '../ui/cn';
import { useScrollFade } from '../ui/useScrollFade';
import { StreamText } from './StreamText';

// ACP thought chunks have no end boundary: the next event can arrive only after
// tool arguments finish generating. Keep the text, but never time that gap as thinking.
// The turn heading owns the Orb; thought rows keep a static icon and shimmer only while streaming.
export function Thought({ block }: { block: ThoughtBlock }) {
  const { toolLine } = useAppearance();
  const fade = useScrollFade<HTMLParagraphElement>();
  const lead = toolLine === 'text' ? undefined : <Brain className="size-icon" strokeWidth={1.5} />;
  return (
    <Disclosure lead={lead} body={<p ref={fade} className="thought-body scroll-fade scroll-thin m-0 text-2 text-fg-2 whitespace-pre-wrap [overflow-wrap:anywhere]"><StreamText text={block.text} streaming={block.streaming} /></p>}>
      <span className={cn(block.streaming && 'shimmer')}>
        {block.streaming ? t('host.thinking') : t('thought.label')}
      </span>
    </Disclosure>
  );
}
