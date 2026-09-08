import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

// Fake ACP agent: runs in a child process, plays different scripts based on the prompt text, feeding events to the AcpSession tests
// Scripts: default → thought + text; "tool" → tool call + permission request; "slow" → streams slowly, waits for cancel; "auth" → session/new fails with -32000;
// "big" → reports a very large usage; "/compact" → compaction_update in_progress → completed, usage drops;
// "fail" → session/prompt rejects with a typed upstream error the way Devin does (once: the same prompt succeeds when sent again);
// "refuse" → stopReason refusal with no output; "truncate" → some text, then stopReason max_tokens; "mode:<id>" → current_mode_update to that mode
// Resume: when resume doesn't know the sessionId, a cwd containing "gone" mimics Devin's session_not_found, otherwise reports unknown session
// Login: when cwd contains "needs-auth", session/new requires authenticate first; authenticate validates _meta.api_key the way Devin does (only accepts good-key)
// Process lifecycle knobs (env): FAKE_INIT_FAIL → initialize answers an error while the process stays up (an orphan unless the client kills it);
// FAKE_STUBBORN → ignores SIGTERM and keeps the event loop busy, so only SIGKILL ends it; FAKE_SILENT_CANCEL → a cancel during background
// compaction drops the work without the usual "Compaction canceled." prose

if (process.env.FAKE_STUBBORN) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1 << 30);
}

const sessions = new Set<string>();
const modes = new Map<string, string>();
let seq = 0;
let usedTokens = 1234;
let compactions = 0;
// Background-compaction fixtures are released explicitly through setConfig so
// tests can place a follow-up between the RPC acknowledgement and status events.
const backgroundStyle = process.env.FAKE_COMPACTION;
const grokUsage = process.env.FAKE_GROK_USAGE;
let background: ((status: 'start' | 'completed' | 'cancelled') => Promise<void>) | undefined;

