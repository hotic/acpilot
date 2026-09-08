import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AgentProcess } from '../src/host/acp/AgentProcess';
import { DevinAccountProvider } from '../src/host/accounts/devin';

// Usage: pnpm tsx scripts/probe-steer.ts <agent> [--import-local] [--delay MS]
// Answers "what happens when a second session/prompt is sent while the first is still running?" for a given agent:
//   rejected  → the agent refuses concurrent prompts (queueing has to be client-side)
//   queued    → the second prompt is accepted but only answered after the first turn ends (agent-side queue)
//   steered   → the first turn is cut short / redirected and the second prompt's answer shows up right away (Claude Code style steering)
// The first prompt is a long tool-free streaming task; the second asks for a single marker word so the two outputs can't be confused
const argv = process.argv.slice(2);
const importLocal = argv.includes('--import-local');
const delayIdx = argv.indexOf('--delay');
const delayMs = delayIdx >= 0 ? Number(argv[delayIdx + 1]) : 2500;
const agentId = argv.find(a => !a.startsWith('--') && a !== String(delayMs)) ?? 'grok';

const registry = new AgentRegistry();
const def = registry.get(agentId);
const bin = await registry.resolveBinary(agentId);
if (!bin) { console.error(`command not found: ${def.command}`); process.exit(1); }
console.log(`→ ${bin} ${def.args.join(' ')}`);

const t0 = Date.now();
const stamp = () => `+${String(Date.now() - t0).padStart(5)}ms`;
let chunks = 0;
let firstChunkAt: number | undefined;
let lastChunkAt: number | undefined;
const seenMarker: number[] = [];
// Everything the agent said, in order, so the marker word can be found even when it streams in fragments
let said = '';

const proc = await AgentProcess.spawn(def, bin, process.cwd(), {
  onUpdate: n => {
    const u = n.update;
    if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') {
      chunks++;
      firstChunkAt ??= Date.now();
      lastChunkAt = Date.now();
      said += u.content.text;
      if (said.endsWith('STEERED') || (u.content.text.includes('STEERED'))) seenMarker.push(Date.now() - t0);
      process.stdout.write(u.content.text);
    } else if (u.sessionUpdate === 'agent_thought_chunk' && u.content.type === 'text') {
      process.stdout.write(`\x1b[2m${u.content.text}\x1b[0m`);
    } else if (u.sessionUpdate === 'user_message_chunk') {
      console.log(`\n${stamp()} [user_message_chunk echoed] ${JSON.stringify(u.content).slice(0, 120)}`);
    } else if (u.sessionUpdate !== 'available_commands_update' && u.sessionUpdate !== 'usage_update') {
      console.log(`\n${stamp()} [${u.sessionUpdate}] ${JSON.stringify(u).slice(0, 300)}`);
    }
  },
  onPermission: async req => {
    const allow = req.options.find(o => o.kind === 'allow_once') ?? req.options[0]!;
    return { outcome: { outcome: 'selected', optionId: allow.optionId } };
  },
  onStderr: line => console.error(`\x1b[33mstderr\x1b[0m ${line}`),
  onExit: (code, signal) => console.error(`exit code=${code} signal=${signal}`),
});

console.log('initialize → agentCapabilities', JSON.stringify(proc.init.agentCapabilities), '_meta', JSON.stringify(proc.init._meta ?? null));

if (importLocal) {
  const p = new DevinAccountProvider(await mkdtemp(join(tmpdir(), 'acpira-probe-')), async () => bin);
  const draft = await p.importLocal();
  if (!draft) { console.error('no local login for this CLI'); process.exit(1); }
  await p.authenticate!(proc, draft);
  console.log(`authenticate ok（${draft.label}）`);
}

const s = await proc.agent.request(acp.methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] });
console.log(`session/new → ${s.sessionId}`);

// --tools: make A a multi-step tool task (many model calls) instead of one long streamed reply — a steered prompt can only be picked up at the next model call
const tools = argv.includes('--tools');
const first = tools
  ? 'Run these shell commands one at a time, in separate steps, and after EACH command write one sentence about its output before running the next: `ls`, `ls src`, `ls src/host`, `ls src/webview`, `ls src/shared`, `ls test`, `ls scripts`, `ls docs`. Do not batch them. Do not skip any.'
  : 'Count from 1 to 60. Write one number per line, and after each number write one full sentence about that number. Do not use any tools. Do not stop early.';
const second = 'STOP immediately, do not run anything else. Reply with exactly the single word: STEERED';

console.log(`\n${stamp()} prompt A →`);
const a = proc.agent.request(acp.methods.agent.session.prompt, { sessionId: s.sessionId, prompt: [{ type: 'text', text: first }] })
  .then(r => ({ ok: true as const, stop: r.stopReason, at: Date.now() - t0 }), e => ({ ok: false as const, err: e, at: Date.now() - t0 }));

await new Promise(r => setTimeout(r, delayMs));
const sentBAt = Date.now() - t0;
console.log(`\n${stamp()} prompt B → (${chunks} chunks of A streamed so far)`);
const b = proc.agent.request(acp.methods.agent.session.prompt, { sessionId: s.sessionId, prompt: [{ type: 'text', text: second }] })
  .then(r => ({ ok: true as const, stop: r.stopReason, at: Date.now() - t0 }), e => ({ ok: false as const, err: e, at: Date.now() - t0 }));

const [ra, rb] = await Promise.all([a, b]);
const fmt = (r: typeof ra) => (r.ok ? `ok stop=${r.stop} at +${r.at}ms` : `ERROR at +${r.at}ms: ${r.err instanceof acp.RequestError ? `${r.err.code} ${r.err.message} ${JSON.stringify(r.err.data)}` : String(r.err)}`);
console.log('\n\n──────── result ────────');
console.log(`A: ${fmt(ra)}`);
console.log(`B: ${fmt(rb)} (sent at +${sentBAt}ms)`);
console.log(`chunks total ${chunks}, first +${(firstChunkAt ?? t0) - t0}ms, last +${(lastChunkAt ?? t0) - t0}ms, STEERED seen at ${seenMarker.map(x => `+${x}ms`).join(', ') || 'never'}`);
console.log(`agent text (last 400 chars): ${JSON.stringify(said.slice(-400))}`);

let verdict: string;
if (!rb.ok) verdict = 'rejected — agent refuses a concurrent prompt; queueing must be client-side';
else if (ra.ok && rb.at < ra.at) verdict = 'concurrent/steered — B answered before A finished';
else if (ra.ok && ra.at - sentBAt < 2000 && ra.stop !== 'end_turn') verdict = 'steered — A was cut short right after B arrived';
else if (seenMarker.length && ra.ok && ra.at < seenMarker[0]!) verdict = 'queued — B was answered only after A ended';
else verdict = 'ambiguous — read the timeline above';
console.log(`verdict: ${verdict}`);

proc.kill();
process.exit(0);
