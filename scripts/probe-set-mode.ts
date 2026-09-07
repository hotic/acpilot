import * as acp from '@agentclientprotocol/sdk';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AgentProcess } from '../src/host/acp/AgentProcess';

// One-shot probe: send session/set_mode("plan") right after session/new to see whether the local Grok CLI accepts it
const registry = new AgentRegistry();
const def = registry.get('grok');
const bin = await registry.resolveBinary('grok');
if (!bin) { console.error('grok not found'); process.exit(1); }

const proc = await AgentProcess.spawn(def, bin, process.cwd(), {
  onUpdate: n => console.log(`[${n.update.sessionUpdate}]`, JSON.stringify(n.update).slice(0, 300)),
  onPermission: async req => ({ outcome: { outcome: 'selected' as const, optionId: req.options[0]!.optionId } }),
  onStderr: line => console.error(`stderr ${line}`),
  onExit: (code, signal) => console.error(`exit code=${code} signal=${signal}`),
});

const session = await proc.agent.request(acp.methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] });
console.log('session/new ok →', session.sessionId);

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
for (const modeId of ['yolo', 'plan', 'yolo', 'default']) {
  await sleep(1200);
  try {
    const r = await proc.agent.request('session/set_mode' as any, { sessionId: session.sessionId, modeId } as any);
    console.log(`set_mode(${modeId}) →`, JSON.stringify(r));
  } catch (e) {
    console.log(`set_mode(${modeId}) ✗`, e instanceof Error ? e.message : e);
  }
}
await sleep(600);

proc.kill();
process.exit(0);
