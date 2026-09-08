import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AcpSession } from '../src/host/acp/AcpSession';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { dataHome, DevinAccountProvider, readCredentials } from '../src/host/accounts/devin';
import type { QuestionAnswers, QuestionBlock } from '../src/shared/transcript';

// Usage: pnpm tsx --tsconfig tsconfig.host.json scripts/probe-questions-host.ts <grok|devin|kimi> [--skip|--partial|--cancel]
// Real host path (AcpSession + QuestionGate): asks the agent to use its question tool, answers the QuestionBlock the way the webview would
// (first option of each question, a free text where allowed, all of a multi-select), and prints the block, the wire reply and the final turn.
// --skip: press Skip without answering; --partial: answer only the first question, then Skip; --cancel: stop the turn while the card is open
const agent = process.argv[2] ?? 'grok';
const decision = process.argv.includes('--cancel') ? 'cancel' : process.argv.includes('--skip') ? 'skip' : process.argv.includes('--partial') ? 'partial' : 'answer';
const registry = new AgentRegistry();
const cwd = await mkdtemp(join(tmpdir(), 'acpilot-questions-'));
const credential = agent === 'devin' ? await readCredentials(join(dataHome(), 'devin', 'credentials.toml')) : undefined;
if (agent === 'devin' && !credential) throw new Error('No local Devin login');
const provider = new DevinAccountProvider(cwd, () => registry.resolveBinary(agent));
const seen = new Set<string>();
const log = (event: string, data: object = {}) => console.log(JSON.stringify({ event, ...data }));
const session = AcpSession.fresh(agent, cwd, {
  registry,
  blobs: { saveBlob: async () => { throw new Error('No attachments'); }, readBlob: async () => { throw new Error('No attachments'); } },
  accounts: credential ? { spawnEnv: async () => undefined, authenticate: async (_a, _id, proc) => provider.authenticate(proc, credential) } : undefined,
  compaction: () => ({ auto: false, atTokens: 300_000 }),
  log: line => { if (/prompt done|failed|error/i.test(line)) log('log', { line }); },
  onChange: s => {
    for (const turn of s.view().turns) {
      if (turn.role !== 'agent') continue;
      for (const b of turn.blocks) {
        if (b.type !== 'question' || b.outcome || seen.has(b.id)) continue;
        seen.add(b.id);
        log('question', { block: b, decision });
        // The webview answers asynchronously, after the host has registered the pending request
        queueMicrotask(() => {
          if (decision === 'cancel') { void s.cancel(); return; }
          s.answerQuestions(b.id, answersFor(b), decision !== 'answer');
        });
      }
    }
  },
}, credential ? 'probe-local' : undefined);

function answersFor(b: QuestionBlock): QuestionAnswers {
  const out: QuestionAnswers = {};
  if (decision === 'skip') return out;
  b.questions.forEach((q, i) => {
    if (decision === 'partial' && i > 0) return;
    if (q.kind === 'text') out[q.id] = q.numeric ? '3' : 'probe free text';
    else if (q.kind === 'multiple') out[q.id] = q.options.map(o => o.id);
    // The second single-select question takes a free-text answer where the agent allows one, to see how it comes back
    else out[q.id] = i === 1 && q.other ? 'probe free text' : q.options[0]!.id;
  });
  return out;
}

const watchdog = setTimeout(() => { log('timeout'); session.dispose(); process.exit(2); }, 240_000);
try {
  await session.start();
  log('started', { status: session.view().status, runtime: session.runtimeInfo() });
  if (session.view().status !== 'ready') throw new Error(session.view().error ?? 'Not ready');
  await session.prompt('Use your ask-user-question tool (the structured multiple-choice one, not prose) to ask me exactly two questions about naming a new file: question one with three options, question two with two options and allow a free-text "other" answer if supported. Wait for my answers, then reply with one line summarizing what I picked. Do not use any other tools.');
  const last = session.view().turns.at(-1);
  log('result', { turn: last });
  if (last?.role !== 'agent') process.exitCode = 1;
  else {
    const question = last.blocks.find((b): b is QuestionBlock => b.type === 'question');
    const expectedOutcome = decision === 'cancel' ? 'cancelled' : decision === 'answer' ? 'answered' : 'skipped';
    if (!question || question.outcome !== expectedOutcome) { log('unexpected', { expectedOutcome, got: question?.outcome }); process.exitCode = 1; }
    if (last.stop !== (decision === 'cancel' ? 'cancelled' : 'end_turn')) process.exitCode = 1;
  }
} catch (e) {
  log('error', { message: e instanceof Error ? e.message : String(e) });
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  session.dispose();
}
