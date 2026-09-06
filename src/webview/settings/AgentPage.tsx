import { useEffect, useMemo, type ReactNode } from 'react';
import { Braces, FileText, Globe, KeyRound, Plus, Server, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { AccountInfo, AgentInfo, ConfigControl } from '@shared/transcript';
import type { AgentInventory, InventoryFile, InventoryMcp, InventorySkill } from '@shared/inventory';
import { mcpAppliesTo, mcpTransport, type McpServerSetting, type McpTransport, type SettingsView } from '@shared/settings';
import { groupModels, variantLabel, type ModelFamily } from '@shared/models';
import { IconButton } from '../ui/Button';
import { t } from '../i18n';
import { ModelMark } from '../chat/ModelMark';
import { Dot, FactRow, Group, ItemRow, Note, Page, PathText, Section, SectionAction, SectionHead, SourceHead, Switch, shortPath } from './controls';
import type { SettingsEnv, SettingsHandlers } from './SettingsShell';

type AgentSection = 'models' | 'mcp' | 'skills' | 'rules' | 'config';
const SECTIONS: AgentSection[] = ['models', 'mcp', 'skills', 'rules', 'config'];

export interface AgentPageProps {
  agent: AgentInfo;
  agents: AgentInfo[];
  // Accounts of this agent only
  accounts: AccountInfo[];
  inventory?: AgentInventory;
  // The select-type configOptions this agent offered in its latest session; undefined until one has been opened
  controls?: ConfigControl[];
  settings: SettingsView;
  env: SettingsEnv;
  on: SettingsHandlers;
}

// One agent: a card of facts (the top bar carries the name), accounts when it has an account layer, then five stacked sections: the option families
// shown in the composer menus, and the extension inventory. Everything read from the CLI's own files is read-only here — rows open the file,
// ACPilot never writes it. Only the ACPilot-injected MCP list and the option families have switches
export function AgentPage({ agent, agents, accounts, inventory, controls, settings, env, on }: AgentPageProps) {
  useEffect(() => { if (!inventory) on.refreshInventory(agent.id); }, [agent.id, inventory, on]);

  const injected = useMemo(() => Object.entries(settings.mcpServers).filter(([, s]) => s.enabled !== false), [settings.mcpServers]);
  const counts: Record<AgentSection, number> = {
    models: controls?.reduce((n, c) => n + groupModels(c.options).length, 0) ?? 0,
    mcp: injected.filter(([, s]) => mcpAppliesTo(s, agent.id)).length + (inventory?.mcp.length ?? 0),
    skills: inventory?.skills.length ?? 0,
    rules: inventory?.rules.filter(r => r.exists).length ?? 0,
    config: inventory?.config.filter(c => c.exists).length ?? 0,
  };
  const sections: Record<AgentSection, ReactNode> = {
    models: <ModelsSection agent={agent} controls={controls} settings={settings} on={on} />,
    mcp: <McpSection agent={agent} agents={agents} inventory={inventory} settings={settings} env={env} on={on} />,
    skills: <SkillsSection agent={agent} inventory={inventory} env={env} on={on} />,
    rules: <FilesSection kind="rules" agent={agent} files={inventory?.rules} env={env} on={on} />,
    config: <FilesSection kind="config" agent={agent} files={inventory?.config} env={env} on={on} />,
  };

  return (
    <Page>
      <AgentFacts agent={agent} inventory={inventory} env={env} />

      {agent.accounts && (
        <Section
          title={t('settings.agent.accounts')}
          desc={t('settings.agent.accounts.desc')}
          action={<SectionAction icon={<Plus strokeWidth={1.75} />} onClick={() => on.addAccount(agent.id)}>{t('settings.agent.addAccount')}</SectionAction>}
        >
          {accounts.length === 0 && <Note>{t('settings.agent.accounts.none')}</Note>}
          {accounts.map(a => (
            <ItemRow
              key={a.id}
              lead={<KeyRound strokeWidth={1.5} />}
              title={a.label}
              desc={a.detail}
              trailing={
                <IconButton title={t('common.remove')} aria-label={t('common.removeNamed', { name: a.label })} onClick={() => on.removeAccount(a.id)} className="-mr-1.5 text-fg-3 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100">
                  <X strokeWidth={1.5} />
                </IconButton>
              }
            />
          ))}
        </Section>
      )}

      {SECTIONS.map(id => (
        <div key={id} className="flex flex-col gap-2">
          <SectionHead count={inventory ? counts[id] : undefined}>{t(`settings.tab.${id}` as const)}</SectionHead>
          {sections[id]}
        </div>
      ))}
    </Page>
  );
}

// Facts card: executable (with install state), version, follow-up capability. Only the path may truncate; the words around it keep their width
function AgentFacts({ agent, inventory, env }: { agent: AgentInfo; inventory?: AgentInventory; env: SettingsEnv }) {
  const version = inventory?.runtime?.version ? t('settings.agent.version', { name: inventory.runtime.name ?? agent.name, version: inventory.runtime.version }) : undefined;
  const steer = inventory ? (inventory.steer ? t('settings.agent.steer') : t('settings.agent.noSteer')) : undefined;
  return (
    <Group>
      <FactRow label={t('settings.fact.binary')} mono>
        {inventory === undefined
          ? <span className="shimmer font-sans text-2">{t('settings.agent.probing')}</span>
          : inventory.binary
            ? <><Dot ok /><PathText path={inventory.binary} env={env} className="text-fg-1" /></>
            : <><Dot ok={false} /><span className="truncate font-sans text-2 text-fg-3">{t('settings.agent.notInstalled', { command: agent.id })}</span></>}
      </FactRow>
      <FactRow label={t('settings.fact.version')}>{version ?? <span className="text-fg-3">{t('settings.fact.noLive')}</span>}</FactRow>
      <FactRow label={t('settings.fact.followUp')}>{steer ?? <span className="text-fg-3">—</span>}</FactRow>
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
    const next = show ? cur.filter(n => n !== f.name) : [...cur, f.name];
    const forAgent = { ...hidden, [c.id]: next };
    if (!next.length) delete forAgent[c.id];
    const all = { ...settings.hiddenOptions, [agent.id]: forAgent };
    if (!Object.keys(forAgent).length) delete all[agent.id];
    on.setSetting('hiddenOptions', all);
  };
  // Second line: what the family spans — its effort levels, Fast / 1M — so the row says which switch is being flipped
  const summary = (f: ModelFamily) => {
    if (f.variants.length === 1) return f.variants[0]!.name === f.name ? undefined : variantLabel(f.variants[0]!, f);
    const parts = [f.efforts.filter(Boolean).join(' / '), f.hasFast && 'Fast', f.hasLong && '1M'].filter(Boolean);
    return parts.join(' · ');
  };
  if (!controls?.length) return <Section desc={t('settings.models.desc', { agent: agent.name })}><Note>{t('settings.models.none', { agent: agent.name })}</Note></Section>;
  return (
    <>
      {controls.map((c, i) => {
        const families = groupModels(c.options);
        const off = hidden[c.id] ?? [];
        // With a single configOption the section heading names it; several get one labelled group each
        const several = controls.length > 1;
        return (
          <Section key={c.id} title={several ? c.name : undefined} count={several ? families.length - off.length : undefined} desc={i === 0 ? t('settings.models.desc', { agent: agent.name }) : undefined}>
            {families.map(f => {
              const shown = !off.includes(f.name);
              return (
                <ItemRow
                  key={f.name}
                  lead={<ModelMark family={f.name} />}
                  title={f.name}
                  desc={summary(f)}
                  dim={!shown}
                  trailing={<Switch checked={shown} onChange={v => toggle(c, f, v)} label={`${f.name} · ${c.name}`} />}
                />
              );
            })}
          </Section>
        );
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
  return <>{bySource.map(([source, list]) => <Group key={source}><SourceHead path={source} env={env} onOpen={on.openPath} />{list.map(row)}</Group>)}</>;
}

// Does the list come as several cards (so the Section must not wrap them in one)?
const asCards = (n: number | undefined) => (n ?? 0) > 0;

// Two MCP lists: what ACPilot hands over via ACP (switchable per agent) and what the CLI reads from its own files (read-only)
function McpSection({ agent, agents, inventory, settings, env, on }: Omit<AgentPageProps, 'accounts' | 'controls'>) {
  const entries = Object.entries(settings.mcpServers);
  const caps = inventory?.runtime?.mcp;
  const supported = (tr: McpTransport) => !caps || tr === 'stdio' || (tr === 'http' ? caps.http : caps.sse);

  // Membership toggle: `agents` absent means every agent; the list collapses back to "absent" once it covers everyone again
  const toggle = (name: string, s: McpServerSetting, onFor: boolean) => {
    const all = agents.map(a => a.id);
    const cur = s.agents ?? all;
    const next = onFor ? [...new Set([...cur, agent.id])] : cur.filter(a => a !== agent.id);
    const covers = all.every(a => next.includes(a));
    const { agents: _drop, ...rest } = s;
    on.setSetting('mcpServers', { ...settings.mcpServers, [name]: covers ? rest : { ...rest, agents: next } });
  };

  const nativeRow = (m: InventoryMcp) => (
    <ItemRow
      key={`${m.source}:${m.name}`}
      lead={TRANSPORT_ICON[m.transport]}
      title={m.name}
      desc={`${m.enabled ? '' : `${t('settings.mcp.disabled')} · `}${m.transport} · ${m.target}`}
      dim={!m.enabled}
    />
  );

  return (
    <>
      <Section
        title={t('settings.mcp.injected')}
        desc={t('settings.mcp.injected.desc')}
        action={<SectionAction icon={<Braces strokeWidth={1.5} />} onClick={() => on.openSettingsJson('acpilot.mcpServers')}>{t('settings.mcp.edit')}</SectionAction>}
      >
        {entries.length === 0 && <Note>{t('settings.mcp.injected.none')}</Note>}
        {entries.map(([name, s]) => {
          const tr = mcpTransport(s);
          const ok = supported(tr);
          const off = s.enabled === false;
          const target = s.command ? [s.command, ...(s.args ?? [])].join(' ') : s.url;
          return (
            <ItemRow
              key={name}
              lead={TRANSPORT_ICON[tr]}
              title={name}
              desc={!ok ? t('settings.mcp.unsupported', { agent: agent.name, transport: tr }) : `${off ? `${t('settings.mcp.disabled')} · ` : ''}${tr} · ${target}`}
              dim={off}
              trailing={<Switch checked={!off && ok && mcpAppliesTo(s, agent.id)} disabled={off || !ok} onChange={v => toggle(name, s, v)} label={`${name} · ${agent.name}`} />}
            />
          );
        })}
      </Section>

      <Section title={t('settings.mcp.native')} desc={t('settings.mcp.native.desc', { agent: agent.name })} cards={asCards(inventory?.mcp.length)}>
        <Grouped items={inventory?.mcp} sourceOf={m => m.source} row={nativeRow} env={env} on={on} empty={t('settings.mcp.none')} loading={!inventory} />
      </Section>
    </>
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
          mono
          dim={!f.exists}
          trailing={f.exists ? <span className="text-3 text-fg-3 tabular-nums">{fmtSize(f.size ?? 0)}</span> : <span className="text-3 text-fg-3">{t('settings.file.missing')}</span>}
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
