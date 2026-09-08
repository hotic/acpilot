import type { ClientContext } from '@agentclientprotocol/sdk';
import type { Usage } from '@shared/transcript';

export const GROK_SESSION_INFO = '_x.ai/session/info';
const INFO_TIMEOUT_MS = 5_000;

// PromptUsage is a spend ledger summed across model calls and subagents. Only
// the session-info context snapshot measures the live conversation window.
export function grokContextUsage(value: unknown, sessionId: string): Usage | undefined {
  const response = value as { result?: { sessionId?: unknown; context?: { used?: unknown; total?: unknown } } } | null;
  const result = response?.result;
  const context = result?.context;
  if (result?.sessionId !== sessionId || !context) return;
  const { used, total } = context;
  if (typeof used !== 'number' || !Number.isSafeInteger(used) || used < 0
    || typeof total !== 'number' || !Number.isSafeInteger(total) || total <= 0) return;
  // An overfull context remains visible; the UI handles the ring's upper bound.
  return { used, size: total };
}

export async function fetchGrokUsage(peer: ClientContext, sessionId: string): Promise<Usage | undefined> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      peer.request(GROK_SESSION_INFO, { sessionId }, { cancellationSignal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Grok context request timed out')); }, INFO_TIMEOUT_MS);
      }),
    ]);
    return grokContextUsage(result, sessionId);
  } finally { clearTimeout(timer); }
}
