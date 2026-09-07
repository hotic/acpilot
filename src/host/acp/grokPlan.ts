import * as acp from '@agentclientprotocol/sdk';
import { t } from '../i18n';

export const GROK_EXIT_PLAN = '_x.ai/exit_plan_mode';

export interface GrokExitPlanRequest {
  sessionId: string;
  toolCallId: string;
  planContent?: string;
}

export function parseGrokExitPlan(value: unknown): GrokExitPlanRequest {
  const p = value as Partial<GrokExitPlanRequest> | null;
  if (!p || typeof p.sessionId !== 'string' || typeof p.toolCallId !== 'string'
    || (p.planContent != null && typeof p.planContent !== 'string')) {
    throw acp.RequestError.invalidParams(undefined, 'Invalid Grok plan approval');
  }
  return { sessionId: p.sessionId, toolCallId: p.toolCallId, planContent: p.planContent ?? undefined };
}

// Grok 1.0.18 uses a private request, not session/request_permission.
// Its response is { outcome }, not { approved: boolean }; verified on the wire.
export async function approveGrokPlan(
  req: GrokExitPlanRequest, signal: AbortSignal,
  permission: (req: acp.RequestPermissionRequest, signal: AbortSignal) => Promise<acp.RequestPermissionResponse>,
) {
  const r = await permission({
    sessionId: req.sessionId,
    toolCall: { toolCallId: req.toolCallId, title: 'exit_plan_mode', rawInput: { planContent: req.planContent }, _meta: { 'acpilot/planApproval': true } },
    options: [
      { optionId: 'approved', name: 'Build', kind: 'allow_once' },
      { optionId: 'rejected', name: t('plan.revise'), kind: 'reject_once' },
    ],
  }, signal);
  return { outcome: r.outcome.outcome === 'selected' ? r.outcome.optionId : 'rejected' };
}
