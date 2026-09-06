// acquireVsCodeApi() may be called only once per webview; both roots (chat App, settings) go through this memo so a single bundle can host either
export interface VsCodeApi { postMessage(msg: unknown): void }

declare global {
  interface Window { __acpilotApi?: VsCodeApi }
  function acquireVsCodeApi(): VsCodeApi;
}

export function vscodeApi(): VsCodeApi {
  return (window.__acpilotApi ??= acquireVsCodeApi());
}

// Which root the host asked for; `window.__acpilot` is written by the bridge's HTML (host + view)
export function requestedView(): 'chat' | 'settings' {
  const v = (window as unknown as { __acpilot?: { view?: string } }).__acpilot?.view;
  return v === 'settings' ? 'settings' : 'chat';
}
