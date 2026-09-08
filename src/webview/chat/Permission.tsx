import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { ChevronDown, Terminal } from 'lucide-react';
import type { PermissionBlock } from '@shared/transcript';
import { Button } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { Row } from '../ui/Row';
import { getLocale, t } from '../i18n';
import { permissionOption } from './permissionOptions';

// Keep common decisions visible; the menu preserves every remaining wire option.
export function Permission({ block, onChoose }: { block: PermissionBlock; onChoose?: (optionId: string) => void }) {
  const options = block.options.map(o => permissionOption(o, getLocale()));
  const allow = options.find(o => o.quick && o.kind === 'allow_once');
  const reject = options.find(o => o.quick && o.kind === 'reject_once');
  const more = options.filter(o => o !== allow && o !== reject);
  return (
    <div className="flex min-w-0 flex-col gap-gap rounded-lg border border-conversation-line bg-bg-1 p-pad">
      <Row dense lead={block.command ? <Terminal className="size-icon" strokeWidth={1.5} /> : undefined}>
        <span className="font-medium">{block.command ? t('permission.run') : block.title}</span>
      </Row>
      {block.command && <pre className="m-0 whitespace-pre-wrap font-mono text-mono text-fg-1 [overflow-wrap:anywhere]">{block.command}</pre>}
      {block.description && <p className="m-0 text-3 text-fg-2 [overflow-wrap:anywhere]">{block.description}</p>}
      <div className="flex flex-wrap items-center justify-between gap-gap">
        {more.length > 0 && (
          <Popover width="md" side="top" flip role="menu" content={close => (
            <PermissionMenu options={more} onChoose={id => { close(); onChoose?.(id); }} />
          )}>
            {({ ref, open, toggle }) => (
              <Button ref={ref} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
                {t('permission.more')}<ChevronDown className="size-icon shrink-0" strokeWidth={1.5} />
              </Button>
            )}
          </Popover>
        )}
        <div className="ml-auto flex items-center gap-gap">
          {reject && <Button onClick={() => onChoose?.(reject.id)}>{reject.label}</Button>}
          {allow && <Button variant="primary" onClick={() => onChoose?.(allow.id)}>{allow.label}</Button>}
        </div>
      </div>
    </div>
  );
}

type DisplayOption = ReturnType<typeof permissionOption>;

function PermissionMenu({ options, onChoose }: { options: DisplayOption[]; onChoose: (id: string) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const commonDetail = options.find(o => o.detail)?.detail;
  const sharedDetail = commonDetail && options.filter(o => !o.bypass).every(o => o.detail === commonDetail) ? commonDetail : undefined;
  const ordered = [...options.filter(o => !o.bypass), ...options.filter(o => o.bypass)];
  useLayoutEffect(() => {
    // The popover is initially hidden while its layout effect positions it.
    const frame = requestAnimationFrame(() => root.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div ref={root} onKeyDown={onKeyDown} className="scroll-thin max-h-pop overflow-y-auto">
      {ordered.map((option, index) => (
        <div key={option.id} className={option.bypass && index > 0 && !ordered[index - 1]?.bypass ? 'border-t border-line' : undefined}>
          {/* Menu rows stay inside the panel; conversation rows extend their hit area. */}
          <Row as="button" role="menuitem" onClick={() => onChoose(option.id)} className="w-full cursor-pointer rounded-md px-gap outline-none transition-colors hover:bg-hover focus-visible:bg-hover">
            <span className="min-w-0 whitespace-normal text-fg-1 [overflow-wrap:anywhere]">
              <span className="block">{option.label}</span>
              {!sharedDetail && option.detail && <span className="block text-3 text-fg-3">{option.detail}</span>}
            </span>
          </Row>
        </div>
      ))}
    </div>
  );
}
