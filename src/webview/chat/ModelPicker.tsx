import { useMemo } from 'react';
import type { ConfigControl } from '@shared/transcript';
import { findVariant, groupModels, optionBrand, variantLabel, visibleOptions, type ModelFamily, type ModelVariant } from '@shared/models';
import { presentReasoning, reasoningChip, reasoningVisible } from '@shared/composerControls';
import { t } from '../i18n';
import { cn } from '../ui/cn';
import { Chip } from '../ui/Button';
import { RadioPills, SwitchRow } from '../ui/Field';
import { Popover } from '../ui/Popover';
import { Menu, MenuList, type MenuItem } from '../ui/Menu';
import { ModelMark } from './ModelMark';

// Only offer search once the option count passes this threshold; short lists are scannable at a glance
const SEARCH_FROM = 12;

interface OptionMenuProps {
  control: ConfigControl;
  onSelect: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  // Right-side controls (the model slot) align their panel to the chip's right edge so it doesn't overflow the composer
  end?: boolean;
}

// Non-model options stay flat; reasoning must never be parsed as model families.
export function OptionControl({ control, hidden, ...rest }: OptionMenuProps & { hidden?: string[] }) {
  const shown = useMemo(() => ({ ...control, options: visibleOptions(control.options, hidden, control.value) }), [control, hidden]);
  return <OptionMenu {...rest} control={shown} />;
}

// The same model identity / variant picker can live behind a different trigger,
// including a plan's Build menu. Selection is owned by the caller.
export function ModelOptions({ control, hidden, onSelect, close }: {
  control: ConfigControl;
  hidden?: string[];
  onSelect: (value: string) => void;
  close: () => void;
}) {
  const shown = useMemo(() => visibleOptions(control.options, hidden, control.value), [control, hidden]);
  const families = useMemo(() => groupModels(shown), [shown]);
  const cur = families.find(f => f.variants.some(v => v.id === control.value));
  const curVar = cur?.variants.find(v => v.id === control.value);
  return <ModelPanel families={families} cur={cur} curVar={curVar} onSelect={onSelect} close={close} />;
}

// Every ACP uses the Devin-style model chip and panel. Separate ACP reasoning
// options join the footer, while Devin's embedded variants retain their wire IDs.
export function ModelControl({ control, hidden, reasoning = [], onSetReasoning, onSelect, onOpenChange }: OptionMenuProps & {
  hidden?: string[];
  reasoning?: ConfigControl[];
  onSetReasoning: (id: string, value: string) => void;
}) {
  const c = useMemo(() => ({ ...control, options: visibleOptions(control.options, hidden, control.value) }), [control, hidden]);
  const families = useMemo(() => groupModels(c.options), [c.options]);
  const cur = families.find(f => f.variants.some(v => v.id === c.value));
  const curVar = cur?.variants.find(v => v.id === c.value);
  const params = cur && curVar && (cur.efforts.length > 1 || curVar.effort || curVar.fast || curVar.long) ? variantLabel(curVar, cur, { standard: t('composer.standard') }) : undefined;
  const levels = reasoning.map(reasoningChip);
  // Provider identity stays in the expanded list; the chip reads as one model name.
  const meta = [params, ...levels].filter(Boolean).join(' ') || undefined;
  return (
    <Popover
      side="top" align="end" width="md" role="menu" onOpenChange={onOpenChange}
      content={close => <ModelPanel families={families} cur={cur} curVar={curVar} onSelect={onSelect} close={close}
        reasoning={reasoning} onSetReasoning={onSetReasoning} />}
    >
      {({ open, toggle, ref }) => (
        <Chip ref={ref} data-open={open || undefined} onClick={toggle} narrow="text" title={[cur?.name ?? c.name, meta].filter(Boolean).join(' ')} meta={meta} icon={<ModelMark family={cur?.name ?? c.name} brand={cur?.brand} />}>
          {cur?.name ?? c.options.find(o => o.id === c.value)?.name ?? c.name}
        </Chip>
      )}
    </Popover>
  );
}

// Agents without a model selector still use the same reasoning field and labels.
export function ReasoningControl({ control: c, onSelect, onOpenChange }: OptionMenuProps) {
  if (!reasoningVisible(c)) return null;
  return <Popover side="top" align="end" width="md" onOpenChange={onOpenChange}
    content={() => <ReasoningParams control={c} onChange={onSelect} />}>
    {({ open, toggle, ref }) => <Chip ref={ref} narrow="text" data-open={open || undefined} onClick={toggle} title={t('composer.effort')}>
      {reasoningChip(c) ?? t('composer.effort')}
    </Chip>}
  </Popover>;
}

interface ModelPanelProps {
  families: ModelFamily[];
  cur?: ModelFamily;
  curVar?: ModelVariant;
  onSelect: (value: string) => void;
  close: () => void;
  reasoning?: ConfigControl[];
  onSetReasoning?: (id: string, value: string) => void;
}

