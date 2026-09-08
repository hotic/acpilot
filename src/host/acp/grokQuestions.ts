import * as acp from '@agentclientprotocol/sdk';

// Grok 1.0.18 asks structured questions over a private request, not elicitation/create. Verified on the wire (scripts/probe-questions.ts):
// the request carries the tool's own input (question text, options with label / description, multiSelect) plus the session mode;
// the response is an internally tagged enum on `outcome`. `accepted` answers are keyed by question text — an option label, a free string,
// or a list for multi-select; questions left out are simply not reported to the model. `skip_interview` tells the model to proceed with what it has
// and lists `partial_answers` the same way; `chat_about_this` asks the model to find out what the user wants to clarify
export const GROK_ASK_QUESTION = '_x.ai/ask_user_question';

export interface GrokQuestionOption {
  label: string;
  description?: string;
}

export interface GrokQuestion {
  question: string;
  options: GrokQuestionOption[];
  multiSelect?: boolean;
}

export interface GrokQuestionRequest {
  sessionId: string;
  toolCallId: string;
  questions: GrokQuestion[];
  mode?: string;
}

export type GrokAnswers = Record<string, string | string[]>;

export type GrokQuestionResponse =
  | { outcome: 'accepted'; answers: GrokAnswers }
  | { outcome: 'skip_interview'; partial_answers?: GrokAnswers }
  | { outcome: 'chat_about_this'; partial_answers?: GrokAnswers };

export function parseGrokQuestion(value: unknown): GrokQuestionRequest {
  const p = value as Partial<GrokQuestionRequest> | null;
  if (!p || typeof p.sessionId !== 'string' || typeof p.toolCallId !== 'string' || !Array.isArray(p.questions)) {
    throw acp.RequestError.invalidParams(undefined, 'Invalid Grok question request');
  }
  const questions: GrokQuestion[] = [];
  for (const q of p.questions as unknown[]) {
    const item = q as Partial<GrokQuestion> | null;
    if (!item || typeof item.question !== 'string') throw acp.RequestError.invalidParams(undefined, 'Invalid Grok question');
    const options = Array.isArray(item.options)
      ? (item.options as unknown[]).flatMap(o => {
        const opt = o as Partial<GrokQuestionOption> | null;
        return opt && typeof opt.label === 'string' ? [{ label: opt.label, ...(typeof opt.description === 'string' && opt.description ? { description: opt.description } : {}) }] : [];
      })
      : [];
    questions.push({ question: item.question, options, ...(item.multiSelect ? { multiSelect: true } : {}) });
  }
  return { sessionId: p.sessionId, toolCallId: p.toolCallId, questions, ...(typeof p.mode === 'string' ? { mode: p.mode } : {}) };
}
