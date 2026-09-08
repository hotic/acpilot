import * as acp from '@agentclientprotocol/sdk';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AgentProcess } from '../src/host/acp/AgentProcess';

// pnpm exec tsx --tsconfig tsconfig.host.json scripts/probe-controls.ts grok asgard xhigh --prompt
// Inspect the wire in a disposable workspace. No tool permissions are granted.
const [agentId = 'grok', model, effort] = process.argv.slice(2).filter(x => !x.startsWith('--'));
const registry = new AgentRegistry();
const binary = await registry.resolveBinary(agentId);
if (!binary) throw new Error(`Missing CLI: ${agentId}`);
const cwd = await mkdtemp(join(tmpdir(), 'acpilot-controls-'));
const print = (label: string, value: unknown) => console.log(label, JSON.stringify(value));
let gotUsage: (() => void) | undefined;
const usage = new Promise<void>(resolve => { gotUsage = resolve; });
const proc = await AgentProcess.spawn(registry.get(agentId), binary, cwd, {
  onUpdate: ({ update }) => {
    if (update.sessionUpdate === 'usage_update') gotUsage?.();
    if (['config_option_update', 'usage_update'].includes(update.sessionUpdate)) print('update', update);
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') print('text', update.content.text);
  },
  onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
});
const deadline = setTimeout(() => { proc.kill(); process.exitCode = 1; }, 90_000);
try {
  print('initialize', proc.init);
  const session = await proc.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
  print('session/new', session);
  if (agentId === 'grok') {
    for (const method of ['_x.ai/session/info']) {
      try { print(method, await proc.agent.request(method, { sessionId: session.sessionId })); }
      catch (e) { print(method, e instanceof acp.RequestError ? { code: e.code, data: e.data } : String(e)); }
    }
  }
  for (const [configId, value] of [['model', model], [agentId === 'kimi' ? 'thinking' : 'reasoning_effort', effort]]) {
    if (!value) continue;
    try {
      const request: acp.SetSessionConfigOptionRequest = { sessionId: session.sessionId, configId: configId!, value };
      print(`set ${configId}=${value}`, await proc.agent.request(acp.methods.agent.session.setConfigOption, request));
    } catch (e) { print(`set ${configId} failed`, e instanceof acp.RequestError ? { code: e.code, message: e.message, data: e.data } : String(e)); }
  }
  if (agentId === 'grok' && effort && process.argv.includes('--legacy')) {
    try { print('legacy effort', await proc.agent.request('session/set_model', {
      sessionId: session.sessionId, modelId: model, _meta: { reasoningEffort: effort },
    })); } catch (e) { print('legacy failed', e instanceof acp.RequestError ? { code: e.code, data: e.data } : String(e)); }
  }
  if (process.argv.includes('--prompt')) {
    print('prompt', await proc.agent.request(acp.methods.agent.session.prompt, {
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Reply with exactly CONTROLS_OK. Do not call tools.' }],
    }));
    if (agentId === 'kimi') await Promise.race([usage, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (agentId === 'grok') print('context', await proc.agent.request('_x.ai/session/info', { sessionId: session.sessionId }));
  }
} finally {
  clearTimeout(deadline);
  proc.kill();
}
