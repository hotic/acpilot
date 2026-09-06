import { useEffect, useState } from 'react';
import { TriangleAlert, X } from 'lucide-react';
import type { AgentTurn, TurnStop } from '@shared/transcript';
import { Card } from '../ui/Card';
import { Button, IconButton } from '../ui/Button';

export interface AlertProps {
  turn: AgentTurn;
  // Send the same prompt again (error) / ask the agent to carry on (limits)
  onRetry: () => void;
  onContinue: () => void;
  onDismiss: () => void;
}

// A turn stopped short (the same card Cursor pins above its composer, in our own tones): one row holds a colorless glyph, what happened,
// the copyable detail, and the action — send it again for an error, carry on for a limit, nothing for a refusal — with ✕ hiding the card
// (the transcript keeps the row); the agent's words sit below in small type when there are any
export function Alert({ turn, onRetry, onContinue, onDismiss }: AlertProps) {
  const stop = turn.stop as ShortStop;
  const err = turn.error;
  const detail = [err?.code !== undefined ? String(err.code) : '', err?.kind ?? ''].filter(Boolean).join(' · ');
  const copyable = [err?.message, detail].filter(Boolean).join('\n');
  const message = stop === 'error' ? err?.message || 'agent 没有说明原因，日志里可能有更多信息' : TEXT[stop];
  return (
    <div className="px-page pt-2">
      <Card role="alert" className="flex flex-col gap-1.5 px-pad py-2.5">
        <div className="flex items-center gap-2">
          <TriangleAlert className="size-icon shrink-0 text-fg-3" strokeWidth={1.75} />
          <span className="shrink-0 text-2 font-medium text-fg-1">{TITLE[stop]}</span>
          {copyable && <CopyDetail text={copyable} label={detail} />}
          <span className="flex-1" />
          {stop === 'error' && <Button variant="primary" onClick={onRetry}>重试</Button>}
          {(stop === 'max_tokens' || stop === 'max_turn_requests') && <Button variant="primary" onClick={onContinue}>继续</Button>}
          <IconButton aria-label="关闭" onClick={onDismiss} className="-my-1 -mr-1.5"><X strokeWidth={1.5} /></IconButton>
        </div>
        {message && <p className="m-0 whitespace-pre-wrap text-3 text-fg-2 [overflow-wrap:anywhere]">{message}</p>}
      </Card>
    </div>
  );
}

type ShortStop = Exclude<TurnStop, 'end_turn' | 'cancelled'>;

const TITLE: Record<ShortStop, string> = {
  error: '请求失败',
  refusal: '模型拒绝了这次请求',
  max_tokens: '回复被截断',
  max_turn_requests: '达到单轮请求次数上限',
};

const TEXT: Record<ShortStop, string> = {
  error: '',
  refusal: 'agent 判定不能处理这条消息；换个说法，或者拆小一点再试',
  max_tokens: '这一轮达到了输出上限，让它接着说就行',
  max_turn_requests: '这一轮的工具调用次数到顶了，让它继续即可',
};

// Cursor's "Copy Request (id)": a faint text button that copies the whole detail and confirms for a moment; the visible label is the code · kind line when there is one
function CopyDetail({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const h = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(h);
  }, [copied]);
  return (
    <button
      type="button"
      className="min-w-0 truncate text-3 text-fg-3 transition-colors hover:text-fg-1 focus-visible:text-fg-1"
      onClick={() => { void navigator.clipboard.writeText(text).then(() => setCopied(true)); }}
    >
      {copied ? '已复制' : label ? `复制详情（${label}）` : '复制详情'}
    </button>
  );
}

// Whether this turn is one the card should stand up for: it ended short and the session is otherwise usable (a login problem has the Notice)
export function isShortStop(turn: AgentTurn | undefined): turn is AgentTurn & { stop: ShortStop } {
  return !!turn?.stop && turn.stop !== 'end_turn' && turn.stop !== 'cancelled';
}
