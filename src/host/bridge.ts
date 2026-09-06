import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { FileHit, HostMsg, WebviewHost, WebviewMsg } from '@shared/protocol';
import type { Appearance } from '@shared/appearance';
import type { SessionManager } from './SessionManager';
import type { WorkspaceFiles } from './files';

export interface BridgeEnv {
  extensionUri: vscode.Uri;
  appearance: () => Appearance;
  // The sessions directory: attachment blobs live in it and are served to the webview from there
  sessionsDir: string;
  files: WorkspaceFiles;
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
    );
  }

  private async onMessage(m: WebviewMsg) {
    if (m.type === 'ready') {
      this.ready = true;
      await this.manager.ensureActive();
      this.post({
        type: 'init',
        state: {
          host: this.host, appearance: this.env.appearance(), agents: this.manager.agents(), accounts: this.manager.accounts(), hidden: this.manager.hidden(),
          sessions: this.manager.sessions(), active: this.manager.active(), blobBase: this.webview.asWebviewUri(vscode.Uri.file(this.env.sessionsDir)).toString(),
        },
      });
      return;
    }
    if (m.type === 'openInEditor') { void vscode.commands.executeCommand('acpilot.openInEditor'); return; }
    if (m.type === 'searchFiles') {
      // Always answer, even on failure: the webview holds a promise per seq
      let files: FileHit[] = [];
      try { files = await this.env.files.search(m.query); } catch (e) { this.env.log(`searchFiles 失败：${e instanceof Error ? e.message : String(e)}`); }
      this.post({ type: 'files', seq: m.seq, files });
      return;
    }
    await this.manager.handle(m);
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
