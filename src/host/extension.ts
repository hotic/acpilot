import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { appearanceFromSettings, type Appearance, type AxisKey } from '@shared/appearance';
import type { HiddenMap } from '@shared/settings';
import { AgentRegistry, type CustomAgentSetting } from './acp/AgentRegistry';
import { AccountManager } from './accounts/AccountManager';
import { AccountStore, FileVault } from './accounts/AccountStore';
import { DevinAccountProvider } from './accounts/devin';
import { LocalAccounts } from './accounts/local';
import { SessionManager } from './SessionManager';
import { SettingsCenter } from './settings';
import { msg } from './errors';
import { setHostLocale } from './i18n';
import { acpiraHome, migrateOnce } from './store/dataDir';
import { TranscriptStore } from './store/TranscriptStore';
import { WebviewBridge } from './bridge';
import { WorkspaceFiles } from './files';

const VIEW_ID = 'acpira.chat';

export async function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Acpira', { log: true });
  const cfg = () => vscode.workspace.getConfiguration('acpira');
  const appearance = (): Appearance => appearanceFromSettings((k: AxisKey) => cfg().get(`appearance.${k}`));
  const registry = () => new AgentRegistry(cfg().get<Record<string, CustomAgentSetting>>('agents') ?? {});
  const toast = (level: 'info' | 'error', text: string) => (level === 'error' ? vscode.window.showErrorMessage(text) : vscode.window.showInformationMessage(text));
  const runInTerminal = (title: string, command: string, args: string[], env?: Record<string, string | null>) => {
    const t = vscode.window.createTerminal({ name: title, env });
    t.show();
    t.sendText([command, ...args].map(shellQuote).join(' '));
  };

  // ~/.acpira (ACPIRA_HOME) holds accounts.json, secrets.json, sessions/, scratch/; copy legacy globalStorage once
  const root = acpiraHome();
  const vault = new FileVault(join(root, 'secrets.json'), line => log.info(line));
  await migrateOnce({
    from: context.globalStorageUri.fsPath,
    to: root,
    oldVault: {
      get: async k => context.secrets.get(k),
      store: async (k, v) => context.secrets.store(k, v),
      delete: async k => context.secrets.delete(k),
    },
    newVault: vault,
    log: line => log.info(line),
  });
  const accountStore = new AccountStore(join(root, 'accounts.json'), vault, line => log.info(line));
  await accountStore.load();
  let activeRegistry = registry();
  const accounts = new AccountManager({
    store: accountStore,
    providers: [new DevinAccountProvider(join(root, 'scratch'), () => activeRegistry.resolveBinary('devin'))],
    log: line => log.info(line),
    runInTerminal,
    toast,
  });

  const sessionsDir = join(root, 'sessions');
  const manager = new SessionManager({
    registry: activeRegistry,
    store: new TranscriptStore(sessionsDir, line => log.info(line)),
    log: line => log.info(line),
    cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
    defaultAgent: () => cfg().get<string>('defaultAgent') ?? 'grok',
    runInTerminal,
    toast,
    accounts,
    localAccounts: new LocalAccounts({ env: agent => ({ ...process.env, ...activeRegistry.get(agent).env }) }),
    compaction: () => ({ atTokens: cfg().get<number>('compactAtTokens') ?? 300_000, auto: cfg().get<boolean>('autoCompact') ?? true }),
    hidden: () => cfg().get<HiddenMap>('hiddenOptions') ?? {},
  });
  await manager.init();

  // The settings page's backend: reads / writes acpira.*, scans agent inventories; every bridge gets a subscription
  const settingsCenter = new SettingsCenter({
    read: key => cfg().get(key),
    write: (key, value) => cfg().update(key, value, vscode.ConfigurationTarget.Global),
    writeAppearance: (axis, value) => cfg().update(`appearance.${axis}`, value, vscode.ConfigurationTarget.Global),
    hostLanguage: () => vscode.env.language,
    registry: () => manager.registry,
    runtimeInfo: agent => manager.runtimeInfo(agent),
    home: homedir,
    cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(),
  });
  setHostLocale(settingsCenter.locale());

  // Every webview (the sidebar, each editor tab) is its own bridge with its own viewer, so tabs show different sessions side by side
  const bridges = new Set<WebviewBridge>();
  let sidebar: WebviewBridge | undefined;
  const env = { extensionUri: context.extensionUri, appearance, sessionsDir, files: new WorkspaceFiles(), settings: settingsCenter, home: homedir, cwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(), log: (line: string) => log.info(line) };
  const attach = (webview: vscode.Webview, host: 'sidebar' | 'editor', initial?: string | { mostRecent: true }) => {
    const b = new WebviewBridge(webview, host, manager, env, initial);
    bridges.add(b);
    return b;
  };

  context.subscriptions.push(
    log,
    vscode.window.registerWebviewViewProvider(VIEW_ID, {
      resolveWebviewView(view) {
        const b = sidebar = attach(view.webview, 'sidebar', { mostRecent: true });
        view.onDidDispose(() => { if (sidebar === b) sidebar = undefined; bridges.delete(b); b.dispose(); });
      },
    }, { webviewOptions: { retainContextWhenHidden: true } }),

    vscode.commands.registerCommand('acpira.openView', () => vscode.commands.executeCommand('acpira.chat.focus')),
    vscode.commands.registerCommand('acpira.newSession', () => (sidebar?.viewer ?? manager).newSession()),
    vscode.commands.registerCommand('acpira.showLog', () => log.show()),
    // A new tab is a new conversation: without a session id (title bar / command palette) it opens on a fresh session; a webview passing its id opens that one
    vscode.commands.registerCommand('acpira.openInEditor', (sessionId?: unknown) => {
      const initial = typeof sessionId === 'string' ? sessionId : undefined;
      const panel = vscode.window.createWebviewPanel('acpira.editor', 'Acpira', vscode.ViewColumn.Active, { retainContextWhenHidden: true });
      panel.iconPath = {
        light: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon-light.svg'),
        dark: vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg'),
      };
      const b = attach(panel.webview, 'editor', initial);
      const sub = b.viewer.subscribe(ev => { if (ev.type === 'session') panel.title = ev.session.title; });
      panel.onDidDispose(() => { sub(); bridges.delete(b); b.dispose(); });
    }),

    // Coming back from an external terminal where a CLI was installed or removed: re-check the executables right away
    vscode.window.onDidChangeWindowState(e => { if (e.focused) void manager.reprobe(); }),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('acpira.appearance')) for (const b of bridges) b.pushAppearance();
      if (e.affectsConfiguration('acpira.agents')) { activeRegistry = registry(); manager.setRegistry(activeRegistry); }
      if (e.affectsConfiguration('acpira.hiddenOptions')) manager.emitHidden();
      // Any other acpira.* knob the settings page shows (language, defaultAgent, compaction, …): re-push the view and follow a language change host-side
      if (e.affectsConfiguration('acpira') && !e.affectsConfiguration('acpira.appearance') && !e.affectsConfiguration('acpira.agents')) {
        settingsCenter.emit();
        setHostLocale(settingsCenter.locale());
      }
    }),
    { dispose: () => { manager.dispose().catch(e => log.error(`dispose failed: ${msg(e)}`)); for (const b of bridges) b.dispose(); } },
  );
}

export function deactivate() {}

// Commands run in a terminal: paths with spaces (/Applications/Devin.app/…) need quoting
function shellQuote(s: string): string {
  return /^[\w./=:@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
