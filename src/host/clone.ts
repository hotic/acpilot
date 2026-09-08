// VS Code's getConfiguration().get() returns a read-only Proxy that structuredClone / postMessage can't swallow; a JSON round-trip turns it into a plain object
export function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
