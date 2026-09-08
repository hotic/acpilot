import { useEffect, useMemo, type ReactNode } from 'react';
import { FileText, Globe, KeyRound, Plus, Server, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { AccountInfo, AgentInfo, ConfigControl } from '@shared/transcript';
import type { AgentInventory, InventoryFile, InventoryMcp, InventorySkill, McpTransport } from '@shared/inventory';
import type { SettingsView } from '@shared/settings';
import { familyLabel } from '@shared/composerControls';
import { familyHidden, groupModels, setFamilyVisible, variantLabel, type ModelFamily } from '@shared/models';
import { IconButton } from '../ui/Button';
import { QuotaBars } from '../ui/QuotaBars';
import { t } from '../i18n';
import { ModelMark } from '../chat/ModelMark';
import { Dot, FactRow, Group, ItemRow, Note, PathText, Section, SectionAction, SectionDescription, SectionHead, SourceLink, Switch, shortPath } from './controls';
import type { SettingsEnv, SettingsHandlers } from './SettingsShell';

type AgentSection = 'models' | 'mcp' | 'skills' | 'rules' | 'config';
const SECTIONS: AgentSection[] = ['models', 'mcp', 'skills', 'rules', 'config'];

export interface AgentPageProps {
  agent: AgentInfo;
  // Accounts of this agent only
  accounts: AccountInfo[];
  inventory?: AgentInventory;
  // The select-type configOptions this agent offered in its latest session; undefined until one has been opened
  controls?: ConfigControl[];
  settings: SettingsView;
  env: SettingsEnv;
  on: SettingsHandlers;
}

// One agent: a card of facts (the page heading carries the name), accounts when it has an account layer, then five stacked sections: the option families
// shown in the composer menus, and the extension inventory. Everything read from the CLI's own files is read-only here — rows open the file,
// ACPilot never writes it. Only the option families have switches
export function AgentPage({ agent, accounts, inventory, controls, settings, env, on }: AgentPageProps) {
  useEffect(() => { if (!inventory) on.refreshInventory(agent.id); }, [agent.id, inventory, on]);
  // Quotas on the account rows are re-read each time the page is opened (recent ones come back from the host's memory)
  useEffect(() => { if (agent.accounts) on.refreshQuota?.(agent.id); }, [agent.id, agent.accounts, on]);

  const counts: Record<AgentSection, number> = {
    models: controls?.reduce((n, c) => n + groupModels(c.options).length, 0) ?? 0,
    mcp: inventory?.mcp.length ?? 0,
    skills: inventory?.skills.length ?? 0,
    rules: inventory?.rules.filter(r => r.exists).length ?? 0,
    config: inventory?.config.filter(c => c.exists).length ?? 0,
  };
  const sections: Record<AgentSection, ReactNode> = {
    models: <ModelsSection agent={agent} controls={controls} settings={settings} on={on} />,
    mcp: <McpSection agent={agent} inventory={inventory} env={env} on={on} />,
    skills: <SkillsSection agent={agent} inventory={inventory} env={env} on={on} />,
    rules: <FilesSection kind="rules" agent={agent} files={inventory?.rules} env={env} on={on} />,
    config: <FilesSection kind="config" agent={agent} files={inventory?.config} env={env} on={on} />,
  };

  return (
    <>
      <AgentFacts agent={agent} inventory={inventory} env={env} />

      {agent.accounts && (
        <div className="flex flex-col gap-2">
          <SectionHead action={<SectionAction icon={<Plus strokeWidth={1.75} />} onClick={() => on.addAccount(agent.id)}>{t('settings.agent.addAccount')}</SectionAction>}>
            {t('settings.agent.accounts')}
          </SectionHead>
          <Section desc={t('settings.agent.accounts.desc')}>
            {accounts.length === 0 && <Note>{t('settings.agent.accounts.none')}</Note>}
            {accounts.map(a => (
              <ItemRow
                key={a.id}
                lead={<KeyRound strokeWidth={1.5} />}
                title={a.label}
                desc={a.detail}
                extra={a.quota && <QuotaBars quota={a.quota} className="max-w-(--setting-header-copy)" />}
                trailing={
                  <IconButton title={t('common.remove')} aria-label={t('common.removeNamed', { name: a.label })} onClick={() => on.removeAccount(a.id)} className="-mr-1.5 text-fg-2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100">
                    <X strokeWidth={1.5} />
                  </IconButton>
                }
              />
            ))}
          </Section>
        </div>
      )}

      {SECTIONS.map(id => (
        <div key={id} className="flex flex-col gap-2">
          <SectionHead count={inventory ? counts[id] : undefined}>{t(`settings.tab.${id}` as const)}</SectionHead>
          <div className="flex flex-col gap-pad">{sections[id]}</div>
        </div>
      ))}
    </>
  );
}

// Facts card: executable (with install state) and version. Only the path may truncate; the words around it keep their width
function AgentFacts({ agent, inventory, env }: { agent: AgentInfo; inventory?: AgentInventory; env: SettingsEnv }) {
  const version = inventory?.runtime?.version ? t('settings.agent.version', { name: inventory.runtime.name ?? agent.name, version: inventory.runtime.version }) : undefined;
  return (
    <Group>
      <FactRow label={t('settings.fact.binary')}>
        {inventory === undefined
          ? <span className="shimmer font-sans text-2">{t('settings.agent.probing')}</span>
          : inventory.binary
            ? <><Dot ok /><PathText path={inventory.binary} env={env} className="text-fg-1" /></>
            : <><Dot ok={false} /><span className="truncate font-sans text-2 text-fg-2">{t('settings.agent.notInstalled', { command: agent.id })}</span></>}
      </FactRow>
      <FactRow label={t('settings.fact.version')}>{version ?? <span className="text-fg-2">{t('settings.fact.noLive')}</span>}</FactRow>
    </Group>
  );
}

// Option families of each configOption (model / reasoning level …) with a show / hide switch each; hidden families leave the composer menus.
// The lists only ever come over ACP, so before the first session there is nothing to show. The family in use can be switched off too —
// the composer keeps the current value reachable on its own (visibleOptions)
function ModelsSection({ agent, controls, settings, on }: { agent: AgentInfo; controls?: ConfigControl[]; settings: SettingsView; on: SettingsHandlers }) {
  const hidden = settings.hiddenOptions[agent.id] ?? {};
  const toggle = (c: ConfigControl, f: ModelFamily, show: boolean) => {
    const cur = hidden[c.id] ?? [];
    const next = setFamilyVisible(c.options, cur, f.key, show);
    const forAgent = { ...hidden, [c.id]: next };
    if (!next.length) delete forAgent[c.id];
    const all = { ...settings.hiddenOptions, [agent.id]: forAgent };
    if (!Object.keys(forAgent).length) delete all[agent.id];
    on.setSetting('hiddenOptions', all);
  };
  // Second line: what the family spans — its effort levels, Fast / 1M — so the row says which switch is being flipped
  const summary = (f: ModelFamily) => {
    if (f.variants.length === 1) return f.variants[0]!.name === f.name ? undefined : variantLabel(f.variants[0]!, f, { standard: t('composer.standard') });
    const parts = [f.efforts.filter(Boolean).join(' / '), f.hasFast && 'Fast', f.hasLong && '1M'].filter(Boolean);
    return parts.join(' · ');
  };
  if (!controls?.length) return <Section desc={t('settings.models.desc', { agent: agent.name })}><Note>{t('settings.models.none', { agent: agent.name })}</Note></Section>;
  return (
    <>
      <SectionDescription>{t('settings.models.desc', { agent: agent.name })}</SectionDescription>
      {controls.map(c => {
        const families = groupModels(c.options);
        const off = hidden[c.id] ?? [];
        // With a single configOption the section heading names it; several get one labelled group each
        const several = controls.length > 1;
        // Translate standard categories; preserve names supplied by custom controls.
        const title = c.category === 'model' ? t('settings.models.selection')
          : c.category === 'thought_level' ? t('settings.models.thinking') : c.name;
        // Agent adapters classify model sources; unclassified ACP options retain their own group.
        const groups = c.category === 'model' && families.some(f => f.sourceKind)
          ? [
              { key: 'official', title: t('settings.models.official'), families: families.filter(f => f.sourceKind === 'official') },
              { key: 'custom', title: t('settings.models.custom'), families: families.filter(f => f.sourceKind === 'custom') },
              { key: 'other', title, families: families.filter(f => !f.sourceKind) },
            ].filter(g => g.families.length)
          : [{ key: c.id, title: several ? title : undefined, families }];
        return groups.map(g => (
          <Section key={`${c.id}:${g.key}`} title={g.title} count={g.title ? g.families.filter(f => !familyHidden(f, off)).length : undefined}>
            {g.families.map(f => {
              const shown = !familyHidden(f, off);
              const name = familyLabel(c, f);
              return (
                <ItemRow
                  key={f.key}
                  lead={<ModelMark family={name} />}
                  title={name}
                  desc={[f.source, summary(f)].filter(Boolean).join(' · ') || undefined}
                  dim={!shown}
                  trailing={<Switch checked={shown} onChange={v => toggle(c, f, v)} label={`${name} · ${f.source ?? c.name}`} />}
                />
              );
            })}
          </Section>
        ));
      })}
    </>
  );
}

const TRANSPORT_ICON: Record<McpTransport, ReactNode> = {
  stdio: <Server strokeWidth={1.5} />,
  http: <Globe strokeWidth={1.5} />,
  sse: <Globe strokeWidth={1.5} />,
};

const dirName = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

// Rows grouped by the file / directory they came from: one card per source, its path as the head row
function Grouped<T>({ items, sourceOf, row, env, on, empty, loading }: { items: T[] | undefined; sourceOf: (x: T) => string; row: (x: T) => ReactNode; env: SettingsEnv; on: SettingsHandlers; empty: string; loading: boolean }) {
  const bySource = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const x of items ?? []) (m.get(sourceOf(x)) ?? m.set(sourceOf(x), []).get(sourceOf(x))!).push(x);
    return [...m.entries()];
  }, [items, sourceOf]);
  if (loading) return <Note shimmer>{t('settings.loading')}</Note>;
  if (bySource.length === 0) return <Note>{empty}</Note>;
  return <>{bySource.map(([source, list]) => <Group key={source}>{list.map(row)}<SourceLink path={source} env={env} onOpen={on.openPath} /></Group>)}</>;
}

