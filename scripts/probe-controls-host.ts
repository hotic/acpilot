import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AcpSession } from '../src/host/acp/AcpSession';

// Exercise the production host and the exact state consumed by Composer.
// Optional argument: write the sanitized state to a JSON file for visual QA.
const cwd = await mkdtemp(join(tmpdir(), 'acpira-controls-host-'));
const s = AcpSession.fresh('grok', cwd, {
  registry: new AgentRegistry(), log: () => {}, onChange: () => {},
  compaction: () => ({ auto: false, atTokens: 300000 }),
  blobs: { saveBlob: async () => { throw new Error('No attachments expected'); }, readBlob: async () => new Uint8Array() },
});
const deadline = setTimeout(() => { s.dispose(); process.exitCode = 1; }, 90_000);
try {
  await s.start();
  assert.equal(s.view().status, 'ready');
  await s.setConfig('model', 'asgard');
  assert.equal(s.view().controls.options.find(c => c.id === 'model')?.value, 'asgard');
  assert.equal(s.view().usage?.size, 250000);
  const control = () => s.view().controls.options.find(c => c.id === 'reasoning_effort');
  assert.deepEqual(control()?.options.map(o => o.id), ['xhigh', 'high', 'medium', 'low']);
  for (const effort of ['low', 'medium', 'high', 'xhigh']) {
    await s.setConfig('reasoning_effort', effort);
    assert.equal(control()?.value, effort);
    assert.equal(s.view().controls.options.find(c => c.id === 'model')?.value, 'asgard');
    console.log(`effort=${effort}: accepted; model=asgard`);
  }
  await s.prompt('Reply with exactly HOST_CONTROLS_OK. Do not call tools.');
  const view = s.view();
  const last = view.turns.at(-1);
  assert.equal(last?.role, 'agent');
  assert(last?.role === 'agent' && last.stop === 'end_turn');
  assert(last.blocks.some(b => b.type === 'text' && b.markdown.includes('HOST_CONTROLS_OK')));
  assert(view.usage && view.usage.used > 0 && view.usage.size === 250000);
  const snapshot = { controls: view.controls, usage: view.usage, turns: view.turns };
  console.log(JSON.stringify(snapshot));
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(snapshot, null, 2));
} finally { clearTimeout(deadline); s.dispose(); }
