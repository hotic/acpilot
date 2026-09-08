import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as acp from '@agentclientprotocol/sdk';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AgentProcess } from '../src/host/acp/AgentProcess';
import { dataHome, DevinAccountProvider, readCredentials } from '../src/host/accounts/devin';

// Usage: pnpm tsx scripts/probe-compaction.ts <devin|grok|kimi> [--follow-up]
// Compare the /compact response with its actual completion. Only synthetic text is
// sent; credentials never enter the diagnostic log.
const agentId = process.argv[2] ?? 'devin';
const followUp = process.argv.includes('--follow-up');
const registry = new AgentRegistry();
const def = registry.get(agentId);
const binary = await registry.resolveBinary(agentId);
if (!binary) throw new Error(`Missing executable: ${agentId}`);
const cwd = await mkdtemp(join(tmpdir(), 'acpira-compact-probe-'));
const start = Date.now();
const log = (event: string, fields: Record<string, unknown> = {}) => console.log(JSON.stringify({ ms: Date.now() - start, event, ...fields }));
let active = false;
let finished = false;
let compactPhase = false;
let output = '';
let commands: string[] = [];
const seen = new Set<string>();
let resolveFinished: () => void = () => {};
const completion = new Promise<void>(resolve => { resolveFinished = resolve; });
const watchdog = setTimeout(() => { log('timeout', { active }); proc?.kill(); process.exit(2); }, 120_000);
let proc: AgentProcess | undefined;
try {
  proc = await AgentProcess.spawn(def, binary, cwd, {
    onUpdate: ({ update: u }) => {
      if (u.sessionUpdate === 'available_commands_update') commands = u.availableCommands.map(c => c.name);
      if (u.sessionUpdate === 'compaction_update') {
        log('compaction_update', { status: u.status });
        active = !['completed', 'failed', 'cancelled'].includes(u.status);
        if (!active) { finished = true; resolveFinished(); }
      }
      if (compactPhase && u.sessionUpdate === 'agent_message_chunk' && u.content.type === 'text') {
        output += u.content.text;
        // Devin also reports manual compaction as plain text, without a structured update.
        const markers = ['Compacting context', 'Context compaction started', 'Compaction started', 'Compaction canceled', 'Compaction cancelled', 'Compaction completed', 'Nothing to compact', 'Context compacted', 'Compaction failed', 'Compaction is blocked'];
        for (const marker of markers) {
          if (output.includes(marker) && !seen.has(marker)) {
            seen.add(marker);
            log('text_marker', { marker });
            if (['Compacting context', 'Context compaction started', 'Compaction started'].includes(marker)) active = true;
            else { active = false; finished = true; resolveFinished(); }
          }
        }
        if (output.includes('FOLLOWUP_OK') && !seen.has('FOLLOWUP_OK')) {
          seen.add('FOLLOWUP_OK'); log('follow_up_marker');
        }
      }
    },
    onPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
    onStderr: line => {
      if (/auth readiness probe failed|has no credential configured/.test(line)) log('auth_not_ready');
    },
  });
  log('initialize', { agent: proc.init.agentInfo, binary });
  if (agentId === 'devin') {
    const credential = await readCredentials(join(dataHome(), 'devin', 'credentials.toml'));
    if (!credential) throw new Error('No local Devin login');
    await new DevinAccountProvider(cwd, async () => binary).authenticate(proc, credential);
    log('authenticated');
  }
  const session: acp.NewSessionRequest = { cwd, mcpServers: [] };
  const opened = await proc.agent.request(acp.methods.agent.session.new, session);
  log('session_new', { compactAdvertised: commands.includes('compact') });
  const prompt = async (label: string, text: string) => {
    log('prompt_send', { label, active });
    const request: acp.PromptRequest = { sessionId: opened.sessionId, prompt: [{ type: 'text', text }] };
    const response = await proc!.agent.request(acp.methods.agent.session.prompt, request);
    log('prompt_response', { label, stopReason: response.stopReason, active });
  };
  const facts = Array.from({ length: 160 }, (_, i) => `Synthetic record ${i}: item-${i} has value ${i * 7} and category ${i % 9}.`).join('\n');
  await prompt('seed', `Retain these synthetic records for later. Do not use any tools. Reply only SEED_OK.\n${facts}`);
  log('commands', { compactAdvertised: commands.includes('compact') });
  compactPhase = true;
  await prompt('compact', '/compact');
  if (followUp) await prompt('follow_up', 'Do not use tools. Reply only FOLLOWUP_OK.');
  // The Devin acknowledgement can arrive before even the first status notification.
  if ((agentId === 'devin' || agentId === 'kimi') && !followUp) await completion;
  if (active && !finished) await completion;
  log('result', { active, finished, markers: [...seen], outputChars: output.length, output });
} catch (error) {
  log('error', { code: error instanceof acp.RequestError ? error.code : undefined, message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  proc?.kill();
}
