import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AgentProcess } from '../src/host/acp/AgentProcess';
import { dataHome, DevinAccountProvider, readCredentials } from '../src/host/accounts/devin';

// Usage: pnpm exec tsx --tsconfig tsconfig.host.json scripts/probe-thought.ts <grok|devin|kimi>
// Record thought/tool boundaries using a synthetic file in an isolated directory.
// Only event types, timestamps and payload lengths enter the diagnostic log.
const agent = process.argv[2] ?? 'grok';
const registry = new AgentRegistry();
const binary = await registry.resolveBinary(agent);
if (!binary) throw new Error(`Missing executable: ${agent}`);
const cwd = await mkdtemp(join(tmpdir(), 'acpira-thought-probe-'));
const start = Date.now();
const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ ms: Date.now() - start, event, ...fields }));
let proc: AgentProcess | undefined;
const watchdog = setTimeout(() => { log('timeout'); proc?.kill(); process.exit(2); }, 120_000);
try {
  proc = await AgentProcess.spawn(registry.get(agent), binary, cwd, {
    onUpdate: n => {
      const u = n.update;
      log(u.sessionUpdate, {
        ...('content' in u && u.content && !Array.isArray(u.content) && u.content.type === 'text' ? { chars: u.content.text.length } : {}),
        ...('toolCallId' in u ? { id: u.toolCallId, status: u.status, title: u.title } : {}),
        metaKeys: Object.keys(n._meta ?? {}),
      });
    },
    onPermission: async req => {
      const allow = req.options.find(o => o.kind === 'allow_once');
      return { outcome: allow ? { outcome: 'selected', optionId: allow.optionId } : { outcome: 'cancelled' } };
    },
  });
  log('initialize', { agent: proc.init.agentInfo });
  if (agent === 'devin') {
    const credential = await readCredentials(join(dataHome(), 'devin', 'credentials.toml'));
    if (!credential) throw new Error('No local Devin login');
    await new DevinAccountProvider(cwd, async () => binary).authenticate(proc, credential);
  }
  const request: acp.NewSessionRequest = { cwd, mcpServers: [] };
  const session = await proc.agent.request(acp.methods.agent.session.new, request);
  const prompt: acp.PromptRequest = { sessionId: session.sessionId, prompt: [{ type: 'text', text: 'Create sample.ts in the current directory using a file-writing tool. Write 40 distinct exported TypeScript functions, each returning its index as a number. Generate the full source directly in the tool arguments, without a shell or a generator script. Briefly think about the task first. Finally reply DONE. Do not read other directories or use subagents.' }] };
  const response = await proc.agent.request(acp.methods.agent.session.prompt, prompt);
  const source = await readFile(join(cwd, 'sample.ts'), 'utf8');
  log('result', { stopReason: response.stopReason, fileChars: source.length, exports: (source.match(/export /g) ?? []).length });
} catch (error) {
  log('error', { code: error instanceof acp.RequestError ? error.code : undefined, message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  proc?.kill();
}
