import type { PermissionBlock } from '@shared/transcript';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

// Permission card: the only bordered thing in the whole conversation. Title / command / right-aligned buttons; allow-once is the primary, the rest secondary.
// Agents word their options at length (Devin: "Yes, always allow `env` commands in all projects" × 4), so the row wraps and each button can
// truncate to the card's width instead of running out of it; the full label stays in the tooltip
export function Permission({ block, onChoose }: { block: PermissionBlock; onChoose?: (optionId: string) => void }) {
  return (
    <Card className="flex flex-col gap-gap overflow-hidden p-pad">
      <div className="text-2 font-semibold text-fg-strong">{block.title}</div>
      {block.command && <pre className="m-0 whitespace-pre-wrap font-mono text-mono text-fg-2 [overflow-wrap:anywhere]">{block.command}</pre>}
      {block.description && <p className="m-0 text-3 text-fg-3">{block.description}</p>}
      <div className="mt-0.5 flex flex-wrap justify-end gap-2">
        {block.options.map(o => (
          <Button
            key={o.id}
            variant={o.kind === 'allow_once' ? 'primary' : 'secondary'}
            kbd={o.kind === 'allow_once' ? '⏎' : undefined}
            title={o.label}
            className="min-w-0 max-w-full"
            onClick={() => onChoose?.(o.id)}
          >
            <span className="min-w-0 truncate">{o.label}</span>
          </Button>
        ))}
      </div>
    </Card>
  );
}
