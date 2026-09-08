import { randomBytes } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vscode from 'vscode';
import { isSafeExternalUrl, type FileHit, type HostMsg, type WebviewHost, type WebviewMsg } from '@shared/protocol';
import type { Appearance } from '@shared/appearance';
import type { SessionManager, SessionViewer } from './SessionManager';
import type { SettingsCenter } from './settings';
import type { WorkspaceFiles } from './files';
import { msg } from './errors';

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

// Manager events within this window collapse to one post per message type
const BATCH_WINDOW_MS = 30;

// One bridge per webview: renders the HTML, hands incoming WebviewMsg to its viewer / the manager, and pushes their changes back after coalescing.
// The viewer is this webview's own active session; `initial` is where it opens (a session id, the most recent session, or nothing → a fresh session)
export class WebviewBridge implements vscode.Disposable {
  readonly viewer: SessionViewer;
  private disposables: vscode.Disposable[] = [];
  private pending = new Map<string, HostMsg>();
  private timer?: NodeJS.Timeout;
  private ready = false;

  constructor(
    private webview: vscode.Webview,
    private host: WebviewHost,
    private manager: SessionManager,
    private env: BridgeEnv,
    initial?: string | { mostRecent: true },
  ) {
    this.viewer = manager.attach(initial);
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(env.extensionUri, 'dist', 'webview'), vscode.Uri.file(env.sessionsDir)] };
    webview.html = this.html();
    this.disposables.push(
      webview.onDidReceiveMessage((m: WebviewMsg) => { this.onMessage(m).catch(e => env.log(`webview ${m.type} failed: ${msg(e)}`)); }),
      { dispose: this.viewer.subscribe(ev => this.queue(ev)) },
      { dispose: env.settings.subscribe(ev => this.queue(ev)) },
    );
  }

  private async onMessage(m: WebviewMsg) {
    if (m.type === 'ready') {
      this.ready = true;
      await this.viewer.ensureActive();
      this.post({
        type: 'init',
        state: {
          host: this.host, appearance: this.env.appearance(), agents: this.manager.agents(), accounts: this.manager.accounts(), accountActions: this.manager.accountActions(), hidden: this.manager.hidden(),
          sessions: this.manager.sessions(), active: this.viewer.active(), blobBase: this.webview.asWebviewUri(vscode.Uri.file(this.env.sessionsDir)).toString(),
          settings: this.env.settings.view(), locale: this.env.settings.locale(), home: this.env.home(), cwd: this.env.cwd(),
        },
      });
      return;
    }
    if (m.type === 'openInEditor') { void vscode.commands.executeCommand('acpira.openInEditor', m.sessionId ?? this.viewer.activeId); return; }
    if (m.type === 'openFile') {
      const session = this.viewer.active();
      if (!session || session.id !== m.sessionId) return;
      try {
        const path = m.path.startsWith('file://') ? fileURLToPath(m.path) : resolve(session.cwd, m.path);
        const uri = vscode.Uri.file(path);
        const line = Number.isSafeInteger(m.line) && m.line! > 0 ? m.line! - 1 : undefined;
        // vscode.open uses the default editor for the resource (image preview, custom editors, text).
        // openTextDocument rejects binaries ("the file appears to be binary").
        await vscode.commands.executeCommand('vscode.open', uri, {
          preview: true,
          viewColumn: vscode.ViewColumn.Beside,
          ...(line != null ? { selection: new vscode.Range(line, 0, line, 0) } : {}),
        });
      } catch (e) {
        void vscode.window.showErrorMessage(msg(e));
      }
      return;
    }
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
      try { files = await this.env.files.search(m.query); } catch (e) { this.env.log(`searchFiles failed: ${msg(e)}`); }
      this.post({ type: 'files', seq: m.seq, files });
      return;
    }
    if (m.type === 'editTurn') {
      try {
        await this.manager.editTurn(m.edit);
        this.post({ type: 'editTurnResult', requestId: m.requestId });
      } catch (e) {
        this.post({ type: 'editTurnResult', requestId: m.requestId, error: msg(e) });
      }
      return;
    }
    if (await this.onSettingsMessage(m)) return;
    await this.viewer.handle(m);
  }

  // The settings page's requests; returns true when the message was its business
  private async onSettingsMessage(m: WebviewMsg): Promise<boolean> {
    try {
      switch (m.type) {
        case 'setSetting': await this.env.settings.set(m.key, m.value); return true;
        case 'openPath': await openPath(m.path); return true;
        case 'inventory': this.post({ type: 'inventory', agent: m.agent, inventory: await this.env.settings.inventory(m.agent) }); return true;
        case 'controls': this.post({ type: 'controls', agent: m.agent, controls: await this.manager.knownControls(m.agent) }); return true;
        default: return false;
      }
    } catch (e) {
      this.env.log(`settings ${m.type} failed: ${msg(e)}`);
      return true;
    }
  }

  // Streaming updates are dense; for the same message type within one batch window, keep only the latest
  private queue(m: HostMsg) {
    if (!this.ready) return;
    this.pending.set(m.type, m);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      for (const queued of this.pending.values()) this.post(queued);
      this.pending.clear();
    }, BATCH_WINDOW_MS);
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
<html lang="${this.env.settings.locale()}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
<style>html,body,#root{margin:0;padding:0;height:100%;overflow:hidden}.acp-shell :focus,.acp-shell :focus-visible{outline:none!important}</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}">window.__acpira={host:${JSON.stringify(this.host)}}</script>
<script type="module" nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }

  dispose() {
    clearTimeout(this.timer);
    for (const d of this.disposables) d.dispose();
    this.viewer.dispose();
  }
}

// A path from the inventory lists: files open in the editor, directories reveal in the OS file manager
async function openPath(path: string): Promise<void> {
  const uri = vscode.Uri.file(path);
  const s = await stat(path).catch(() => undefined);
  if (s?.isDirectory()) await vscode.commands.executeCommand('revealFileInOS', uri);
  else await vscode.commands.executeCommand('vscode.open', uri);
}
