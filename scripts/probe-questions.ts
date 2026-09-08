import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { dataHome, DevinAccountProvider, readCredentials } from '../src/host/accounts/devin';

// Usage: pnpm tsx --tsconfig tsconfig.host.json scripts/probe-questions.ts <grok|devin|kimi> [--answer=JSON] [--decline|--cancel] [--partial] [--free-text] [--raw] [prompt]
// Raw ACP client (no AcpSession): advertises form elicitation, registers Grok's `_x.ai/ask_user_question` extension method with a
// passthrough parser, and prints every incoming request / tool update verbatim so the wire shape of each agent's question tool can be read off.
// --answer=JSON  the exact response object to return for the Grok extension request (default: a guessed `accepted` payload built from the first option of each question)
// --decline / --cancel  answer elicitation/create with { action: 'decline' } / { action: 'cancel' } instead of accepting the first option
// --partial      leave the last form property unanswered (does the agent enforce `required`?); --free-text: answer the first one with a string outside its oneOf
// --raw          also dump every session/update (noisy)
const argv = process.argv.slice(2);
const agentId = argv.find(a => !a.startsWith('--')) ?? 'grok';
const decline = argv.includes('--decline');
const cancel = argv.includes('--cancel');
const partial = argv.includes('--partial');
const freeText = argv.includes('--free-text');
const raw = argv.includes('--raw');
const answerJson = argv.find(a => a.startsWith('--answer='))?.slice('--answer='.length);
const promptText = argv.filter(a => !a.startsWith('--')).slice(1).join(' ')
  || 'Use your ask-user-question tool (the structured multiple-choice one, not prose) to ask me exactly two questions about naming a new file: question one with three options, question two with two options and allow a free-text "other" answer if supported. Wait for my answers, then reply with one line summarizing what I picked. Do not use any other tools.';

const registry = new AgentRegistry();
const def = registry.get(agentId);
const bin = await registry.resolveBinary(agentId);
if (!bin) { console.error(`command not found: ${def.command}`); process.exit(1); }
const cwd = await mkdtemp(join(tmpdir(), 'acpilot-questions-'));
const log = (event: string, data: unknown = {}) => console.log(`\n[${event}] ${JSON.stringify(data, null, 2)}`);

const child = spawn(bin, def.args, { cwd, env: { ...process.env, ...def.env }, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', d => process.stderr.write(`\x1b[33mstderr\x1b[0m ${d}`));
child.on('exit', (code, signal) => console.error(`exit code=${code} signal=${signal}`));

const firstChoice = (schema: acp.ElicitationSchema): Record<string, acp.ElicitationContentValue> => {
  const content: Record<string, acp.ElicitationContentValue> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const p = prop as Record<string, unknown>;
    const oneOf = Array.isArray(p.oneOf) ? (p.oneOf[0] as { const?: string } | undefined)?.const : undefined;
    const anyOf = p.type === 'array' && typeof p.items === 'object' && p.items && Array.isArray((p.items as { anyOf?: unknown }).anyOf)
      ? [((p.items as { anyOf: { const: string }[] }).anyOf[0]!).const] : undefined;
    content[key] = oneOf ?? anyOf ?? (Array.isArray(p.enum) ? String(p.enum[0]) : p.type === 'boolean' ? true : p.type === 'number' || p.type === 'integer' ? 0 : 'free text answer');
  }
  return content;
};

const app = acp.client({ name: 'acpilot-probe' })
  .onNotification(acp.methods.client.session.update, ({ params }) => {
    const u = params.update;
    if (u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') process.stdout.write(u.content.text);
    else if (u.sessionUpdate === 'agent_thought_chunk') return;
    else if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') log(u.sessionUpdate, u);
    else if (raw) log(u.sessionUpdate, u);
  })
  .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
    log('session/request_permission', params);
    const allow = params.options.find(o => o.kind === 'allow_once') ?? params.options[0]!;
    return { outcome: { outcome: 'selected', optionId: allow.optionId } };
  })
  .onRequest(acp.methods.client.elicitation.create, ({ params }) => {
    log('elicitation/create', params);
    if (cancel) return { action: 'cancel' };
    const schema = (params as { requestedSchema?: acp.ElicitationSchema }).requestedSchema;
    if (decline || !schema) return { action: 'decline' };
    const content = firstChoice(schema);
    // --partial: leave the last property out (is `required` enforced?); --free-text: answer the first one with a string outside its oneOf
    const keys = Object.keys(content);
    if (partial && keys.length > 1) delete content[keys[keys.length - 1]!];
    if (freeText && keys[0]) content[keys[0]] = 'my own custom answer';
    log('elicitation/create → accept', content);
    return { action: 'accept', content };
  })
  .onRequest('_x.ai/ask_user_question', v => v as Record<string, unknown>, ({ params }) => {
    log('_x.ai/ask_user_question', params);
    if (answerJson) { const r = JSON.parse(answerJson); log('_x.ai/ask_user_question → (from --answer)', r); return r; }
    // Best guess at the accepted shape: header → option label (single-select) or labels (multi-select)
    const questions = (params.questions as { header?: string; question?: string; options?: { label: string }[]; multiSelect?: boolean }[] | undefined) ?? [];
    const answers: Record<string, string | string[]> = {};
    for (const q of questions) {
      const first = q.options?.[0]?.label ?? '';
      answers[q.header ?? q.question ?? ''] = q.multiSelect ? [first] : first;
    }
    const r = { outcome: 'accepted', answers };
    log('_x.ai/ask_user_question → (guess)', r);
    return r;
  });

const conn = app.connect(acp.ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>));
const watchdog = setTimeout(() => { console.error('timeout'); child.kill(); process.exit(2); }, 240_000);
try {
  const init = await conn.agent.request(acp.methods.agent.initialize, {
    protocolVersion: acp.PROTOCOL_VERSION,
    clientInfo: { name: 'acpilot-probe', version: '0' },
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } },
  });
  log('initialize', { agentInfo: init.agentInfo, capabilities: init.agentCapabilities });
  if (agentId === 'devin') {
    const credential = await readCredentials(join(dataHome(), 'devin', 'credentials.toml'));
    if (!credential) throw new Error('No local Devin login');
    const provider = new DevinAccountProvider(cwd, async () => bin);
    await provider.authenticate({ agent: conn.agent, init } as never, credential);
    console.log('authenticate ok');
  }
  const s = await conn.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] });
  log('session/new', { sessionId: s.sessionId });
  console.log(`\nprompt: ${promptText}\n`);
  const r = await conn.agent.request(acp.methods.agent.session.prompt, { sessionId: s.sessionId, prompt: [{ type: 'text', text: promptText }] });
  log('stop', r);
  // Kimi emits usage_update after the response; give late notifications a moment
  await new Promise(res => setTimeout(res, 1500));
} catch (e) {
  console.error('failed:', e instanceof acp.RequestError ? `${e.code} ${e.message} ${JSON.stringify(e.data)}` : e);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  conn.close();
  child.kill();
  process.exit();
}
