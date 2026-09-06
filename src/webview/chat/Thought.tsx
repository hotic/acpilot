import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import type { ThoughtBlock } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { Disclosure } from '../ui/Disclosure';
import { Orb } from '../effects/Orb';
import { cn } from '../ui/cn';

// Thought: one row, "Thinking" plus the seconds one shade fainter; while running the seconds tick live, frozen once done. Expanding shows grey body text.
// The Orb appears only here (while streaming); the lead slot takes space only when tool rows also have one, keeping every row in the same message left-aligned
export function Thought({ block }: { block: ThoughtBlock }) {
  const { thought, toolLine } = useAppearance();
  const sec = useThoughtSeconds(block);
  const lead = thought === 'orb' && (block.streaming || toolLine !== 'text')
    ? <ThoughtLead streaming={!!block.streaming} />
    : toolLine === 'text' ? undefined : <Brain className="size-icon" strokeWidth={1.5} />;
  return (
    <Disclosure lead={lead} body={<p className="m-0 text-2 text-fg-2 whitespace-pre-wrap [overflow-wrap:anywhere]">{block.text}</p>}>
      <span className={cn(block.streaming && thought === 'shimmer' && 'shimmer')}>Thinking</span>
      {sec !== undefined && <span className="text-fg-3 tabular-nums">{sec}s</span>}
    </Disclosure>
  );
}

// Lead slot in orb mode: the Orb while streaming; when the thought ends the Orb shrinks out and the static icon grows in.
// The outgoing Orb stays mounted until its exit animation ends (or immediately when motion is off, since animations are disabled there)
function ThoughtLead({ streaming }: { streaming: boolean }) {
  const { motion } = useAppearance();
  const [orb, setOrb] = useState(streaming);
  const [swapped, setSwapped] = useState(false);
  useEffect(() => {
    if (streaming) setOrb(true);
    else if (orb) { setSwapped(true); if (motion === 'none') setOrb(false); }
  }, [streaming, orb, motion]);
  if (orb) {
    return (
      <span className={cn('flex', !streaming && 'swap-out')} onAnimationEnd={() => setOrb(false)}>
        <Orb kind="think" paused={!streaming} />
      </span>
    );
  }
  return <Brain className={cn('size-icon', swapped && 'swap-in')} strokeWidth={1.5} />;
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
