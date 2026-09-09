import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';

// A fresh directory with an optional executable, so a CLI can be "installed" and "removed" under the registry's nose
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'acpira-reg-'));
  const bin = join(dir, 'ghost-cli');
  const install = () => { writeFileSync(bin, '#!/bin/sh\nexit 0\n'); chmodSync(bin, 0o755); };
  const remove = () => rmSync(bin, { force: true });
  return { dir, bin, install, remove };
}

describe('AgentRegistry', () => {
  it('probeAll reports whether the available set changed and notifies subscribers; an executable appearing later is picked up without a new registry', async () => {
    const { bin, install } = sandbox();
    const r = new AgentRegistry({ ghost: { name: 'Ghost', command: bin } });
    let notified = 0;
    r.subscribe(() => notified++);
    expect(r.list().find(a => a.id === 'ghost')?.available).toBeUndefined();
    expect(await r.probeAll()).toBe(false);
    expect(r.list().find(a => a.id === 'ghost')?.available).toBe(false);
    expect(r.missing()).toBe(true);
    expect(notified).toBe(0);

    install();
    expect(await r.probeAll()).toBe(true);
    expect(notified).toBe(1);
    expect(r.list().find(a => a.id === 'ghost')?.available).toBe(true);
    // Nothing changed: no second notification
    expect(await r.probeAll()).toBe(false);
    expect(notified).toBe(1);
  });

  it('a cached path is re-verified: removing the binary flips the agent back to unavailable', async () => {
    const { bin, install, remove } = sandbox();
    install();
    const r = new AgentRegistry({ ghost: { name: 'Ghost', command: bin } });
    await r.probeAll();
    expect(await r.resolveBinary('ghost')).toBe(bin);
    remove();
    let notified = 0;
    r.subscribe(() => notified++);
    expect(await r.resolveBinary('ghost')).toBeNull();
    expect(notified).toBe(1);
    expect(r.list().find(a => a.id === 'ghost')?.available).toBe(false);
  });

  it('a single resolveBinary that finds a freshly installed CLI notifies like a probe pass (the settings-page rescan path)', async () => {
    const { bin, install } = sandbox();
    const r = new AgentRegistry({ ghost: { name: 'Ghost', command: bin } });
    await r.probeAll();
    let notified = 0;
    r.subscribe(() => notified++);
    install();
    expect(await r.resolveBinary('ghost')).toBe(bin);
    expect(notified).toBe(1);
    expect(r.missing()).toBe(false);
  });

  it('install info follows the platform: POSIX line on darwin / linux, PowerShell line on win32, docs everywhere', () => {
    const posix = new AgentRegistry({}, 'darwin');
    const win = new AgentRegistry({}, 'win32');
    expect(posix.install('grok')).toEqual({ command: 'curl -fsSL https://x.ai/cli/install.sh | bash', docs: 'https://docs.x.ai/build/overview' });
    expect(win.install('grok')).toEqual({ command: 'irm https://x.ai/cli/install.ps1 | iex', docs: 'https://docs.x.ai/build/overview' });
    expect(posix.list().find(a => a.id === 'kimi')?.install?.command).toContain('code.kimi.com');
  });

  it('custom agents: an install line applies to every platform, docs alone is enough, nothing declared means no install info', () => {
    const r = new AgentRegistry({
      a: { command: '/x/a', install: { command: 'brew install a' } },
      b: { command: '/x/b', install: { docs: 'https://example.com/b' } },
      c: { command: '/x/c' },
    }, 'win32');
    expect(r.install('a')).toEqual({ command: 'brew install a' });
    expect(r.install('b')).toEqual({ docs: 'https://example.com/b' });
    expect(r.install('c')).toBeUndefined();
    expect(r.list().find(a => a.id === 'c')).not.toHaveProperty('install');
  });
});