// Does the list come as several cards (so the Section must not wrap them in one)?
const asCards = (n: number | undefined) => (n ?? 0) > 0;

// The MCP servers the CLI reads from its own files (read-only). Injecting servers over ACP is not offered yet: the wire supports it, the UI does not
function McpSection({ agent, inventory, env, on }: { agent: AgentInfo; inventory?: AgentInventory; env: SettingsEnv; on: SettingsHandlers }) {
  const row = (m: InventoryMcp) => (
    <ItemRow
      key={`${m.source}:${m.name}`}
      lead={TRANSPORT_ICON[m.transport]}
      title={m.name}
      desc={`${m.enabled ? '' : `${t('settings.mcp.disabled')} · `}${m.transport} · ${m.target}`}
      dim={!m.enabled}
    />
  );
  return (
    <Section desc={t('settings.mcp.native.desc', { agent: agent.name })} cards={asCards(inventory?.mcp.length)}>
      <Grouped items={inventory?.mcp} sourceOf={m => m.source} row={row} env={env} on={on} empty={t('settings.mcp.none')} loading={!inventory} />
    </Section>
  );
}

// Skills grouped by the directory they were found in (…/skills/<name>/SKILL.md → …/skills)
const skillsRoot = (s: InventorySkill) => dirName(dirName(s.path));

