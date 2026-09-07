import type { ReactNode } from 'react';
import { ArrowLeft, Settings2 } from 'lucide-react';
import type { AgentInfo } from '@shared/transcript';
import { cn } from '../ui/cn';
import { AgentMark } from '../chat/AgentMark';
import { t } from '../i18n';

export type SettingsPage = { kind: 'general' } | { kind: 'agent'; id: AgentInfo['id'] };

type PageId = 'general' | AgentInfo['id'];
const pageId = (p: SettingsPage): PageId => (p.kind === 'agent' ? p.id : 'general');
const toPage = (id: PageId): SettingsPage => (id === 'general' ? { kind: 'general' } : { kind: 'agent', id });

export interface PageRailProps {
  agents: AgentInfo[];
  page: SettingsPage;
  onPage: (p: SettingsPage) => void;
  onBack: () => void;
}

// Full-width navigation on wide surfaces collapses to an icon rail in narrow webviews.
// Back navigation stays in this column and never consumes space beside the page heading.
export function PageRail({ agents, page, onPage, onBack }: PageRailProps) {
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
        'acp-settings-nav-item flex h-ctl shrink-0 items-center gap-gap rounded-md px-2 text-2 transition-colors',
        cur === id ? 'bg-active text-fg-1' : dim ? 'text-fg-3 hover:bg-hover' : 'text-fg-2 hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1',
      )}
    >
      <span className="flex size-icon-ctl shrink-0 items-center justify-center [&_svg]:size-icon-ctl">{icon}</span>
      <span className="acp-settings-nav-label min-w-0 truncate">{name}</span>
    </button>
  );
  return (
    <aside className="acp-settings-nav flex shrink-0 flex-col">
      <button type="button" onClick={onBack} title={t('settings.back')} aria-label={t('settings.back')}
        className="acp-settings-nav-item acp-back-link flex h-ctl shrink-0 items-center gap-gap rounded-sm px-2 text-2 text-fg-2 transition-colors hover:text-fg-1 active:text-fg-1">
        <ArrowLeft className="size-icon-ctl shrink-0" strokeWidth={1.5} aria-hidden />
        <span className="acp-settings-nav-label truncate">{t('settings.back')}</span>
      </button>
      <nav aria-label={t('settings.title')} className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {item('general', t('settings.nav.general'), <Settings2 strokeWidth={1.5} />)}
        {agents.map(a => item(a.id, a.name, <AgentMark id={a.id} name={a.name} />, a.available === false))}
      </nav>
    </aside>
  );
}
