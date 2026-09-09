// acquireVsCodeApi() may be called only once per webview; both roots (chat App, settings) go through this memo so a single bundle can host either.
// getState / setState are the webview's own persisted state (survives a reload of the same webview); LAB stubs may omit them
export interface VsCodeApi { postMessage(msg: unknown): void; getState?(): unknown; setState?(state: unknown): void }

declare global {
  interface Window { __acpiraApi?: VsCodeApi }
  function acquireVsCodeApi(): VsCodeApi;
}

// Reached through globalThis (the window in a webview) so modules that only need the memo can also be type-checked and unit-tested without the DOM lib
const scope = globalThis as typeof globalThis & { __acpiraApi?: VsCodeApi };

export function vscodeApi(): VsCodeApi {
  return (scope.__acpiraApi ??= acquireVsCodeApi());
}
