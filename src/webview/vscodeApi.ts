// acquireVsCodeApi() may be called only once per webview; both roots (chat App, settings) go through this memo so a single bundle can host either
export interface VsCodeApi { postMessage(msg: unknown): void }

declare global {
  interface Window { __acpiraApi?: VsCodeApi }
  function acquireVsCodeApi(): VsCodeApi;
}

export function vscodeApi(): VsCodeApi {
  return (window.__acpiraApi ??= acquireVsCodeApi());
}