function SkillsSection({ agent, inventory, env, on }: { agent: AgentInfo; inventory?: AgentInventory; env: SettingsEnv; on: SettingsHandlers }) {
  const row = (s: InventorySkill) => (
    <ItemRow key={s.path} lead={<Sparkles strokeWidth={1.5} />} title={s.name} desc={s.description ?? shortPath(s.path, env)} onOpen={() => on.openPath(s.path)} />
  );
  return (
    <Section desc={t('settings.skills.desc', { agent: agent.name })} cards={asCards(inventory?.skills.length)}>
      <Grouped items={inventory?.skills} sourceOf={skillsRoot} row={row} env={env} on={on} empty={t('settings.skills.none')} loading={!inventory} />
    </Section>
  );
}

// Rules and config share one shape: files that may or may not exist; existing ones first, missing ones dimmed so the candidate locations stay visible
function FilesSection({ kind, agent, files, env, on }: { kind: 'rules' | 'config'; agent: AgentInfo; files?: InventoryFile[]; env: SettingsEnv; on: SettingsHandlers }) {
  const sorted = useMemo(() => [...(files ?? [])].sort((a, b) => Number(b.exists) - Number(a.exists)), [files]);
  const Icon = kind === 'rules' ? FileText : SlidersHorizontal;
  return (
    <Section desc={kind === 'rules' ? t('settings.rules.desc') : t('settings.config.desc', { agent: agent.name })}>
      {!files && <Note shimmer>{t('settings.loading')}</Note>}
      {files && sorted.length === 0 && <Note>{t('settings.rules.none')}</Note>}
      {sorted.map(f => (
        <ItemRow
          key={f.path}
          lead={<Icon strokeWidth={1.5} />}
          title={shortPath(f.path, env)}
          dim={!f.exists}
          trailing={f.exists ? <span className="text-2 text-fg-2 tabular-nums">{fmtSize(f.size ?? 0)}</span> : <span className="text-2 text-fg-2">{t('settings.file.missing')}</span>}
          onOpen={f.exists ? () => on.openPath(f.path) : undefined}
        />
      ))}
    </Section>
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
