import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Braces, ChevronRight, Cpu, FileText, Globe, KeyRound, Plus, Server, SlidersHorizontal, Sparkles, X } from 'lucide-react';
import type { AccountInfo, AgentInfo, ConfigControl } from '@shared/transcript';
import type { AgentInventory, InventoryFile, InventoryMcp, InventorySkill } from '@shared/inventory';
import { mcpAppliesTo, mcpTransport, type McpServerSetting, type McpTransport, type SettingsView } from '@shared/settings';
import { groupModels, variantLabel, type ModelFamily } from '@shared/models';
import { AgentMark } from '../chat/AgentMark';
import { IconButton } from '../ui/Button';
import { Collapse } from '../ui/Collapse';
import { cn } from '../ui/cn';
import { t } from '../i18n';
import { Count, Dot, FactRow, Group, ItemRow, Note, Page, PageTitle, PathText, Section, SectionAction, SectionHead, Segmented, SourceHead, Switch, TabStrip, Tag, shortPath } from './controls';
import { useLayout, type GroupStyle } from './layout';
import type { SettingsEnv, SettingsHandlers } from './SettingsShell';

export type AgentTab = 'models' | 'mcp' | 'skills' | 'rules' | 'config';
const TABS: AgentTab[] = ['models', 'mcp', 'skills', 'rules', 'config'];

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
  // Tab shown first (deep links); the page keeps its own tab state afterwards
  initialTab?: AgentTab;
  on: SettingsHandlers;
}

// One agent: identity block, accounts when it has an account layer, then five sections (tabbed or stacked, per the nav axis): the option families
// shown in the composer menus, and the extension inventory. Everything read from the CLI's own files is read-only here — rows open the file,
// ACPilot never writes it. Only the ACPilot-injected MCP list and the option families have switches
export function AgentPage({ agent, agents, accounts, inventory, controls, settings, env, initialTab, on }: AgentPageProps) {
  const { nav } = useLayout();
  const [tab, setTab] = useState<AgentTab>(initialTab ?? 'models');
  const [open, setOpen] = useState<Record<AgentTab, boolean>>({ models: true, mcp: false, skills: false, rules: false, config: false });
  useEffect(() => { if (!inventory) on.refreshInventory(agent.id); }, [agent.id, inventory, on]);

  const injected = useMemo(() => Object.entries(settings.mcpServers).filter(([, s]) => s.enabled !== false), [settings.mcpServers]);
  const counts: Record<AgentTab, number> = {
    models: controls?.reduce((n, c) => n + groupModels(c.options).length, 0) ?? 0,
    mcp: injected.filter(([, s]) => mcpAppliesTo(s, agent.id)).length + (inventory?.mcp.length ?? 0),
    skills: inventory?.skills.length ?? 0,
    rules: inventory?.rules.filter(r => r.exists).length ?? 0,
    config: inventory?.config.filter(c => c.exists).length ?? 0,
  };
  const title = (id: AgentTab) => t(`settings.tab.${id}` as const);
  const count = (id: AgentTab) => (inventory ? counts[id] : undefined);

  const sections: Record<AgentTab, ReactNode> = {
    models: <ModelsSection agent={agent} controls={controls} settings={settings} on={on} />,
    mcp: <McpSection agent={agent} agents={agents} inventory={inventory} settings={settings} env={env} on={on} />,
    skills: <SkillsSection agent={agent} inventory={inventory} env={env} on={on} />,
    rules: <FilesSection kind="rules" agent={agent} files={inventory?.rules} env={env} on={on} />,
    config: <FilesSection kind="config" agent={agent} files={inventory?.config} env={env} on={on} />,
  };

  return (
    <Page>
      <AgentHead agent={agent} inventory={inventory} env={env} />

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

      {nav === 'pills' && (
        <>
          <Segmented<AgentTab> options={TABS.map(id => ({ value: id, label: inventory ? `${title(id)} ${counts[id]}` : title(id) }))} value={tab} onChange={setTab} label={t('settings.nav.agents')} />
          {sections[tab]}
        </>
      )}
      {nav === 'tabs' && (
        <>
          <TabStrip<AgentTab> tabs={TABS.map(id => ({ value: id, label: title(id), count: count(id) }))} value={tab} onChange={setTab} label={t('settings.nav.agents')} />
          {sections[tab]}
        </>
      )}
      {nav === 'stack' && TABS.map(id => (
        <div key={id} className="flex flex-col gap-2">
          <SectionHead count={count(id)}>{title(id)}</SectionHead>
          {sections[id]}
        </div>
      ))}
      {nav === 'fold' && TABS.map(id => (
        <FoldSection key={id} title={title(id)} count={count(id)} open={open[id]} onToggle={() => setOpen(o => ({ ...o, [id]: !o[id] }))}>
          {sections[id]}
        </FoldSection>
      ))}
    </Page>
  );
}

