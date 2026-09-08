import { History, Menu as MenuIcon, Plus, Settings2, UserRound } from 'lucide-react';
import type { AccountInfo, AgentInfo, SessionSummary } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { t } from '../i18n';
import { IconButton } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { Menu } from '../ui/Menu';
import { quotaSummary } from '../ui/QuotaBars';
import { AgentMark } from './AgentMark';
import { AgentPanel } from './AgentPanel';
import { SessionList } from './SessionList';
import type { ShellHandlers } from './Shell';

export interface HeaderProps {
  title: string;
  sessions: SessionSummary[];
  agent: AgentInfo;
  agents: AgentInfo[];
  // Accounts across all agents; the panel filters to the current agent's
  accounts?: AccountInfo[];
  accountId?: string;
  activeSessionId?: string;
  on: Pick<ShellHandlers, 'selectSession' | 'newSession' | 'renameSession' | 'deleteSession' | 'pinSession' | 'selectAgent' | 'selectAccount' | 'addAccount' | 'removeAccount' | 'refreshQuota'>;
  onToggleDrawer?: () => void;
  drawerOpen?: boolean;
  // Swaps the chat for the settings page (webview-local view state)
  onOpenSettings?: () => void;
}

// Header: a plain text title on the left (sharing the conversation flow's left edge), account / session history / new session icons on the right
// (the common layout of Claude Code / Codex / Cursor); one divider below. The drawer axis swaps the left side for a menu button.
// The person icon is the account layer's home (login state, switching, adding): it opens the agent panel, whose footer leads to the accounts page
export function Header({ title, sessions, agent, agents, accounts, accountId, activeSessionId, on, onToggleDrawer, onOpenSettings, drawerOpen }: HeaderProps) {
  const { sessions: mode } = useAppearance();
  const account = accounts?.find(a => a.id === accountId);
  // Tooltip: agent · account, with the remaining allowance appended once known ("Devin · s@x.io · Weekly 94%")
  const accountTitle = account ? [agent.name, account.label, account.quota && quotaSummary(account.quota)].filter(Boolean).join(' · ') : agent.name;
  const settingsButton = onOpenSettings && (
    <IconButton onClick={onOpenSettings} title={t('session.settings')} aria-label={t('session.settings')}>
      <Settings2 strokeWidth={1.5} />
    </IconButton>
  );
  const accountButton = (
    <Popover side="bottom" align="end" width="md" role="menu" content={close => (
      <AgentPanel
        agent={agent} agents={agents} accounts={accounts?.filter(a => a.agent === agent.id) ?? []} accountId={accountId} close={close}
        onSelectAgent={on.selectAgent} onSelectAccount={on.selectAccount} onAddAccount={on.addAccount} onRemoveAccount={on.removeAccount}
        onRefreshQuota={on.refreshQuota}
      />
    )}>
      {({ open, toggle, ref }) => (
        <IconButton
          ref={ref} data-open={open || undefined} onClick={toggle}
          title={accountTitle} aria-label={t('common.account')}
          className="data-[open]:bg-active data-[open]:text-fg-1"
        >
          <UserRound strokeWidth={1.5} />
        </IconButton>
      )}
    </Popover>
  );
  return (
    <div className="flex h-hdr shrink-0 items-center gap-gap px-page shadow-[inset_0_-1px_0_0_var(--line)]">
      {mode === 'drawer'
        ? (
          <>
            <button type="button" onClick={onToggleDrawer} aria-expanded={drawerOpen} className="-ml-2 inline-flex h-ctl min-w-0 items-center gap-1.5 rounded-md px-2 text-2 font-medium text-fg-strong transition-colors hover:bg-hover focus-visible:bg-hover">
              <MenuIcon className="size-icon shrink-0 text-fg-3" strokeWidth={1.75} />
              <span className="truncate">{title}</span>
            </button>
            <div className="-mr-1.5 ml-auto flex shrink-0 items-center gap-0.5">{accountButton}{settingsButton}</div>
          </>
        )
        : (
          <>
            <span className="min-w-0 flex-1 truncate text-2 font-medium text-fg-strong">{title}</span>
            {/* The icon is 6px smaller than the button box; the negative margin makes the right edge of the last icon bite into the page-margin line */}
            <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
              {/* New sessions start after choosing an agent from the plus menu. */}
              <Menu
                side="bottom" align="end" width="md"
                items={agents.map(a => ({ id: a.id, label: a.name, icon: <AgentMark id={a.id} name={a.name} />, disabled: a.available === false }))}
                onSelect={id => on.newSession(id)}
              >
                {({ open, toggle, ref }) => (
                  <IconButton
                    ref={ref} data-open={open || undefined} onClick={toggle}
                    title={t('session.new')} aria-label={t('session.new')} aria-haspopup="menu" aria-expanded={open}
                    className="data-[open]:bg-active data-[open]:text-fg-1"
                  >
                    <Plus strokeWidth={1.5} />
                  </IconButton>
                )}
              </Menu>
              <Popover side="bottom" align="end" width="xl" content={close => (
                <SessionList
                  sessions={sessions}
                  agents={agents}
                  activeId={activeSessionId}
                  autoFocus
                  onSelect={id => { on.selectSession(id); close(); }}
                  onRename={on.renameSession}
                  onDelete={on.deleteSession}
                  onPin={on.pinSession}
                />
              )}>
                {({ open, toggle, ref }) => (
                  <IconButton ref={ref} data-open={open || undefined} onClick={toggle} title={t('session.history')} aria-label={t('session.history')} className="data-[open]:bg-active data-[open]:text-fg-1">
                    <History strokeWidth={1.5} />
                  </IconButton>
                )}
              </Popover>
              {accountButton}
              {settingsButton}
            </div>
          </>
        )}
    </div>
  );
}