function ModelPanel({ families, cur, curVar, onSelect, close, reasoning = [], onSetReasoning }: ModelPanelProps) {
  const items = families.map((f): MenuItem => ({ id: f.key, label: f.name, description: f.source, icon: <ModelMark family={f.name} brand={f.brand} />, checked: f === cur }));
  const pickFamily = (key: string) => {
    const f = families.find(x => x.key === key);
    if (f) onSelect(((curVar && findVariant(f, curVar.effort, curVar.fast, curVar.long)) ?? f.variants[0]!).id);
    close();
  };
  const shown = reasoning.filter(reasoningVisible);
  const showParams = !!(cur && curVar && cur.variants.length > 1);
  return (
    <MenuList
      items={items}
      searchable={families.length >= SEARCH_FROM}
      onSelect={pickFamily}
      footer={showParams || shown.length ? (
        <div className="mt-1 flex flex-col border-t border-line pt-1">
          {showParams && <ModelParams family={cur!} variant={curVar!} onSelect={onSelect} />}
          {shown.map(c => <ReasoningParams key={c.id} control={c} onChange={value => onSetReasoning?.(c.id, value)} />)}
        </div>
      ) : undefined}
    />
  );
}

// Params of the current family as a small form under the list: reasoning levels as radio pills (every level visible, one click), Fast / 1M as switches.
// A family whose only levels are Standard / Thinking gets a Thinking switch instead of two pills (what Cursor does). Every change applies immediately;
// a flag whose combination the agent doesn't offer is disabled rather than hidden, so the shape of the form doesn't jump between variants
function ModelParams({ family: f, variant: v, onSelect }: { family: ModelFamily; variant: ModelVariant; onSelect: (id: string) => void }) {
  const at = (effort: string, fast: boolean, long: boolean) => f.variants.find(x => x.effort === effort && x.fast === fast && x.long === long);
  const thinkingSwitch = f.efforts.length === 2 && f.efforts.includes('') && f.efforts.includes('Thinking');
  // Level changes keep Fast / 1M when that tier has them, otherwise drop them (findVariant's fallback order)
  const pickEffort = (e: string) => { const hit = findVariant(f, e, v.fast, v.long); if (hit) onSelect(hit.id); };
  const flip = (key: 'fast' | 'long') => { const hit = at(v.effort, key === 'fast' ? !v.fast : v.fast, key === 'long' ? !v.long : v.long); if (hit) onSelect(hit.id); };
  return (
    <div className="flex flex-col">
      {f.efforts.length > 1 && !thinkingSwitch && (
        <EffortField options={f.efforts.map(e => ({ value: e, label: e || t('composer.standard') }))} value={v.effort} onChange={pickEffort} />
      )}
      {thinkingSwitch && (
        <SwitchRow label="Thinking" checked={v.effort === 'Thinking'} disabled={!findVariant(f, v.effort === 'Thinking' ? '' : 'Thinking', v.fast, v.long)} onChange={on => pickEffort(on ? 'Thinking' : '')} />
      )}
      {f.hasFast && <SwitchRow label="Fast" checked={v.fast} disabled={!at(v.effort, !v.fast, v.long)} onChange={() => flip('fast')} />}
      {f.hasLong && <SwitchRow label="1M" checked={v.long} disabled={!at(v.effort, v.fast, !v.long)} onChange={() => flip('long')} />}
    </div>
  );
}

// Native thought_level: effort pills, plus a Thinking switch when the agent can turn it off.
function ReasoningParams({ control, onChange }: { control: ConfigControl; onChange: (value: string) => void }) {
  const p = presentReasoning(control);
  const turnOn = p.efforts.find(o => o.id === 'high')?.id ?? p.efforts[0]?.id ?? p.onId;
  return (
    <div className="flex flex-col">
      {p.offId && <SwitchRow label="Thinking" checked={!p.off} onChange={on => { if (on) { if (turnOn) onChange(turnOn); } else onChange(p.offId!); }} />}
      {p.efforts.length > 1 && (
        <EffortField options={p.efforts.map(o => ({ value: o.id, label: o.name }))} value={p.off ? '' : (p.value ?? '')} onChange={onChange} />
      )}
    </div>
  );
}

// Shared segmented field for both embedded variants and native thought_level.
function EffortField({ options, value, onChange, label = t('composer.effort') }: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return <div className={cn('flex min-h-row gap-2 px-2 py-1', options.length > 3 ? 'flex-col' : 'flex-wrap items-center')}>
    <span className="shrink-0 text-2 text-fg-2">{label}</span>
    <RadioPills label={label} options={options} value={value} onChange={onChange} />
  </div>;
}

// Flat configOption menu; long lists are searchable. Vendor marks only appear when at least one option has a known brand
// (Grok's monolithic model list) — a thought_level menu of "Low / High" stays text-only instead of earning letter tiles
function OptionMenu({ control: c, end, onSelect, onOpenChange }: OptionMenuProps) {
  const branded = c.options.some(o => optionBrand(o));
  const items = c.options.map((o): MenuItem => ({ id: o.id, label: o.name, description: o.description, icon: branded ? <ModelMark family={o.name} brand={optionBrand(o)} /> : undefined, checked: o.id === c.value }));
  const cur = c.options.find(o => o.id === c.value);
  const curIcon = branded && cur && optionBrand(cur) ? <ModelMark family={cur.name} brand={optionBrand(cur)} /> : undefined;
  return (
    <Menu side="top" align={end ? 'end' : undefined} width="md" items={items} searchable={c.options.length >= SEARCH_FROM} onSelect={onSelect} onOpenChange={onOpenChange}>
      {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} onClick={toggle} narrow="text" title={c.name} icon={curIcon}>{cur?.name ?? c.name}</Chip>}
    </Menu>
  );
}