// Identity block, per the head axis: hero (tile · big name · status line · tag row), bar (mark · name + version · one status line), facts (no name — the tab / top bar carries it — just a card of facts)
function AgentHead({ agent, inventory, env }: { agent: AgentInfo; inventory?: AgentInventory; env: SettingsEnv }) {
  const { head } = useLayout();
  // Only the path may truncate; the words around it keep their width
  const status = inventory === undefined
    ? <span className="shimmer">{t('settings.agent.probing')}</span>
    : inventory.binary
      ? <><Dot ok /><span className="shrink-0">{t('settings.agent.installed')}</span><span className="shrink-0 text-fg-3">·</span><PathText path={inventory.binary} env={env} className="text-fg-2" /></>
      : <><Dot ok={false} /><span className="truncate">{t('settings.agent.notInstalled', { command: agent.id })}</span></>;
  const version = inventory?.runtime?.version ? t('settings.agent.version', { name: inventory.runtime.name ?? agent.name, version: inventory.runtime.version }) : undefined;
  const steer = inventory ? (inventory.steer ? t('settings.agent.steer') : t('settings.agent.noSteer')) : undefined;

  if (head === 'hero') {
    return (
      <div className="flex items-start gap-pad">
        <div className="flex size-(--tile) shrink-0 items-center justify-center rounded-lg bg-hover text-fg-1">
          <AgentMark id={agent.id} name={agent.name} className="size-lead" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <PageTitle>{agent.name}</PageTitle>
          <div className="flex min-w-0 items-center gap-1.5 text-2 text-fg-2">{status}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {version ? <Tag>{version}</Tag> : <span className="text-3 text-fg-3">{t('settings.agent.noLive')}</span>}
            {inventory && <Tag tone={inventory.steer ? 'ok' : 'neutral'}>{steer}</Tag>}
          </div>
        </div>
      </div>
    );
  }
  if (head === 'bar') {
    return (
      <div className="flex items-start gap-gap">
        <span className="flex size-lead shrink-0 items-center justify-center text-fg-1 [&_svg]:size-icon"><AgentMark id={agent.id} name={agent.name} /></span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline gap-2 text-2 font-medium text-fg-strong">
            <span className="truncate">{agent.name}</span>
            {version && <span className="shrink-0 text-3 font-normal text-fg-3">{version}</span>}
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-3 text-fg-2">
            {status}
            {steer && <><span className="shrink-0 text-fg-3">·</span><span className="shrink-0 text-fg-3">{steer}</span></>}
          </div>
        </div>
      </div>
    );
  }
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

// nav=fold: a top-level section that collapses; the head is a section heading with a chevron in the lead slot
function FoldSection({ title, count, open, onToggle, children }: { title: string; count?: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={onToggle} className="-mx-1.5 flex min-h-ctl items-center gap-gap rounded-md px-1.5 text-left transition-colors hover:bg-hover focus-visible:bg-hover">
        <span className="flex size-lead shrink-0 items-center justify-center text-fg-3"><ChevronRight className={cn('size-icon transition-transform', open && 'rotate-90')} strokeWidth={1.5} /></span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-(length:--text-h) leading-(--text-h-lh) font-medium text-fg-strong">
          <span className="truncate">{title}</span>
          {count !== undefined && <Count n={count} />}
        </span>
      </button>
      <Collapse open={open}>
        <div className="flex flex-col gap-pad pt-2 pb-1">{children}</div>
      </Collapse>
    </div>
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
        return (
          // With a single configOption the tab's own heading names it; several get one titled group each
          <Section key={c.id} title={controls.length > 1 ? c.name : undefined} desc={i === 0 ? t('settings.models.desc', { agent: agent.name }) : undefined} count={controls.length > 1 ? families.length - off.length : undefined}>
            {families.map(f => {
              const shown = !off.includes(f.name);
              return (
                <ItemRow
                  key={f.name}
                  lead={<Cpu strokeWidth={1.5} />}
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

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const dirName = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')));

// Rows grouped by the file / directory they came from, per the group axis: sub-headed runs inside one card, one card per source, or one flat list
function Grouped<T>({ items, sourceOf, row, env, on, empty, loading }: { items: T[] | undefined; sourceOf: (x: T) => string; row: (x: T, flat: boolean) => ReactNode; env: SettingsEnv; on: SettingsHandlers; empty: string; loading: boolean }) {
  const { group } = useLayout();
  const bySource = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const x of items ?? []) (m.get(sourceOf(x)) ?? m.set(sourceOf(x), []).get(sourceOf(x))!).push(x);
    return [...m.entries()];
  }, [items, sourceOf]);
  if (loading) return <Note shimmer>{t('settings.loading')}</Note>;
  if (bySource.length === 0) return <Note>{empty}</Note>;
  if (group === 'flat') return <>{(items ?? []).map(x => row(x, true))}</>;
  if (group === 'cards') {
    return <>{bySource.map(([source, list]) => <Group key={source}><SourceHead path={source} env={env} onOpen={on.openPath} variant="cards" />{list.map(x => row(x, false))}</Group>)}</>;
  }
  return <>{bySource.map(([source, list]) => <div key={source} className="flex flex-col"><SourceHead path={source} env={env} onOpen={on.openPath} variant="pathrow" />{list.map(x => row(x, false))}</div>)}</>;
}

// Does the group axis produce several cards for this list (so the Section must not wrap them in one)?
const asCards = (group: GroupStyle, n: number | undefined) => group === 'cards' && (n ?? 0) > 0;

// Two MCP lists: what ACPilot hands over via ACP (switchable per agent) and what the CLI reads from its own files (read-only)
function McpSection({ agent, agents, inventory, settings, env, on }: Omit<AgentPageProps, 'accounts'>) {
  const { trailing, group } = useLayout();
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

  const nativeRow = (m: InventoryMcp, flat: boolean) => {
    const key = `${m.source}:${m.name}`;
    if (trailing === 'lean') {
      return (
        <ItemRow
          key={key}
          lead={TRANSPORT_ICON[m.transport]}
          title={m.name}
          desc={`${m.enabled ? '' : `${t('settings.mcp.disabled')} · `}${m.transport} · ${m.target}`}
          dim={!m.enabled}
          trailing={flat ? <Tag tone="muted">{baseName(m.source)}</Tag> : undefined}
          onOpen={flat ? () => on.openPath(m.source) : undefined}
        />
      );
    }
    return (
      <ItemRow
        key={key}
        lead={TRANSPORT_ICON[m.transport]}
        title={m.name}
        desc={m.target}
        trailing={<><Tag>{t(`settings.scope.${m.scope}` as const)}</Tag><Tag tone="muted">{m.transport}</Tag>{!m.enabled && <Tag tone="warn">{t('settings.mcp.disabled')}</Tag>}{flat && <Tag tone="muted">{baseName(m.source)}</Tag>}</>}
        onOpen={flat ? () => on.openPath(m.source) : undefined}
      />
    );
  };

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
          const sw = <Switch checked={!off && ok && mcpAppliesTo(s, agent.id)} disabled={off || !ok} onChange={v => toggle(name, s, v)} label={`${name} · ${agent.name}`} />;
          if (trailing === 'lean') {
            return (
              <ItemRow
                key={name}
                lead={TRANSPORT_ICON[tr]}
                title={name}
                desc={!ok ? t('settings.mcp.unsupported', { agent: agent.name, transport: tr }) : `${off ? `${t('settings.mcp.disabled')} · ` : ''}${tr} · ${target}`}
                dim={off}
                trailing={sw}
              />
            );
          }
          return (
            <ItemRow
              key={name}
              lead={TRANSPORT_ICON[tr]}
              title={name}
              desc={off ? t('settings.mcp.disabled') : !ok ? t('settings.mcp.unsupported', { agent: agent.name, transport: tr }) : target}
              trailing={<><Tag tone="muted">{tr}</Tag>{sw}</>}
            />
          );
        })}
      </Section>

      <Section title={t('settings.mcp.native')} desc={t('settings.mcp.native.desc', { agent: agent.name })} cards={asCards(group, inventory?.mcp.length)}>
        <Grouped items={inventory?.mcp} sourceOf={m => m.source} row={nativeRow} env={env} on={on} empty={t('settings.mcp.none')} loading={!inventory} />
      </Section>
    </>
  );
}

// Skills grouped by the directory they were found in (…/skills/<name>/SKILL.md → …/skills)
const skillsRoot = (s: InventorySkill) => dirName(dirName(s.path));

function SkillsSection({ agent, inventory, env, on }: { agent: AgentInfo; inventory?: AgentInventory; env: SettingsEnv; on: SettingsHandlers }) {
  const { trailing, group } = useLayout();
  const row = (s: InventorySkill, flat: boolean) => (
    <ItemRow
      key={s.path}
      lead={<Sparkles strokeWidth={1.5} />}
      title={s.name}
      desc={s.description ?? shortPath(s.path, env)}
      trailing={trailing === 'tags' ? <Tag>{t(`settings.scope.${s.scope}` as const)}</Tag> : flat && s.scope === 'project' ? <Tag>{t('settings.scope.project')}</Tag> : undefined}
      onOpen={() => on.openPath(s.path)}
    />
  );
  return (
    <Section desc={t('settings.skills.desc', { agent: agent.name })} cards={asCards(group, inventory?.skills.length)}>
      <Grouped items={inventory?.skills} sourceOf={skillsRoot} row={row} env={env} on={on} empty={t('settings.skills.none')} loading={!inventory} />
    </Section>
  );
}

// Rules and config share one shape: files that may or may not exist; existing ones first, missing ones dimmed so the candidate locations stay visible
function FilesSection({ kind, agent, files, env, on }: { kind: 'rules' | 'config'; agent: AgentInfo; files?: InventoryFile[]; env: SettingsEnv; on: SettingsHandlers }) {
  const { trailing } = useLayout();
  const sorted = useMemo(() => [...(files ?? [])].sort((a, b) => Number(b.exists) - Number(a.exists)), [files]);
  const Icon = kind === 'rules' ? FileText : SlidersHorizontal;
  const size = (f: InventoryFile) => <span className="text-3 text-fg-3 tabular-nums">{fmtSize(f.size ?? 0)}</span>;
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
          trailing={trailing === 'tags'
            ? <><Tag>{t(`settings.scope.${f.scope}` as const)}</Tag>{f.exists ? size(f) : <Tag tone="muted">{t('settings.file.missing')}</Tag>}</>
            : f.exists ? size(f) : <span className="text-3 text-fg-3">{t('settings.file.missing')}</span>}
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
