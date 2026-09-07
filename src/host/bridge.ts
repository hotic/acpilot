import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import * as vscode from 'vscode';
import { isSafeExternalUrl, type FileHit, type HostMsg, type WebviewHost, type WebviewMsg } from '@shared/protocol';
import type { Appearance } from '@shared/appearance';
import type { SessionManager } from './SessionManager';
import type { SettingsCenter } from './settings';
import type { WorkspaceFiles } from './files';

export interface BridgeEnv {
  extensionUri: vscode.Uri;
  appearance: () => Appearance;
  // The sessions directory: attachment blobs live in it and are served to the webview from there
  sessionsDir: string;
  files: WorkspaceFiles;
  settings: SettingsCenter;
  // Home / workspace root, for shortening paths in the settings page's inventory lists
  home: () => string;
  cwd: () => string;
  log: (line: string) => void;
}

// One bridge per webview: renders the HTML, hands incoming WebviewMsg to the manager, and pushes the manager's changes back after coalescing
export class WebviewBridge implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private pending = new Map<string, HostMsg>();
  private timer?: NodeJS.Timeout;
  private ready = false;

  constructor(
    private webview: vscode.Webview,
    private host: WebviewHost,
    private manager: SessionManager,
    private env: BridgeEnv,
  ) {
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(env.extensionUri, 'dist', 'webview'), vscode.Uri.file(env.sessionsDir)] };
    webview.html = this.html();
    this.disposables.push(
      webview.onDidReceiveMessage((m: WebviewMsg) => this.onMessage(m)),
      { dispose: manager.subscribe(ev => this.queue(ev)) },
      { dispose: env.settings.subscribe(ev => this.queue(ev)) },
    );
  }

  private async onMessage(m: WebviewMsg) {
    if (m.type === 'ready') {
      this.ready = true;
      await this.manager.ensureActive();
      this.post({
        type: 'init',
        state: {
          host: this.host, appearance: this.env.appearance(), agents: this.manager.agents(), accounts: this.manager.accounts(), accountActions: this.manager.accountActions(), hidden: this.manager.hidden(),
          sessions: this.manager.sessions(), active: this.manager.active(), blobBase: this.webview.asWebviewUri(vscode.Uri.file(this.env.sessionsDir)).toString(),
          settings: this.env.settings.view(), locale: this.env.settings.locale(), home: this.env.home(), cwd: this.env.cwd(),
        },
      });
      return;
    }
    if (m.type === 'openInEditor') { void vscode.commands.executeCommand('acpilot.openInEditor'); return; }
    if (m.type === 'openPlan') {
      const plan = this.manager.planDocument(m.sessionId, m.planId);
      if (plan?.type === 'plan_document') {
        const exists = plan.path && await stat(plan.path).catch(() => undefined);
        const doc = exists && plan.path ? await vscode.workspace.openTextDocument(vscode.Uri.file(plan.path))
          : await vscode.workspace.openTextDocument({ language: 'markdown', content: plan.markdown });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      }
      return;
    }
    if (m.type === 'openExternal') {
      if (isSafeExternalUrl(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url));
      else this.env.log(`openExternal refused: scheme not on the allowlist (${m.url.slice(0, 80)})`);
      return;
    }
    if (m.type === 'searchFiles') {
      // Always answer, even on failure: the webview holds a promise per seq
      let files: FileHit[] = [];
      try { files = await this.env.files.search(m.query); } catch (e) { this.env.log(`searchFiles failed: ${e instanceof Error ? e.message : String(e)}`); }
      this.post({ type: 'files', seq: m.seq, files });
      return;
    }
    if (await this.onSettingsMessage(m)) return;
    await this.manager.handle(m);
  }

  // The settings page's requests; returns true when the message was its business
  private async onSettingsMessage(m: WebviewMsg): Promise<boolean> {
    try {
      switch (m.type) {
        case 'setSetting': await this.env.settings.set(m.key, m.value); return true;
        case 'openPath': await openPath(m.path); return true;
        case 'openSettingsJson':
          await vscode.commands.executeCommand(m.key ? 'workbench.action.openSettings' : 'workbench.action.openSettingsJson', ...(m.key ? [m.key] : []));
          return true;
        case 'inventory': this.post({ type: 'inventory', agent: m.agent, inventory: await this.env.settings.inventory(m.agent) }); return true;
        case 'controls': this.post({ type: 'controls', agent: m.agent, controls: await this.manager.knownControls(m.agent) }); return true;
        default: return false;
      }
    } catch (e) {
      this.env.log(`settings ${m.type} failed: ${e instanceof Error ? e.message : String(e)}`);
      return true;
    }
  }

  // Streaming updates are dense; for the same message type within 30ms, keep only the latest
  private queue(msg: HostMsg) {
    if (!this.ready) return;
    this.pending.set(msg.type, msg);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      for (const m of this.pending.values()) this.post(m);
      this.pending.clear();
    }, 30);
  }

  post(msg: HostMsg) { void this.webview.postMessage(msg); }

  pushAppearance() { this.post({ type: 'appearance', appearance: this.env.appearance() }); }

  private html(): string {
    const dist = vscode.Uri.joinPath(this.env.extensionUri, 'dist', 'webview');
    const js = this.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.js'));
    const css = this.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.css'));
    const nonce = randomBytes(16).toString('base64url');
    const csp = [
      "default-src 'none'",
      `img-src ${this.webview.cspSource} https: data:`,
      `style-src ${this.webview.cspSource} 'unsafe-inline'`,
      `font-src ${this.webview.cspSource}`,
      `script-src 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    ].join('; ');
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
<style>html,body,#root{margin:0;padding:0;height:100%;overflow:hidden}.acp-shell :focus,.acp-shell :focus-visible{outline:none!important}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__acpilot={host:${JSON.stringify(this.host)}}</script>
<script type="module" nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }

  dispose() {
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
  }
}

// A path from the inventory lists: files open in the editor, directories reveal in the OS file manager
async function openPath(path: string): Promise<void> {
  const uri = vscode.Uri.file(path);
  const s = await stat(path).catch(() => undefined);
  if (s?.isDirectory()) await vscode.commands.executeCommand('revealFileInOS', uri);
  else await vscode.commands.executeCommand('vscode.open', uri);
}
