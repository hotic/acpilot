import { useEffect, useMemo, useState } from 'react';
import type { AccountInfo, AgentId, AgentInfo, ConfigControl } from '@shared/transcript';
import type { AgentInventory } from '@shared/inventory';
import type { SettingsView } from '@shared/settings';
import type { SettingsHostMsg, SettingsInitState, SettingsWebviewMsg } from '@shared/settingsProtocol';
import type { Locale } from '@shared/i18n';
import { BASE_APPEARANCE, type Appearance } from '../appearance';
import { setLocale } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import { SettingsShell, type SettingsHandlers } from './SettingsShell';
import type { SettingsPage } from './Nav';

const post = (m: SettingsWebviewMsg) => vscodeApi().postMessage(m);

// Root of the settings webview: mirrors the host's pushed state, posts actions back. Remounts the shell when the locale changes so every t() re-evaluates
export function SettingsApp() {
  const [init, setInit] = useState<SettingsInitState>();
  const [appearance, setAppearance] = useState<Appearance>(BASE_APPEARANCE);
  const [locale, setLoc] = useState<Locale>('zh-CN');
  const [settings, setSettings] = useState<SettingsView>();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [inventories, setInventories] = useState<Partial<Record<AgentId, AgentInventory>>>({});
  const [controls, setControls] = useState<Partial<Record<AgentId, ConfigControl[]>>>({});
  const [page, setPage] = useState<SettingsPage>({ kind: 'general' });
  const theme = useVsCodeTheme();

  useEffect(() => {
    const onMsg = (e: MessageEvent<SettingsHostMsg>) => {
      const m = e.data;
      switch (m.type) {
        case 'settingsInit':
          setInit(m.state); setAppearance(m.state.appearance); setLocale(m.state.locale); setLoc(m.state.locale);
          setSettings(m.state.settings); setAgents(m.state.agents); setAccounts(m.state.accounts); setControls(m.state.controls);
          break;
        case 'settings': setLocale(m.locale); setLoc(m.locale); setSettings(m.settings); break;
        case 'appearance': setAppearance(m.appearance); break;
        case 'agents': setAgents(m.agents); break;
        case 'accounts': setAccounts(m.accounts); break;
        case 'controls': setControls(c => ({ ...c, [m.agent]: m.controls })); break;
        case 'inventory': setInventories(inv => ({ ...inv, [m.agent]: m.inventory })); break;
      }
    };
    window.addEventListener('message', onMsg);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const on = useMemo<SettingsHandlers>(() => ({
    setSetting: (key, value) => post({ type: 'setSetting', key, value }),
    openPath: path => post({ type: 'openPath', path }),
    openSettingsJson: key => post({ type: 'openSettingsJson', key }),
    refreshInventory: agent => { setInventories(inv => { const { [agent]: _drop, ...rest } = inv; return rest; }); post({ type: 'inventory', agent }); },
    selectAccount: id => post({ type: 'selectAccount', id }),
    addAccount: agent => post({ type: 'addAccount', agent, via: 'auto' }),
    removeAccount: id => post({ type: 'removeAccount', id }),
  }), []);

  if (!init || !settings) return null;
  // Standalone root (an editor tab); inside the chat sidebar the Shell mounts SettingsShell itself and wires onBack to its own view state
  return (
    <SettingsShell
      key={locale}
      appearance={appearance}
      theme={theme}
      host="editor"
      locale={locale}
      settings={settings}
      agents={agents}
      accounts={accounts}
      inventories={inventories}
      controls={controls}
      env={{ home: init.home, cwd: init.cwd }}
      page={page}
      onPage={setPage}
      onBack={() => post({ type: 'close' })}
      on={on}
    />
  );
}

// VS Code hangs theme classes on body (vscode-dark / vscode-light / vscode-high-contrast*); follow it
function useVsCodeTheme(): 'dark' | 'light' {
  const read = () => (document.body.classList.contains('vscode-light') || document.body.classList.contains('vscode-high-contrast-light') ? 'light' : 'dark');
  const [theme, setTheme] = useState<'dark' | 'light'>(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(read()));
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  return theme;
}
