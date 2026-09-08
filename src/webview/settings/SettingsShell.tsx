import { useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { AccountInfo, AgentId, AgentInfo, ConfigControl } from '@shared/transcript';
import type { AgentInventory } from '@shared/inventory';
import type { SettingKey, SettingsView } from '@shared/settings';
import type { Locale } from '@shared/i18n';
import { AppearanceContext, appearanceDataAttrs, type Appearance } from '../appearance';
import { IconButton } from '../ui/Button';
import { ShellLayerContext } from '../ui/Popover';
import { useScrollReveal } from '../ui/useScrollReveal';
import { LocaleContext, t } from '../i18n';
import { PageRail, type SettingsPage } from './Nav';
import { General } from './General';
import { AgentPage } from './AgentPage';
import { Page, PageHeader } from './controls';

// Every action the settings page sends to the host; the LAB implements these with a fake host, the real page with postMessage
export interface SettingsHandlers {
  setSetting: <K extends SettingKey>(key: K, value: SettingsView[K]) => void;
  openPath: (path: string) => void;
  refreshInventory: (agent: AgentId) => void;
  selectAccount: (id: string) => void;
  addAccount: (agent: AgentId) => void;
  removeAccount: (id: string) => void;
  // An agent page with accounts opened: re-read their quotas
  refreshQuota?: (agent: AgentId) => void;
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
  on: SettingsHandlers;
}

// Navigation and content are separate columns. The page heading shares the cards' content measure.
// The root doubles as the overlay layer for menus, like the chat shell.
export function SettingsShell(p: SettingsShellProps) {
  const root = useRef<HTMLDivElement>(null);
  useScrollReveal(root);
  const page = p.page;
  const agent = page.kind === 'agent' ? p.agents.find(a => a.id === page.id) : undefined;
  const title = agent ? t('settings.agent.title', { agent: agent.name }) : t('settings.general.title');
  const action = agent && (
    <IconButton title={t('common.refresh')} aria-label={t('common.refresh')} onClick={() => p.on.refreshInventory(agent.id)}>
      <RefreshCw strokeWidth={1.5} />
    </IconButton>
  );
  return (
    <AppearanceContext.Provider value={p.appearance}>
      <LocaleContext.Provider value={p.locale}>
        <ShellLayerContext.Provider value={root}>
          <div
            ref={root}
            className="acp-shell acp-settings @container/settings-shell relative flex h-full min-h-0 w-full flex-col overflow-hidden"
            data-theme={p.theme}
            data-surface-host={p.host}
            data-agent={agent?.id ?? p.settings.defaultAgent}
            {...appearanceDataAttrs(p.appearance)}
          >
            <div className="flex min-h-0 flex-1">
              <PageRail agents={p.agents} page={p.page} onPage={p.onPage} onBack={p.onBack} />
              <main key={page.kind === 'agent' ? page.id : page.kind} className="min-w-0 flex-1 overflow-y-auto scroll-stable">
                <Page>
                  <PageHeader title={title} action={action} />
                  {p.page.kind === 'general' && <General settings={p.settings} agents={p.agents} on={p.on} />}
                  {agent && (
                    <AgentPage
                      key={agent.id}
                      agent={agent}
                      accounts={p.accounts.filter(a => a.agent === agent.id)}
                      inventory={p.inventories[agent.id]}
                      controls={p.controls[agent.id]}
                      settings={p.settings}
                      env={p.env}
                      on={p.on}
                    />
                  )}
                </Page>
              </main>
            </div>
          </div>
        </ShellLayerContext.Provider>
      </LocaleContext.Provider>
    </AppearanceContext.Provider>
  );
}
