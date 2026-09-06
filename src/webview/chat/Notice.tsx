import type { AccountInfo, AgentInfo, AuthMethodInfo, SessionStatus } from '@shared/transcript';
import type { AddAccountVia } from '@shared/protocol';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Row } from '../ui/Row';
import { Orb } from '../effects/Orb';

export interface NoticeProps {
  status: SessionStatus;
  error?: string;
  agent: AgentInfo;
  authMethods?: AuthMethodInfo[];
  // Accounts saved for this agent (only for agents on the account layer) and the one bound to the current session
  accounts?: AccountInfo[];
  accountId?: string;
  onLogin: (methodId?: string) => void;
  onRetry: () => void;
  onNewSession: () => void;
  onSelectAccount: (id: string) => void;
  onAddAccount: (via: AddAccountVia) => void;
}

// A bar pinned above the composer while the session isn't ready: connecting / login required / error / read-only. Renders nothing when ready.
// For agents on the account layer, the main login paths are "import the local CLI login / sign in a new account in the terminal" — credentials from these two are saved;
// the agent's own browser login only authenticates this one process and isn't saved, so it's labeled as this-session-only
export function Notice({ status, error, agent, authMethods, accounts, accountId, onLogin, onRetry, onNewSession, onSelectAccount, onAddAccount }: NoticeProps) {
  if (status === 'ready') return null;
  if (status === 'starting') {
    return <Row lead={<Orb kind="fetch" />} className="px-page"><span className="shimmer">正在连接 {agent.name}…</span></Row>;
  }
  const withAccounts = !!agent.accounts;
  const others = (accounts ?? []).filter(a => a.id !== accountId);
  const body = status === 'auth_required'
    ? {
        title: `需要登录 ${agent.name}`,
        text: error ?? (withAccounts
          ? '导入本机 CLI 已有的登录，或在终端登录一个新账号；凭据只存在本机钥匙串里'
          : authMethods?.length ? '选一种方式登录，完成后重试' : '在终端完成登录后重试'),
      }
    : status === 'readonly'
      ? { title: '只读历史', text: error ?? '这个 agent 恢复不了老会话' }
      : status === 'closed'
        ? { title: '会话已关闭', text: '进程已结束' }
        : { title: '出错了', text: error ?? '未知错误' };
  return (
    <div className="px-page pt-2">
      <Card className="flex flex-col gap-gap p-pad">
        <div className="text-2 font-semibold text-fg-strong">{body.title}</div>
        <p className="m-0 text-2 text-fg-2 [overflow-wrap:anywhere]">{body.text}</p>
        <div className="mt-0.5 flex flex-wrap justify-end gap-2">
          {status === 'auth_required' && withAccounts && (
            <>
              {others.map(a => <Button key={a.id} variant="secondary" title={a.detail} onClick={() => onSelectAccount(a.id)}>用 {a.label}</Button>)}
              <Button variant="primary" onClick={() => onAddAccount('import')}>导入 CLI 登录</Button>
              <Button variant="secondary" onClick={() => onAddAccount('login')}>在终端登录</Button>
              {authMethods?.map(m => <Button key={m.id} variant="ghost" title={m.description} onClick={() => onLogin(m.id)}>{m.name}（仅本次）</Button>)}
            </>
          )}
          {status === 'auth_required' && !withAccounts && (authMethods?.length
            ? authMethods.map((m, i) => <Button key={m.id} variant={i === 0 ? 'primary' : 'secondary'} title={m.description} onClick={() => onLogin(m.id)}>{m.name}</Button>)
            : <Button variant="primary" onClick={() => onLogin()}>去登录</Button>)}
          {status === 'readonly' || status === 'closed'
            ? <Button variant="primary" onClick={onNewSession}>新会话继续</Button>
            : <Button variant={status === 'auth_required' ? 'ghost' : 'primary'} onClick={onRetry}>重试</Button>}
        </div>
      </Card>
    </div>
  );
}
