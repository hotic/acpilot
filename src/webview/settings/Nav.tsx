import type { ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
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
}

// A column of square icon buttons down the left edge (General's gear, then the agent marks; unavailable agents greyed, not hidden); the page fills the rest.
// The rail carries no names, so the top bar names the current page
export function PageRail({ agents, page, onPage }: PageRailProps) {
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
