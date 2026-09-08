import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { QuestionBlock } from '@shared/transcript';
import { AgentRegistry } from '../src/host/acp/AgentRegistry';
import { AcpSession, type SessionDeps } from '../src/host/acp/AcpSession';
import { formQuestions, spareMessage } from '../src/host/acp/questions';

// Launch test/fake-agent.ts via tsx as the agent; its "ask-*" scripts replay each CLI's question dialect
const FAKE = fileURLToPath(new URL('./fake-agent.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

function session() {
  const registry = new AgentRegistry({ fake: { name: 'Fake', command: TSX, args: [FAKE] } });
  const d: SessionDeps = {
    registry, log: () => {}, onChange: () => {},
    blobs: { saveBlob: async () => { throw new Error('no attachments'); }, readBlob: async () => { throw new Error('no attachments'); } },
  };
  return AcpSession.fresh('fake', '/tmp', d);
}

async function until(pred: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise(r => setTimeout(r, 20));
  }
}

const questionBlocks = (s: AcpSession) => s.view().turns.flatMap(t => t.role === 'agent' ? t.blocks : []).filter((b): b is QuestionBlock => b.type === 'question');
const pendingQuestion = (s: AcpSession) => questionBlocks(s).find(b => !b.outcome);
const replyOf = (s: AcpSession) => s.view().turns.flatMap(t => t.role === 'agent' ? t.blocks : []).filter(b => b.type === 'text').map(b => b.markdown).join('');

describe('formQuestions', () => {
  it('reads Devin’s form: label from const, description from title, question from description, allowOther', () => {
    const qs = formQuestions({
      type: 'object', required: ['q0'],
      properties: { q0: { type: 'string', title: '文件名', description: '这个新文件应该叫什么名字？', oneOf: [{ const: 'report', title: '通用报告文件名' }, { const: 'notes', title: '笔记' }] } },
    }, '这个新文件应该叫什么名字？', { 'cognition.ai/allowOther': true }, [{ header: '文件名', question: '这个新文件应该叫什么名字？', options: [{ label: 'report', description: '通用报告文件名' }, { label: 'notes', description: '笔记' }] }]);
    expect(qs).toEqual([{
      id: 'q0', title: '文件名', text: '这个新文件应该叫什么名字？', kind: 'single', required: true, other: true,
      options: [{ id: 'report', label: 'report', description: '通用报告文件名' }, { id: 'notes', label: 'notes', description: '笔记' }],
    }]);
    // Without the tool input the schema alone still names the choices by their titles
    const bare = formQuestions({ properties: { q0: { type: 'string', oneOf: [{ const: 'report', title: '通用报告文件名' }] } } }, 'Pick one', undefined);
    expect(bare[0]).toMatchObject({ text: 'Pick one', options: [{ id: 'report', label: '通用报告文件名' }] });
    expect(bare[0]!.other).toBeUndefined();
  });

  it('reads Kimi’s form: question texts come one per line from the message, no free text', () => {
    const qs = formQuestions({
      type: 'object',
      properties: {
        q0: { type: 'string', title: '文件名', oneOf: [{ const: 'index.ts', title: 'index.ts' }, { const: 'main.ts', title: 'main.ts' }] },
        q1: { type: 'string', title: '风格', oneOf: [{ const: 'kebab-case', title: 'kebab-case' }] },
      },
    }, '新文件用什么文件名？\n文件名采用哪种命名风格？', undefined);
    expect(qs.map(q => [q.title, q.text])).toEqual([['文件名', '新文件用什么文件名？'], ['风格', '文件名采用哪种命名风格？']]);
    expect(qs[0]!.options).toEqual([{ id: 'index.ts', label: 'index.ts' }, { id: 'main.ts', label: 'main.ts' }]);
    expect(qs.every(q => !q.other)).toBe(true);
    expect(spareMessage('新文件用什么文件名？\n文件名采用哪种命名风格？', qs)).toBeUndefined();
    expect(spareMessage('Help me decide', qs)).toBe('Help me decide');
  });

  it('maps the other property types: boolean → yes / no, array → multiple, enum → plain choices, number → numeric text', () => {
    const qs = formQuestions({
      properties: {
        yes: { type: 'boolean', title: 'Proceed?' },
        many: { type: 'array', title: 'Folders', items: { enum: ['src', 'docs'] } },
        one: { type: 'string', enum: ['a', 'b'] },
        n: { type: 'integer', title: 'How many' },
        free: { type: 'string', title: 'Anything else' },
      },
    }, '', { 'cognition.ai/allowOther': true });
    expect(qs.map(q => [q.id, q.kind, q.options.map(o => o.id), q.other ?? false, q.numeric ?? false])).toEqual([
      ['yes', 'single', ['true', 'false'], false, false],
      ['many', 'multiple', ['src', 'docs'], true, false],
      ['one', 'single', ['a', 'b'], true, false],
      ['n', 'text', [], false, true],
      ['free', 'text', [], false, false],
    ]);
  });
});

describe('AcpSession questions', () => {
  it('Grok: the request becomes a card and the answers go back keyed by question text', async () => {
    const s = session();
    try {
      await s.start();
      const pending = s.prompt('ask-grok');
      await until(() => !!pendingQuestion(s));
      const block = pendingQuestion(s)!;
      expect(block.toolCallId).toBe('ask1');
      expect(block.questions.map(q => [q.id, q.kind, q.other])).toEqual([
        ['What should the file be called?', 'single', true], ['Where should it go?', 'multiple', true],
      ]);
      expect(block.questions[0]!.options[0]).toEqual({ id: 'report', label: 'report', description: 'A generic report' });
      expect(s.view().turns.at(-1)).toMatchObject({ role: 'agent', activity: { label: 'Waiting for your answers' } });
      s.answerQuestions(block.id, { 'What should the file be called?': 'my-own-name', 'Where should it go?': ['src', 'docs'] });
      await pending;
      expect(JSON.parse(replyOf(s))).toEqual({ outcome: 'accepted', answers: { 'What should the file be called?': 'my-own-name', 'Where should it go?': ['src', 'docs'] } });
      // The card stays in the transcript as the record, and is persisted
      const record = questionBlocks(s)[0]!;
      expect(record).toMatchObject({ outcome: 'answered', answers: { 'What should the file be called?': 'my-own-name' } });
      expect(s.toRecord().turns.flatMap(t => t.role === 'agent' ? t.blocks : []).some(b => b.type === 'question' && b.outcome === 'answered')).toBe(true);
      const tool = s.view().turns.flatMap(t => t.role === 'agent' ? t.blocks : []).find(b => b.type === 'tool_call');
      expect(tool).toMatchObject({ verbKey: 'verb.ask', status: 'completed' });
      expect(tool && 'target' in tool ? tool.target : undefined).toBeUndefined();
    } finally { s.dispose(); }
  });

  it('Grok: skip sends skip_interview with whatever was answered', async () => {
    const s = session();
    try {
      await s.start();
      const pending = s.prompt('ask-grok');
      await until(() => !!pendingQuestion(s));
      const block = pendingQuestion(s)!;
      s.answerQuestions(block.id, { 'What should the file be called?': 'report', 'Where should it go?': [] }, true);
      await pending;
      expect(JSON.parse(replyOf(s))).toEqual({ outcome: 'skip_interview', partial_answers: { 'What should the file be called?': 'report' } });
      expect(questionBlocks(s)[0]).toMatchObject({ outcome: 'skipped', answers: { 'What should the file be called?': 'report' } });
    } finally { s.dispose(); }
  });

  it('Devin: the form without toolCallId is enriched from the tool input and answered typed', async () => {
    const s = session();
    try {
      await s.start();
      const pending = s.prompt('ask-devin');
      await until(() => !!pendingQuestion(s));
      const block = pendingQuestion(s)!;
      expect(block.toolCallId).toBeUndefined();
      expect(block.message).toBeUndefined();
      expect(block.questions[0]).toMatchObject({ id: 'q0', title: 'Name', text: 'What should the file be called?', kind: 'single', other: true, required: true,
        options: [{ id: 'report', label: 'report', description: 'A generic report' }, { id: 'notes', label: 'notes', description: 'Loose notes' }] });
      expect(block.questions[1]).toMatchObject({ id: 'q1', kind: 'multiple', options: [{ id: 'src', label: 'src' }, { id: 'docs', label: 'docs' }] });
      s.answerQuestions(block.id, { q0: 'report', q1: ['docs'] });
      await pending;
      expect(JSON.parse(replyOf(s))).toEqual({ action: 'accept', content: { q0: 'report', q1: ['docs'] } });
    } finally { s.dispose(); }
  });

  it('Kimi: question texts come from the message; skipping an untouched form declines it', async () => {
    const s = session();
    try {
      await s.start();
      const pending = s.prompt('ask-kimi');
      await until(() => !!pendingQuestion(s));
      const block = pendingQuestion(s)!;
      expect(block.toolCallId).toBe('ask1');
      expect(block.questions.map(q => q.text)).toEqual(['What should the file be called?', 'Where should it go?']);
      expect(block.questions.every(q => !q.other)).toBe(true);
      s.answerQuestions(block.id, {}, true);
      await pending;
      expect(JSON.parse(replyOf(s))).toEqual({ action: 'decline' });
      expect(questionBlocks(s)[0]).toMatchObject({ outcome: 'skipped' });
      expect(questionBlocks(s)[0]!.answers).toBeUndefined();
    } finally { s.dispose(); }
  });

  it('a partially answered form is accepted as far as it goes even when skipped', async () => {
    const s = session();
    try {
      await s.start();
      const pending = s.prompt('ask-devin');
      await until(() => !!pendingQuestion(s));
      s.answerQuestions(pendingQuestion(s)!.id, { q0: 'something else' }, true);
      await pending;
      expect(JSON.parse(replyOf(s))).toEqual({ action: 'accept', content: { q0: 'something else' } });
    } finally { s.dispose(); }
  });

  it('stopping the turn closes the card as cancelled and answers the agent', async () => {
    const s = session();
    try {
      await s.start();
      const pending = s.prompt('ask-kimi');
      await until(() => !!pendingQuestion(s));
      await s.cancel();
      await pending;
      expect(questionBlocks(s)[0]).toMatchObject({ outcome: 'cancelled' });
      expect(pendingQuestion(s)).toBeUndefined();
      expect(s.view().running).toBe(false);
      // A late answer for the closed card is ignored
      s.answerQuestions(questionBlocks(s)[0]!.id, { q0: 'report' });
      expect(questionBlocks(s)[0]!.answers).toBeUndefined();
    } finally { s.dispose(); }
  });
});
