// Probe for resume-type issues: initialize → account-layer authenticate → session/list (+ optional session/load)
// Usage: pnpm tsx scripts/probe-load.ts [sessionId] [cwd]
// Without sessionId it only lists sessions; with one it also tries a load to see whether the other side still recognizes it
import { AgentProcess } from '../src/host/acp/AgentProcess';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { DevinAccountProvider } from '../src/host/accounts/devin';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const agent = 'devin';
const sessionId = process.argv[2];
const cwd = process.argv[3] ?? process.cwd();

const registry = new AgentRegistry();
const bin = await registry.resolveBinary(agent);
if (!bin) throw new Error('devin binary not found');

const proc = await AgentProcess.spawn(registry.get(agent), bin, cwd, {
  onUpdate: () => {},
  onPermission: () => Promise.resolve({ outcome: { outcome: 'cancelled' } }),
  onStderr: line => { if (!/INFO|close time/.test(line)) console.error('stderr', line); },
  onExit: (c, s) => console.log('exit', c, s),
});

const p = new DevinAccountProvider(await mkdtemp(join(tmpdir(), 'acpilot-probe-')), async () => bin!);
const draft = await p.importLocal();
if (!draft) throw new Error('no local devin login (credentials.toml missing)');
await p.authenticate!(proc, draft);
console.log('authenticate ok');

try {
  const l = await proc.agent.request('session/list', { cwd });
  console.log('session/list:', JSON.stringify(l).slice(0, 2000));
} catch (e: any) {
  console.log('session/list failed:', e?.code, e?.message);
}

if (sessionId) {
  try {
    const r = await proc.agent.request('session/load', { sessionId, cwd, mcpServers: [] });
    console.log('session/load ok:', JSON.stringify(r));
  } catch (e: any) {
    console.log('session/load failed:', e?.code, e?.message, e?.data ?? '');
  }
}
proc.kill();
