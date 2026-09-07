import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpSession } from '../src/host/acp/AcpSession';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { dataHome, DevinAccountProvider, readCredentials } from '../src/host/accounts/devin';

// Usage: pnpm tsx --tsconfig tsconfig.host.json scripts/probe-compaction-queue.ts <devin|grok|kimi> [--during]
// Exercise the actual host queue. Submit the next message after the compact RPC
// acknowledgement, while the asynchronous operation may still be running.
const agent = process.argv[2] ?? 'devin';
const registry = new AgentRegistry();
const cwd = await mkdtemp(join(tmpdir(), 'acpilot-queue-probe-'));
const started = Date.now();
const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ ms: Date.now() - started, event, ...fields }));
let phase = 'seed';
let promptCount = 0;
let resolveAck: () => void = () => {};
let resolveFollowUp: () => void = () => {};
const acknowledgement = new Promise<void>(resolve => { resolveAck = resolve; });
const followUpDone = new Promise<void>(resolve => { resolveFollowUp = resolve; });
const markers = new Set<string>();
const credential = agent === 'devin' ? await readCredentials(join(dataHome(), 'devin', 'credentials.toml')) : undefined;
if (agent === 'devin' && !credential) throw new Error('No local Devin login');
const provider = new DevinAccountProvider(cwd, () => registry.resolveBinary(agent));
const session = AcpSession.fresh(agent, cwd, {
  registry,
  blobs: { saveBlob: async () => { throw new Error('No attachments'); }, readBlob: async () => { throw new Error('No attachments'); } },
  accounts: credential ? { spawnEnv: async () => undefined, authenticate: async (_agent, _account, proc) => provider.authenticate(proc, credential) } : undefined,
  compaction: () => ({ auto: false, atTokens: 300_000 }),
  log: line => {
    if (line.includes('prompt done:')) {
      log('prompt_response', { phase, running: session.isRunning });
      if (phase === 'compact') resolveAck();
    }
    if (line.includes('waiting for compaction completion')) log('waiting_for_compaction');
  },
  onChange: s => {
    const v = s.view();
    const users = v.turns.filter(t => t.role === 'user');
    if (users.length > promptCount) {
      promptCount = users.length;
      log('host_dispatch', { prompt: promptCount });
    }
    // The transcript contains only synthetic prompts and status messages.
    const replies = v.turns.flatMap(t => t.role === 'agent' ? t.blocks.flatMap(b => b.type === 'text' ? [b.markdown] : []) : []).join('\n');
    for (const marker of ['SEED_OK', 'Compacting context', 'Context compaction started', 'Context compacted', 'Compaction completed', 'Compaction canceled', 'Compaction cancelled', 'FOLLOWUP_OK']) {
      if (replies.includes(marker) && !markers.has(marker)) { markers.add(marker); log('text_marker', { marker }); }
    }
    if (promptCount >= 3 && !v.running) resolveFollowUp();
  },
}, credential ? 'probe-local' : undefined);
const watchdog = setTimeout(() => { log('timeout', { phase }); session.dispose(); process.exit(2); }, 120_000);
try {
  await session.start();
  log('session_started', { status: session.view().status, runtime: session.runtimeInfo() });
  if (session.view().status !== 'ready') throw new Error('Agent session is not ready');
  const facts = Array.from({ length: 160 }, (_, i) => `Synthetic record ${i}: item-${i} has value ${i * 7} and category ${i % 9}.`).join('\n');
  await session.prompt(`Retain these synthetic records for later. Do not use any tools. Reply only SEED_OK.\n${facts}`);
  if (!markers.has('SEED_OK')) throw new Error('Seed prompt did not produce its marker');
  phase = 'compact';
  const compact = session.compact();
  // --during probes peers such as Grok whose acknowledgement waits for the job.
  // This delay belongs only to the diagnostic sender, never the host queue.
  if (process.argv.includes('--during')) await new Promise(resolve => setTimeout(resolve, 500));
  else await acknowledgement;
  phase = 'follow_up';
  const next = session.prompt('Do not use tools. Reply only FOLLOWUP_OK.');
  log('follow_up_submitted', { queued: !!session.view().queued, running: session.isRunning, promptCount });
  await next;
  await compact;
  await followUpDone;
  const passed = markers.has('FOLLOWUP_OK') && !markers.has('Compaction canceled') && !markers.has('Compaction cancelled');
  log('result', { passed, promptCount, running: session.isRunning, queued: !!session.view().queued, markers: [...markers] });
  if (!passed) process.exitCode = 1;
} catch (error) {
  log('error', { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  session.dispose();
}
