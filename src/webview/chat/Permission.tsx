import type { PermissionBlock } from '@shared/transcript';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';

// Permission card: the only bordered thing in the whole conversation. Title / command / three right-aligned buttons
export function Permission({ block, onChoose }: { block: PermissionBlock; onChoose?: (optionId: string) => void }) {
  return (
    <Card className="flex flex-col gap-gap p-pad">
      <div className="text-2 font-semibold text-fg-strong">{block.title}</div>
      {block.command && <pre className="m-0 whitespace-pre-wrap font-mono text-mono text-fg-2">{block.command}</pre>}
      {block.description && <p className="m-0 text-3 text-fg-3">{block.description}</p>}
      <div className="mt-0.5 flex justify-end gap-2">
        {block.options.map(o => (
          <Button
            key={o.id}
            variant={o.kind === 'allow_once' ? 'primary' : o.kind.startsWith('reject') ? 'ghost' : 'secondary'}
            kbd={o.kind === 'allow_once' ? '⏎' : undefined}
            onClick={() => onChoose?.(o.id)}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </Card>
  );
}
