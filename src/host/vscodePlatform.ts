import { homedir } from 'node:os';
import * as vscode from 'vscode';
import type { FileHit } from '@shared/protocol';
import type { SecretVault } from './accounts/AccountStore';
import { WorkspaceFiles } from './files';
import type { HostPlatform, PlanDocumentTarget, SettingsAffects, ToastLevel } from './platform';

// The VS Code / Cursor implementation of HostPlatform: the only host-side file besides extension.ts and files.ts that imports vscode
export class VscodePlatform implements HostPlatform {
  readonly legacy: { from: string; vault: SecretVault };
  private readonly files = new WorkspaceFiles();

  constructor(private context: vscode.ExtensionContext, private output: vscode.LogOutputChannel) {
    // Each IDE's globalStorage / SecretStorage tree is merged into ~/.acpira once (dataDir.migrateOnce)
    this.legacy = {
      from: context.globalStorageUri.fsPath,
      vault: {
        get: async k => context.secrets.get(k),
        store: async (k, v) => context.secrets.store(k, v),
        delete: async k => context.secrets.delete(k),
      },
    };
  }

  private cfg() { return vscode.workspace.getConfiguration('acpira'); }

  log(line: string) { this.output.info(line); }
  hostLanguage() { return vscode.env.language; }
  home() { return homedir(); }
  cwd() { return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir(); }

  readSetting(key: string): unknown { return this.cfg().get(key); }
  writeSetting(key: string, value: unknown) { return this.cfg().update(key, value, vscode.ConfigurationTarget.Global); }

  onSettingsChanged(fn: (affects: SettingsAffects) => void) {
    const d = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('acpira')) fn(section => e.affectsConfiguration(section ? `acpira.${section}` : 'acpira'));
    });
    return () => d.dispose();
  }

  onWindowFocus(fn: () => void) {
    const d = vscode.window.onDidChangeWindowState(e => { if (e.focused) fn(); });
    return () => d.dispose();
  }

  toast(level: ToastLevel, text: string) {
    void (level === 'error' ? vscode.window.showErrorMessage(text) : vscode.window.showInformationMessage(text));
  }

  runInTerminal(title: string, command: string, args: string[], env?: Record<string, string | null>) {
    const t = vscode.window.createTerminal({ name: title, env });
    t.show();
    t.sendText([command, ...args].map(shellQuote).join(' '));
  }

  async openResolvedFile(path: string, line?: number) {
    // vscode.open uses the default editor for the resource (image preview, custom editors, text); openTextDocument rejects binaries
    // ("the file appears to be binary"). Lines arrive 1-based, Range is 0-based
    const at = line != null ? line - 1 : undefined;
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(path), {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
      ...(at != null ? { selection: new vscode.Range(at, 0, at, 0) } : {}),
    });
  }

  async openPlanDocument(target: PlanDocumentTarget) {
    const doc = 'path' in target ? await vscode.workspace.openTextDocument(vscode.Uri.file(target.path))
      : await vscode.workspace.openTextDocument({ language: 'markdown', content: target.markdown });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  }

  openExternal(url: string) { void vscode.env.openExternal(vscode.Uri.parse(url)); }

  async revealInOS(path: string) { await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(path)); }

  openInEditor(sessionId?: string) { void vscode.commands.executeCommand('acpira.openInEditor', sessionId); }

  searchFiles(query: string): Promise<FileHit[]> { return this.files.search(query); }
}

// Commands run in a terminal: paths with spaces (/Applications/Devin.app/…) need quoting
function shellQuote(s: string): string {
  return /^[\w./=:@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}