const app = acp.agent({ name: 'fake-agent' })
  .onRequest('_x.ai/session/info', value => value as { sessionId: string }, ({ params }) => {
    if (!grokUsage || grokUsage === 'unsupported') throw acp.RequestError.methodNotFound('_x.ai/session/info');
    if (grokUsage === 'malformed') return { result: { sessionId: params.sessionId, context: { used: -1, total: 0 } } };
    return { result: { sessionId: params.sessionId, context: { used: usedTokens, total: config.model === 'm2' ? 250_000 : 1_000_000 } } };
  })
  .onRequest(acp.methods.agent.initialize, () => {
    if (process.env.FAKE_INIT_FAIL) throw acp.RequestError.internalError(undefined, 'initialize refused by fixture');
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: { name: 'fake', version: '0.0.0' },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } },
      authMethods: [{ id: 'fake.login', name: 'Fake login', description: 'run fake login' }],
    };
  })
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    if (params.cwd.includes('needs-auth') && !authed) {
      // Mimic Kimi: the reason goes to stderr as an ndjson log line, the -32000 itself carries nothing
      if (process.env.FAKE_AUTH_HINT === 'devin') {
        process.stderr.write('2026-09-07T06:49:18.250107Z WARN run_acp_server:acp_bridge_dispatch{method="session/new" queue_wait_ms=0}:new_session: chisel_agent::acp_server::agent_impl: ACP: Creating session without credentials - agent may not work\n');
      } else {
        process.stderr.write(`${JSON.stringify({ level: 'info', msg: 'acp: auth readiness probe failed, trying the OAuth summary', error: 'provider managed:fake has no credential configured' })}\n`);
      }
      // Mimic Devin: the JSON-RPC layer then echoes its own error response to stderr — noise the client must not mistake for a diagnosis
      process.stderr.write('2026-01-01T00:00:00Z WARN run_acp_server: agent_client_protocol::jsonrpc::outgoing_actor: Sending error response id=Number(1) method=session/new error=Error { code: -32000: Authentication required, message: "ACP host has not authenticated." }\n');
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
  .onRequest(acp.methods.agent.session.setMode, ({ params }) => { modes.set(params.sessionId, params.modeId); return {}; })
  .onRequest(acp.methods.agent.session.setConfigOption, async ({ params }) => {
    if (params.value === 'unavailable') throw acp.RequestError.invalidParams(undefined, 'Model unavailable');
    if (background && params.configId === 'effort') {
      await background(params.value === 'low' ? 'start' : 'completed');
      if (params.value !== 'low') background = undefined;
    }
    config[params.configId] = String(params.value);
    return { configOptions: configOptions() };
  })
  .onNotification(acp.methods.agent.session.cancel, async ({ params }) => {
    cancelled.add(params.sessionId);
    if (background) {
      if (!process.env.FAKE_SILENT_CANCEL) await background('cancelled');
      background = undefined;
    }
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const sid = params.sessionId;
    const text = params.prompt.map(p => (p.type === 'text' ? p.text : '')).join('');
    const send = (update: acp.SessionUpdate) => client.notify(acp.methods.client.session.update, { sessionId: sid, update });
    cancelled.delete(sid);
    if (text.endsWith('inspect-history')) {
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: JSON.stringify({ sessionId: sid, mode: modes.get(sid), config, prompt: params.prompt }) } });
      return { stopReason: 'end_turn' };
    }
    // "mode:<id>" → the agent switches the session's mode on its own (the way Devin does when a permission answer picks bypass mode)
    if (text.startsWith('mode:')) {
      await send({ sessionUpdate: 'current_mode_update', currentModeId: text.slice(5) });
      return { stopReason: 'end_turn' };
    }
    if (text.startsWith('plan-')) {
      const path = '/Users/test/.devin/plans/demo.md';
      const markdown = '# Demo plan\n\nCreate hello.txt.';
      await send({ sessionUpdate: 'tool_call', toolCallId: 'write-plan', title: 'Updated plan: Demo plan', kind: 'edit', rawInput: { file_path: path, content: markdown }, _meta: { 'cognition.ai/isPlanFileEdit': true } });
      await send({ sessionUpdate: 'tool_call_update', toolCallId: 'write-plan', status: 'completed' });
      if (text === 'plan-file') return { stopReason: 'end_turn' };
      await send({ sessionUpdate: 'tool_call', toolCallId: 'exit-plan', title: 'Exit plan mode', kind: 'switch_mode', _meta: { 'cognition.ai/isExitPlan': true, 'cognition.ai/planFilePath': path } });
      let approved = false;
      if (text === 'plan-grok') {
        const r = await client.request<{ outcome: string }>('_x.ai/exit_plan_mode', { sessionId: sid, toolCallId: 'exit-plan', planContent: markdown });
        approved = r.outcome === 'approved';
      } else {
        const r = await client.request(acp.methods.client.session.requestPermission, {
          sessionId: sid, toolCall: { toolCallId: 'exit-plan' },
          options: [{ optionId: 'plan_accept_edits', name: 'Build', kind: 'allow_once' }, { optionId: 'reject_once', name: 'Revise', kind: 'reject_once' }],
        });
        approved = r.outcome.outcome === 'selected' && r.outcome.optionId === 'plan_accept_edits';
      }
      await send({ sessionUpdate: 'tool_call_update', toolCallId: 'exit-plan', status: 'completed' });
      if (approved) await send({ sessionUpdate: 'current_mode_update', currentModeId: 'agent' });
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `${approved ? 'APPROVED' : 'REJECTED'} model=${config.model}` } });
      return { stopReason: cancelled.has(sid) ? 'cancelled' : 'end_turn' };
    }
    if (background) {
      // Devin cancels background compaction on a new prompt; Kimi acknowledges
      // the follow-up without forwarding its reply through the original driver.
      if (backgroundStyle === 'devin') { await background('cancelled'); background = undefined; }
      else return { stopReason: 'end_turn' };
    }

    // Typed upstream failure, once per distinct prompt text, before anything is streamed — the retry of the same prompt then runs the normal script
    if (text.includes('fail') && !failed.has(text)) {
      failed.add(text);
      throw new acp.RequestError(-32603, 'Upstream error', { 'cognition.ai/errorKind': 'upstream_error', 'cognition.ai/retryable': true, detail: 'quota exhausted' });
    }

    // the first compaction drops usage to 20%; afterwards "nothing left to compact" leaves usage unchanged — simulating a compaction that can't shrink
    if (text.trim() === '/compact') {
      const id = `cp${++compactions}`;
      if (backgroundStyle) {
        background = async status => {
          if (backgroundStyle === 'structured') {
            await send({ sessionUpdate: 'compaction_update', compactionId: id, status: status === 'start' ? 'in_progress' : status });
          } else {
            const value = status === 'start'
              ? backgroundStyle === 'devin' ? 'Compacting context…' : 'Context compaction started — it runs in the background and the compacted context applies once it finishes.'
              : status === 'completed' ? backgroundStyle === 'devin' ? 'Context compacted' : 'Compaction completed.\n- Messages compacted: 3'
                : backgroundStyle === 'devin' ? 'Compaction canceled.' : 'Compaction cancelled.';
            await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } });
          }
          if (status === 'completed') {
            usedTokens = Math.round(usedTokens * 0.2);
            await send({ sessionUpdate: 'usage_update', used: usedTokens, size: 1_000_000 });
          }
        };
        // Structured agents must announce the work before returning; Devin's
        // first status can arrive after the acknowledgement itself.
        if (backgroundStyle !== 'devin') await background('start');
        return { stopReason: 'end_turn' };
      }
      await send({ sessionUpdate: 'compaction_update', compactionId: id, status: 'in_progress' });
      if (compactions === 1) usedTokens = Math.round(usedTokens * 0.2);
      await send({ sessionUpdate: 'compaction_update', compactionId: id, status: 'completed' });
      if (!grokUsage) await send({ sessionUpdate: 'usage_update', used: usedTokens, size: 1_000_000 });
      return { stopReason: 'end_turn' };
    }

    // any non-text block → echo what arrived (type plus the fields that matter), mirroring Grok's habit of echoing every prompt block as a user_message_chunk first
    if (params.prompt.some(p => p.type !== 'text')) {
      for (const p of params.prompt) await send({ sessionUpdate: 'user_message_chunk', content: p });
      const echo = params.prompt.map(p =>
        p.type === 'image' ? `image:${p.mimeType}`
          : p.type === 'resource' ? `resource:${p.resource.uri}:${'text' in p.resource ? p.resource.text : '<blob>'}`
            : p.type === 'resource_link' ? `resource_link:${p.uri}:${p.name}`
              : p.type).join(' · ');
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: echo } });
      return { stopReason: 'end_turn' };
    }

    await send({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });

    if (text.includes('refuse')) return { stopReason: 'refusal' };

    await send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking ' } });
    await send({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hard' } });

    if (text.includes('truncate')) {
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'once upon a' } });
      return { stopReason: 'max_tokens' };
    }

    if (text.includes('big')) {
      usedTokens += 400_000;
      await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lots of context' } });
      await send({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'compact it' }] });
      if (!grokUsage) await send({ sessionUpdate: 'usage_update', used: usedTokens, size: 1_000_000 });
      // Deliberately different from the live window: this is aggregate spend.
      return { stopReason: 'end_turn', _meta: { usage: { totalTokens: 9_999_999, inputTokens: 9_000_000, modelCalls: 20 } } };
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

    await send({ sessionUpdate: 'plan', entries: [{ content: 'step 1', priority: 'high', status: 'completed' }, { content: 'step 2', priority: 'medium', status: 'in_progress' }] });
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello ' } });
    await send({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'world' } });
    await send({ sessionUpdate: 'session_info_update', title: 'Fake title' });
    await send({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'compact it' }] });
    return { stopReason: 'end_turn' };
  });

let authed = false;
const cancelled = new Set<string>();
// Prompts that have already failed once, so a retry of the same text goes through
const failed = new Set<string>();

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
