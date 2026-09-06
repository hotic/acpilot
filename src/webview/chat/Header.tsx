import { History, Menu as MenuIcon, Plus } from 'lucide-react';
import type { AgentInfo, SessionSummary } from '@shared/transcript';
import { useAppearance } from '../appearance';
import { IconButton } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { SessionList } from './SessionList';
import type { ShellHandlers } from './Shell';

export interface HeaderProps {
  title: string;
  sessions: SessionSummary[];
  agents: AgentInfo[];
  activeSessionId?: string;
  on: Pick<ShellHandlers, 'selectSession' | 'newSession' | 'renameSession' | 'deleteSession' | 'pinSession'>;
  onToggleDrawer?: () => void;
}

// Header: a plain text title on the left (sharing the conversation flow's left edge), a clock icon for session history and a plus for new session on the right
// (the common layout of Claude Code / Codex / Cursor); one divider below. The drawer axis swaps the left side for a menu button
export function Header({ title, sessions, agents, activeSessionId, on, onToggleDrawer }: HeaderProps) {
  const { sessions: mode } = useAppearance();
  return (
    <div className="flex h-hdr shrink-0 items-center gap-gap px-page shadow-[inset_0_-1px_0_0_var(--line)]">
      {mode === 'drawer'
        ? (
          <button type="button" onClick={onToggleDrawer} className="-ml-2 inline-flex h-ctl min-w-0 items-center gap-1.5 rounded-md px-2 text-2 font-medium text-fg-strong transition-colors hover:bg-hover focus-visible:bg-hover">
            <MenuIcon className="size-icon shrink-0 text-fg-3" strokeWidth={1.75} />
            <span className="truncate">{title}</span>
          </button>
        )
        : (
          <>
            <span className="min-w-0 flex-1 truncate text-2 font-medium text-fg-strong">{title}</span>
            {/* The icon is 6px smaller than the button box; the negative margin makes the right edge of the last icon bite into the page-margin line */}
            <div className="-mr-1.5 flex shrink-0 items-center gap-0.5">
              <Popover side="bottom" align="end" width="xl" content={close => (
                <SessionList
                  sessions={sessions}
                  agents={agents}
                  activeId={activeSessionId}
                  autoFocus
                  onSelect={id => { on.selectSession(id); close(); }}
                  onNew={() => { on.newSession(); close(); }}
                  onRename={on.renameSession}
                  onDelete={on.deleteSession}
                  onPin={on.pinSession}
                />
              )}>
                {({ open, toggle, ref }) => (
                  <IconButton ref={ref} data-open={open || undefined} onClick={toggle} title="历史会话" aria-label="历史会话" className="data-[open]:bg-active data-[open]:text-fg-1">
                    <History strokeWidth={1.5} />
                  </IconButton>
                )}
              </Popover>
              <IconButton onClick={() => on.newSession()} title="新会话" aria-label="新会话">
                <Plus strokeWidth={1.5} />
              </IconButton>
            </div>
          </>
        )}
    </div>
  );
}
