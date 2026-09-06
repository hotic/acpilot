import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { appearanceFromSettings, type Appearance, type AxisKey } from '@shared/appearance';
import type { HiddenMap } from '@shared/settings';
import { AgentRegistry, type CustomAgentSetting } from './acp/AgentRegistry';
import { AccountManager } from './accounts/AccountManager';
import { AccountStore, type SecretVault } from './accounts/AccountStore';
import { DevinAccountProvider } from './accounts/devin';
import { SessionManager } from './SessionManager';
import { SettingsCenter } from './settings';
import { setHostLocale } from './i18n';
import { TranscriptStore } from './store/TranscriptStore';
import { WebviewBridge } from './bridge';
import { WorkspaceFiles } from './files';

const VIEW_ID = 'acpilot.chat';

export async function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('ACPilot', { log: true });
  const cfg = () => vscode.workspace.getConfiguration('acpilot');
  const appearance = (): Appearance => appearanceFromSettings((k: AxisKey) => cfg().get(`appearance.${k}`));
  const registry = () => new AgentRegistry(cfg().get<Record<string, CustomAgentSetting>>('agents') ?? {});
  const toast = (level: 'info' | 'error', text: string) => (level === 'error' ? vscode.window.showErrorMessage(text) : vscode.window.showInformationMessage(text));
  const runInTerminal = (title: string, command: string, args: string[], env?: Record<string, string | null>) => {
    const t = vscode.window.createTerminal({ name: title, env });
    t.show();
    t.sendText([command, ...args].map(shellQuote).join(' '));
  };

  // Secrets go into the system keychain (context.secrets); account metadata goes into globalStorage/accounts.json
  const vault: SecretVault = {
    get: async k => context.secrets.get(k),
    store: async (k, v) => context.secrets.store(k, v),
    delete: async k => context.secrets.delete(k),
  };
  const storage = context.globalStorageUri.fsPath;
  const accountStore = new AccountStore(join(storage, 'accounts.json'), vault);
  await accountStore.load();
  let activeRegistry = registry();
  const accounts = new AccountManager({
    store: accountStore,
    providers: [new DevinAccountProvider(join(storage, 'scratch'), () => activeRegistry.resolveBinary('devin'))],
    log: line => log.info(line),
    runInTerminal,
    toast,
  });

  const sessionsDir = join(storage, 'sessions');
  const manager = new SessionManager({
    registry: activeRegistry,
    store: new TranscriptStore(sessionsDir),
    log: line => log.info(line),
    cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
    defaultAgent: () => cfg().get<string>('defaultAgent') ?? 'grok',
    runInTerminal,
    toast,
    accounts,
    compaction: () => ({ atTokens: cfg().get<number>('compactAtTokens') ?? 300_000, auto: cfg().get<boolean>('autoCompact') ?? true }),
    hidden: () => cfg().get<HiddenMap>('hiddenOptions') ?? {},
  });
  await manager.init();

  // The settings page's backend: reads / writes acpilot.*, scans agent inventories; every bridge gets a subscription
  const settingsCenter = new SettingsCenter({
    read: key => cfg().get(key),
    write: (key, value) => cfg().update(key, value, vscode.ConfigurationTarget.Global),
    hostLanguage: () => vscode.env.language,
    registry: () => manager.registry,
    runtimeInfo: agent => manager.runtimeInfo(agent),
    home: homedir,
    cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
    log: line => log.info(line),
  });
  setHostLocale(settingsCenter.locale());

  const bridges = new Set<WebviewBridge>();
  const env = { extensionUri: context.extensionUri, appearance, sessionsDir, files: new WorkspaceFiles(), settings: settingsCenter, home: homedir, cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(), log: (line: string) => log.info(line) };
  const attach = (webview: vscode.Webview, host: 'sidebar' | 'editor') => {
    const b = new WebviewBridge(webview, host, manager, env);
    bridges.add(b);
    return b;
  };

  context.subscriptions.push(
    log,
    vscode.window.registerWebviewViewProvider(VIEW_ID, {
      resolveWebviewView(view) {
        const b = attach(view.webview, 'sidebar');
        view.onDidDispose(() => { bridges.delete(b); b.dispose(); });
      },
    }, { webviewOptions: { retainContextWhenHidden: true } }),

    vscode.commands.registerCommand('acpilot.newSession', () => manager.newSession()),
    vscode.commands.registerCommand('acpilot.showLog', () => log.show()),
    vscode.commands.registerCommand('acpilot.openInEditor', () => {
      const panel = vscode.window.createWebviewPanel('acpilot.editor', 'ACPilot', vscode.ViewColumn.Active, { retainContextWhenHidden: true });
      panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');
      const b = attach(panel.webview, 'editor');
      const sub = manager.subscribe(ev => { if (ev.type === 'session') panel.title = ev.session.title; });
      panel.onDidDispose(() => { sub(); bridges.delete(b); b.dispose(); });
    }),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('acpilot.appearance')) for (const b of bridges) b.pushAppearance();
      if (e.affectsConfiguration('acpilot.agents')) { activeRegistry = registry(); manager.setRegistry(activeRegistry); }
      if (e.affectsConfiguration('acpilot.hiddenOptions')) manager.emitHidden();
      // Any other acpilot.* knob the settings page shows (language, followUp, mcpServers, …): re-push the view and follow a language change host-side
      if (e.affectsConfiguration('acpilot') && !e.affectsConfiguration('acpilot.appearance') && !e.affectsConfiguration('acpilot.agents')) {
        settingsCenter.emit();
        setHostLocale(settingsCenter.locale());
      }
    }),
    { dispose: () => { void manager.dispose(); for (const b of bridges) b.dispose(); } },
  );
}

export function deactivate() {}

// Commands run in a terminal: paths with spaces (/Applications/Devin.app/…) need quoting
function shellQuote(s: string): string {
  return /^[\w./=:@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
