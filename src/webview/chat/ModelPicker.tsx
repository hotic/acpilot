import { useMemo } from 'react';
import type { ConfigControl } from '@shared/transcript';
import { findVariant, groupModels, modelBrand, variantLabel, visibleOptions, type ModelFamily, type ModelVariant } from '@shared/models';
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

// A single configOption, minus the families hidden in the settings: names that decompose into a "family × params" structure (Devin's 210 models)
// get the model panel, otherwise one flat menu
export function OptionControl({ control, hidden, ...rest }: OptionMenuProps & { hidden?: string[] }) {
  const shown = useMemo(() => ({ ...control, options: visibleOptions(control.options, hidden, control.value) }), [control, hidden]);
  const families = useMemo(() => groupModels(shown.options), [shown.options]);
  return families.length < shown.options.length || families.some(f => f.source) ? <ModelControl {...rest} control={shown} families={families} /> : <OptionMenu {...rest} control={shown} />;
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

// One chip for the whole model choice, "family + params" with the params faint (as in Cursor's toolbar and Devin's own composer). It opens one panel:
// the searchable family list with the current family's params as a small form underneath — Devin's detail pane, laid out vertically because
// a 380 sidebar has no room beside the list. Picking a family closes the panel; changing params keeps it open.
// Switching families tries to keep the current params; if there's no matching tier it falls back to the family's first tier
function ModelControl({ control: c, families, onSelect, onOpenChange }: OptionMenuProps & { families: ModelFamily[] }) {
  const cur = families.find(f => f.variants.some(v => v.id === c.value));
  const curVar = cur?.variants.find(v => v.id === c.value);
  // Params are worth showing when the family offers a choice, or its only variant carries a flag (a lone "Composer 2.5 Fast")
  const params = cur && curVar && (cur.efforts.length > 1 || curVar.effort || curVar.fast || curVar.long) ? variantLabel(curVar, cur, { standard: t('composer.standard') }) : undefined;
  const meta = [cur?.source, params].filter(Boolean).join(' · ') || undefined;
  return (
    <Popover
      side="top" align="end" width="md" role="menu" onOpenChange={onOpenChange}
      content={close => <ModelPanel families={families} cur={cur} curVar={curVar} onSelect={onSelect} close={close} />}
    >
      {({ open, toggle, ref }) => (
        <Chip ref={ref} data-open={open || undefined} onClick={toggle} narrow="text" title={c.name} meta={meta} icon={<ModelMark family={cur?.name ?? c.name} />}>
          {cur?.name ?? c.options.find(o => o.id === c.value)?.name ?? c.name}
        </Chip>
      )}
    </Popover>
  );
}

interface ModelPanelProps {
  families: ModelFamily[];
  cur?: ModelFamily;
  curVar?: ModelVariant;
  onSelect: (value: string) => void;
  close: () => void;
}

function ModelPanel({ families, cur, curVar, onSelect, close }: ModelPanelProps) {
  const items = families.map((f): MenuItem => ({ id: f.key, label: f.name, description: f.source, icon: <ModelMark family={f.name} />, checked: f === cur }));
  const pickFamily = (key: string) => {
    const f = families.find(x => x.key === key);
    if (f) onSelect(((curVar && findVariant(f, curVar.effort, curVar.fast, curVar.long)) ?? f.variants[0]!).id);
    close();
  };
  return (
    <MenuList
      items={items}
      searchable={families.length >= SEARCH_FROM}
      onSelect={pickFamily}
      footer={cur && curVar && cur.variants.length > 1 ? <ModelParams family={cur} variant={curVar} onSelect={onSelect} /> : undefined}
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
    <div className="mt-1 flex flex-col border-t border-line pt-1">
      {f.efforts.length > 1 && !thinkingSwitch && (
        <div className={cn('flex min-h-row gap-2 px-2 py-1', f.efforts.length > 3 ? 'flex-col' : 'flex-wrap items-center')}>
          <span className="shrink-0 text-2 text-fg-2">{t('composer.effort')}</span>
          <RadioPills label={t('composer.effort')} options={f.efforts.map(e => ({ value: e, label: e || t('composer.standard') }))} value={v.effort} onChange={pickEffort} />
        </div>
      )}
      {thinkingSwitch && (
        <SwitchRow label="Thinking" checked={v.effort === 'Thinking'} disabled={!findVariant(f, v.effort === 'Thinking' ? '' : 'Thinking', v.fast, v.long)} onChange={on => pickEffort(on ? 'Thinking' : '')} />
      )}
      {f.hasFast && <SwitchRow label="Fast" checked={v.fast} disabled={!at(v.effort, !v.fast, v.long)} onChange={() => flip('fast')} />}
      {f.hasLong && <SwitchRow label="1M" checked={v.long} disabled={!at(v.effort, v.fast, !v.long)} onChange={() => flip('long')} />}
    </div>
  );
}

// Flat configOption menu; long lists are searchable. Vendor marks only appear when at least one option names a known brand
// (Grok's monolithic model list) — a thought_level menu of "Low / High" stays text-only instead of earning letter tiles
function OptionMenu({ control: c, end, onSelect, onOpenChange }: OptionMenuProps) {
  const branded = c.options.some(o => modelBrand(o.name));
  const items = c.options.map((o): MenuItem => ({ id: o.id, label: o.name, description: o.description, icon: branded ? <ModelMark family={o.name} /> : undefined, checked: o.id === c.value }));
  const curName = c.options.find(o => o.id === c.value)?.name;
  const curIcon = branded && curName && modelBrand(curName) ? <ModelMark family={curName} /> : undefined;
  return (
    <Menu side="top" align={end ? 'end' : undefined} width="md" items={items} searchable={c.options.length >= SEARCH_FROM} onSelect={onSelect} onOpenChange={onOpenChange}>
      {({ open, toggle, ref }) => <Chip ref={ref} data-open={open || undefined} onClick={toggle} narrow="text" title={c.name} icon={curIcon}>{curName ?? c.name}</Chip>}
    </Menu>
  );
}
