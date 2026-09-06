import { useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AccountInfo, AgentId, AgentInfo, ConfigControl } from '@shared/transcript';
import type { AgentInventory } from '@shared/inventory';
import type { SettingKey, SettingsView } from '@shared/settings';
import type { Locale } from '@shared/i18n';
import { AppearanceContext, appearanceDataAttrs, type Appearance } from '../appearance';
import { IconButton } from '../ui/Button';
import { ShellLayerContext } from '../ui/Popover';
import { LocaleContext, t } from '../i18n';
import { HomePage, PageRail, PageStrip, type SettingsPage } from './Nav';
import { General } from './General';
import { AgentPage, type AgentTab } from './AgentPage';
import { TopBar } from './controls';
import { DEFAULT_LAYOUT, LayoutContext, type SettingsLayout } from './layout';
import './settings.css';

// Every action the settings page sends to the host; the LAB implements these with a fake host, the real page with postMessage
export interface SettingsHandlers {
  setSetting: <K extends SettingKey>(key: K, value: SettingsView[K]) => void;
  openPath: (path: string) => void;
  openSettingsJson: (key?: string) => void;
  refreshInventory: (agent: AgentId) => void;
  selectAccount: (id: string) => void;
  addAccount: (agent: AgentId) => void;
  removeAccount: (id: string) => void;
}

export interface SettingsEnv {
  home: string;
  cwd: string;
}

export interface SettingsShellProps {
  appearance: Appearance;
  theme: 'dark' | 'light';
  // Where the webview lives: the settings replace the chat in the sidebar (Codex-style); in the editor the same column is centred
  host: 'sidebar' | 'editor';
  locale: Locale;
  settings: SettingsView;
  agents: AgentInfo[];
  accounts: AccountInfo[];
  inventories: Partial<Record<AgentId, AgentInventory>>;
  // Per agent, the configOptions of its latest session (the hide lists are built from these)
  controls: Partial<Record<AgentId, ConfigControl[]>>;
  env: SettingsEnv;
  page: SettingsPage;
  onPage: (p: SettingsPage) => void;
  // Back from the settings to the chat
  onBack: () => void;
  // Tab an agent page opens on (deep links)
  initialTab?: AgentTab;
  // Layout under selection in the LAB; the real build passes nothing and gets the default
  layout?: SettingsLayout;
  on: SettingsHandlers;
}

// Settings surface, sidebar-shaped: a top bar (back · title · action), the page switch under it (strip / rail) or a home list (drill-down), then one page.
// The root doubles as the overlay layer for menus (Select), like the chat shell
export function SettingsShell(p: SettingsShellProps) {
  const root = useRef<HTMLDivElement>(null);
  const layout = p.layout ?? DEFAULT_LAYOUT;
  const drill = layout.switch === 'home';
  // Only drill-down has a home page; the other switches land on General instead
  const page: SettingsPage = p.page.kind === 'home' && !drill ? { kind: 'general' } : p.page;
  const agent = page.kind === 'agent' ? p.agents.find(a => a.id === page.id) : undefined;
  // In drill-down mode the bar names the page and backs up one level; otherwise it always says "Settings" and backs out to the chat
  const title = drill ? (page.kind === 'general' ? t('settings.nav.general') : agent?.name ?? t('settings.title')) : t('settings.title');
  const back = drill && page.kind !== 'home' ? () => p.onPage({ kind: 'home' }) : p.onBack;
  const action = agent && (
    <IconButton title={t('common.refresh')} aria-label={t('common.refresh')} onClick={() => p.on.refreshInventory(agent.id)}>
      <RefreshCw strokeWidth={1.5} />
    </IconButton>
  );
  const body = (
    <main className="min-w-0 flex-1 overflow-y-auto scroll-stable">
      {page.kind === 'home' && <HomePage agents={p.agents} inventories={p.inventories} env={p.env} page={page} onPage={p.onPage} />}
      {page.kind === 'general' && <General settings={p.settings} agents={p.agents} on={p.on} />}
      {agent && (
        <AgentPage
          key={agent.id}
          agent={agent}
          agents={p.agents}
          accounts={p.accounts.filter(a => a.agent === agent.id)}
          inventory={p.inventories[agent.id]}
          controls={p.controls[agent.id]}
          settings={p.settings}
          env={p.env}
          initialTab={p.initialTab}
          on={p.on}
        />
      )}
    </main>
  );
  return (
    <AppearanceContext.Provider value={p.appearance}>
      <LocaleContext.Provider value={p.locale}>
        <LayoutContext.Provider value={layout}>
          <ShellLayerContext.Provider value={root}>
            <div
              ref={root}
              className="acp-shell acp-settings relative flex h-full min-h-0 w-full flex-col overflow-hidden"
              data-theme={p.theme}
              data-surface-host={p.host}
              data-agent={agent?.id ?? p.settings.defaultAgent}
              {...appearanceDataAttrs(p.appearance)}
            >
              <TopBar title={title} onBack={back} action={action} />
              {layout.switch === 'strip' && <PageStrip agents={p.agents} page={page} onPage={p.onPage} />}
              {layout.switch === 'rail'
                ? <div className="flex min-h-0 flex-1"><PageRail agents={p.agents} page={page} onPage={p.onPage} />{body}</div>
                : body}
            </div>
          </ShellLayerContext.Provider>
        </LayoutContext.Provider>
      </LocaleContext.Provider>
    </AppearanceContext.Provider>
  );
}
