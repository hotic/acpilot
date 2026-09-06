import type { ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import type { AgentInfo } from '@shared/transcript';
import type { AgentInventory } from '@shared/inventory';
import { cn } from '../ui/cn';
import { AgentMark } from '../chat/AgentMark';
import { t } from '../i18n';
import { Dot, Group, ItemRow, Page, PathText, Section, TabStrip, type Tab } from './controls';
import type { SettingsEnv } from './SettingsShell';

export type SettingsPage = { kind: 'home' } | { kind: 'general' } | { kind: 'agent'; id: AgentInfo['id'] };

export const samePage = (a: SettingsPage, b: SettingsPage) => a.kind === b.kind && (a.kind !== 'agent' || b.kind !== 'agent' || a.id === b.id);

type PageId = 'general' | AgentInfo['id'];
const pageId = (p: SettingsPage): PageId => (p.kind === 'agent' ? p.id : 'general');
const toPage = (id: PageId): SettingsPage => (id === 'general' ? { kind: 'general' } : { kind: 'agent', id });

interface SwitchProps {
  agents: AgentInfo[];
  page: SettingsPage;
  onPage: (p: SettingsPage) => void;
}

// switch=strip: underline tabs under the top bar — General first, then one tab per agent (mark + name; unavailable ones greyed, not hidden)
export function PageStrip({ agents, page, onPage }: SwitchProps) {
  const tabs: Tab<PageId>[] = [
    { value: 'general', label: t('settings.nav.general'), icon: <Settings2 strokeWidth={1.5} /> },
    ...agents.map(a => ({ value: a.id, label: a.name, icon: <AgentMark id={a.id} name={a.name} />, dim: a.available === false })),
  ];
  return <TabStrip tabs={tabs} value={pageId(page)} onChange={id => onPage(toPage(id))} label={t('settings.title')} className="shrink-0 px-page" />;
}

// switch=rail: a column of square icon buttons down the left edge (General's gear, then the agent marks); the page fills the rest
export function PageRail({ agents, page, onPage }: SwitchProps) {
  const cur = pageId(page);
  const item = (id: PageId, name: string, icon: ReactNode, dim?: boolean) => (
    <button
      key={id}
      type="button"
      title={name}
      aria-label={name}
      aria-current={cur === id ? 'page' : undefined}
      onClick={() => onPage(toPage(id))}
      className={cn(
        'flex size-ctl shrink-0 items-center justify-center rounded-md transition-colors [&_svg]:size-icon-ctl',
        cur === id ? 'bg-active text-fg-1' : dim ? 'text-fg-3 hover:bg-hover' : 'text-fg-2 hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1',
      )}
    >
      {icon}
    </button>
  );
  return (
    <nav aria-label={t('settings.title')} className="flex shrink-0 flex-col gap-0.5 border-r border-line p-1.5">
      {item('general', t('settings.nav.general'), <Settings2 strokeWidth={1.5} />)}
      {agents.map(a => item(a.id, a.name, <AgentMark id={a.id} name={a.name} />, a.available === false))}
    </nav>
  );
}

// switch=home: the first page is a list — General, then the agents with their install status; each row opens its page, the top bar's back returns here
export function HomePage({ agents, inventories, env, onPage }: SwitchProps & { inventories: Partial<Record<AgentInfo['id'], AgentInventory>>; env: SettingsEnv }) {
  return (
    <Page>
      <Group>
        <ItemRow lead={<Settings2 strokeWidth={1.5} />} title={t('settings.nav.general')} desc={t('settings.home.general.desc')} onClick={() => onPage({ kind: 'general' })} />
      </Group>
      <Section title={t('settings.nav.agents')}>
        {agents.map(a => {
          const inv = inventories[a.id];
          const desc = inv === undefined
            ? undefined
            : inv.binary
              ? <span className="flex items-center gap-1.5"><Dot ok /><PathText path={inv.binary} env={env} className="text-fg-3" /></span>
              : <span className="flex items-center gap-1.5"><Dot ok={false} />{t('settings.agent.notInstalled', { command: a.id })}</span>;
          return <ItemRow key={a.id} lead={<AgentMark id={a.id} name={a.name} />} title={a.name} desc={desc} dim={a.available === false} onClick={() => onPage({ kind: 'agent', id: a.id })} />;
        })}
      </Section>
    </Page>
  );
}
