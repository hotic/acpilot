import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpSession, type SessionDeps } from '../src/host/acp/AcpSession';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { DevinAccountProvider } from '../src/host/accounts/devin';
import { captureTurnSettings } from '../src/shared/turnSettings';
import { groupModels } from '../src/shared/models';

// pnpm exec tsx --tsconfig tsconfig.host.json scripts/probe-edit-turn.ts grok|devin|kimi [--plan]
// Exercises the production session class in an isolated directory. Local Devin
// credentials remain in memory; output includes only selections and probe replies.
const agent = process.argv[2] ?? 'grok';
const cwd = await mkdtemp(join(tmpdir(), `acpilot-edit-${agent}-`));
const registry = new AgentRegistry();
const binary = await registry.resolveBinary(agent);
if (!binary) throw new Error(`CLI unavailable: ${agent}`);
const deps: SessionDeps = {
  registry, log: () => {}, onChange: s => {
    // This probe requests text only. Decline unexpected permission requests.
    for (const turn of s.view().turns) if (turn.role === 'agent') for (const b of turn.blocks) {
      if (b.type !== 'permission') continue;
      const option = b.options.find(o => o.kind === 'reject_once');
      if (option) s.resolvePermission(b.id, option.id);
    }
  },
  blobs: {
    saveBlob: async (_sid, ext, bytes) => { const name = randomUUID() + ext; const path = join(cwd, name); await writeFile(path, bytes); return { name, path }; },
    readBlob: async (_sid, name) => readFile(join(cwd, name)),
  },
};
if (agent === 'devin') {
  const provider = new DevinAccountProvider(cwd, async () => binary);
  const credential = await provider.importLocal();
  if (!credential) throw new Error('Local Devin login unavailable');
  deps.accounts = { spawnEnv: async () => undefined, authenticate: async (_agent, _account, proc) => provider.authenticate!(proc, credential) };
}
const s = AcpSession.fresh(agent, cwd, deps, agent === 'devin' ? 'probe-local' : undefined);
const timeout = setTimeout(() => { console.error(JSON.stringify({ agent, error: 'probe timeout' })); s.dispose(); process.exit(1); }, 180_000);
try {
  await s.start();
  if (s.view().status !== 'ready') throw new Error(`Session status: ${s.view().status}`);
  console.log(JSON.stringify({ agent, phase: 'ready', runtime: s.runtimeInfo(), settings: captureTurnSettings(s.view().controls) }));
  const retained = `KEEP_${randomUUID().slice(0, 8)}`;
  const removed = `DROP_${randomUUID().slice(0, 8)}`;
  await s.prompt(`This is a text-only protocol test. Do not use any tools or touch files. Remember the retained code ${retained}. Reply only OK.`);
  await s.prompt(`Text-only test, no tools. Remember the discarded code ${removed}. Reply only OK.`);
  const before = s.toRecord().acpSessionId;
  const turn = s.view().turns[2];
  if (turn?.role !== 'user') throw new Error('Missing second user turn');
  const settings = captureTurnSettings(s.view().controls);
  for (const control of s.view().controls.options) {
    if (control.category === 'thought_level') {
      const next = control.options.find(o => o.id !== control.value);
      if (next) settings.config[control.id] = next.id;
    } else if (control.category === 'model') {
      const family = groupModels(control.options).find(f => f.variants.some(v => v.id === control.value));
      const current = family?.variants.find(v => v.id === control.value);
      const next = family?.variants.find(v => v.effort !== current?.effort && v.fast === current?.fast && v.long === current?.long);
      if (next) settings.config[control.id] = next.id;
    }
  }
  if (process.argv.includes('--plan')) {
    const plan = s.view().controls.modes.find(m => m.id === 'plan');
    if (!plan) throw new Error('Plan mode unavailable');
    settings.modeId = plan.id;
  }
  await s.editTurn({ sessionId: s.id, turnIndex: 2, turnCount: s.view().turns.length, turnId: turn.id, originalText: turn.text,
    text: 'Text-only test. Do not use any tools. What retained code was given in the earlier conversation? Was any discarded code provided before this message? Reply as CODE|yes or CODE|no, using the actual retained code.',
    retainedAttachments: [], attachments: [], settings });
  while (s.isRunning) await new Promise(r => setTimeout(r, 50));
  const last = s.view().turns.at(-1);
  const reply = last?.role === 'agent' ? last.blocks.filter(b => b.type === 'text').map(b => b.markdown).join('') : '';
  const result = { agent, freshPeer: s.toRecord().acpSessionId !== before, turns: s.view().turns.length,
    settings: captureTurnSettings(s.view().controls), stop: last?.role === 'agent' ? last.stop : undefined, reply,
    retainedContext: reply.includes(retained), removedFuture: !reply.includes(removed) && /\|\s*no/i.test(reply) };
  console.log(JSON.stringify(result));
  if (!result.freshPeer || result.turns !== 4 || result.stop !== 'end_turn' || !result.retainedContext || !result.removedFuture) process.exitCode = 1;
} finally { clearTimeout(timeout); s.dispose(); }
