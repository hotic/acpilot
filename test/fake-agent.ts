import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

// Fake ACP agent: runs in a child process, plays different scripts based on the prompt text, feeding events to the AcpSession tests
// Scripts: default → thought + text; "tool" → tool call + permission request; "slow" → streams slowly, waits for cancel; "auth" → session/new fails with -32000;
// "big" → reports a very large usage; "/compact" → compaction_update in_progress → completed, usage drops
// Resume: when resume doesn't know the sessionId, a cwd containing "gone" mimics Devin's session_not_found, otherwise reports unknown session
// Login: when cwd contains "needs-auth", session/new requires authenticate first; authenticate validates _meta.api_key the way Devin does (only accepts good-key)

const sessions = new Set<string>();
let seq = 0;
let usedTokens = 1234;
let compactions = 0;

const app = acp.agent({ name: 'fake-agent' })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentInfo: { name: 'fake', version: '0.0.0' },
    agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
    authMethods: [{ id: 'fake.login', name: 'Fake login', description: 'run fake login' }],
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    if (params.cwd.includes('needs-auth') && !authed) {
      // Mimic Kimi: the reason goes to stderr as an ndjson log line, the -32000 itself carries nothing
      process.stderr.write(`${JSON.stringify({ level: 'info', msg: 'acp: auth readiness probe failed, trying the OAuth summary', error: 'provider managed:fake has no credential configured' })}\n`);
      throw acp.RequestError.authRequired();
    }
    const sessionId = `s${++seq}`;
    sessions.add(sessionId);
    return {
      sessionId,
      // when cwd contains no-modes, mimic Grok: omit modes, forcing the client to use the registry's synthesized modes
      ...(params.cwd.includes('no-modes') ? {} : { modes: { currentModeId: 'agent', availableModes: [{ id: 'agent', name: 'Agent' }, { id: 'plan', name: 'Plan' }] } }),
      configOptions: configOptions(),
    };
  })
  .onRequest(acp.methods.agent.session.resume, ({ params }) => {
    if (!sessions.has(params.sessionId)) {
      // when cwd contains gone, mimic Devin: empty sessions get swept once the process exits, report session_not_found
      if (params.cwd.includes('gone')) throw new acp.RequestError(-32016, 'Session not found', { 'cognition.ai/errorKind': 'session_not_found', 'cognition.ai/retryable': false });
      throw acp.RequestError.invalidParams({ sessionId: params.sessionId }, 'unknown session');
    }
    return { modes: { currentModeId: 'plan', availableModes: [{ id: 'agent', name: 'Agent' }, { id: 'plan', name: 'Plan' }] } };
  })
  .onRequest(acp.methods.agent.authenticate, ({ params }) => {
    const key = params._meta?.api_key;
    if (key !== undefined && key !== 'good-key') throw acp.RequestError.authRequired({ reason: 'bad key' });
    authed = true;
    return {};
  })
  .onRequest(acp.methods.agent.session.setMode, () => ({}))
  .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
    config[params.configId] = String(params.value);
    return { configOptions: configOptions() };
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => { cancelled.add(params.sessionId); })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const sid = params.sessionId;
    const text = params.prompt.map(p => (p.type === 'text' ? p.text : '')).join('');
    const send = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId: sid, update });
    cancelled.delete(sid);

    // the first compaction drops usage to 20%; afterwards "nothing left to compact" leaves usage unchanged — simulating a compaction that can't shrink
    if (text.trim() === '/compact') {
      const id = `cp${++compactions}`;
      await send({ sessionUpdate: 'compaction_update', compactionId: id, status: 'in_progress' });
      if (compactions === 1) usedTokens = Math.round(usedTokens * 0.2);
      await send({ sessionUpdate: 'compaction_update', compactionId: id, status: 'completed' });
      await send({ sessionUpdate: 'usage_update', used: usedTokens, size: 1_000_000 });
      return { stopReason: 'end_turn' };
    }

    await send({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });
    await send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking ' } });
    await send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hard' } });

    if (text.includes('big')) {
      usedTokens += 400_000;
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lots of context' } });
      await send({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'compact it' }] });
      await send({ sessionUpdate: 'usage_update', used: usedTokens, size: 1_000_000 });
      return { stopReason: 'end_turn' };
    }

    if (text.includes('slow')) {
      for (let i = 0; i < 50; i++) {
        if (cancelled.has(sid)) return { stopReason: 'cancelled' };
        await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${i} ` } });
        await new Promise(r => setTimeout(r, 40));
      }
      return { stopReason: 'end_turn' };
    }

    if (text.includes('tool')) {
      await send({ sessionUpdate: 'tool_call', toolCallId: 'tc1', title: 'run_command', kind: 'execute', status: 'pending', rawInput: { command: 'pnpm test' } });
      const perm = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: sid,
        toolCall: { toolCallId: 'tc1', title: 'Run `pnpm test`' },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
      });
      if (perm.outcome.outcome === 'selected' && perm.outcome.optionId === 'allow') {
        await send({ sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'in_progress' });
        await send({ sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '12 passed' } }] });
        await send({ sessionUpdate: 'tool_call', toolCallId: 'tc2', title: 'edit', kind: 'edit', status: 'completed', locations: [{ path: '/repo/a.ts' }], content: [{ type: 'diff', path: '/repo/a.ts', oldText: 'a\nb\nc\n', newText: 'a\nB\nc\nd\n' }] });
        await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'tests passed' } });
      } else {
        await send({ sessionUpdate: 'tool_call_update', toolCallId: 'tc1', status: 'failed' });
        await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'skipped' } });
      }
      await send({ sessionUpdate: 'usage_update', used: 1234, size: 100000, cost: { amount: 0.01, currency: 'USD' } });
      return { stopReason: 'end_turn' };
    }

    await send({ sessionUpdate: 'plan', entries: [{ content: 'step 1', priority: 'medium', status: 'completed' }, { content: 'step 2', priority: 'medium', status: 'in_progress' }] });
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello ' } });
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } });
    await send({ sessionUpdate: 'session_info_update', title: 'Fake title' });
    await send({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'compact it' }] });
    return { stopReason: 'end_turn' };
  });

let authed = false;
const cancelled = new Set<string>();

// two select-type configOptions: reasoning level intentionally listed before model, verifying the client sorts by category
const config: Record<string, string> = { model: 'm1', effort: 'high' };
function configOptions(): acp.SessionConfigOption[] {
  return [
    { id: 'effort', name: 'Reasoning', category: 'thought_level', type: 'select', currentValue: config.effort!, options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
    { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: config.model!, options: [{ value: 'm1', name: 'Model 1' }, { value: 'm2', name: 'Model 2' }] },
  ];
}

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout) as WritableStream<Uint8Array>, Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>);
const conn = app.connect(stream);
await conn.closed;
