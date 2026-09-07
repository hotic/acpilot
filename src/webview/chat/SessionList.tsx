import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Pencil, Pin, PinOff, Search, Trash2 } from 'lucide-react';
import type { AgentInfo, SessionSummary } from '@shared/transcript';
import { cn } from '../ui/cn';
import { t } from '../i18n';
import { AgentMark } from './AgentMark';

const STATE_DOT: Record<NonNullable<SessionSummary['state']>, string> = {
  working: 'bg-accent animate-[acp-pulse_1.8s_ease-in-out_infinite]',
  waiting: 'bg-warn',
  unread: 'bg-fg-2',
  error: 'bg-danger',
};

export interface SessionListProps {
  sessions: SessionSummary[];
  agents: AgentInfo[];
  activeId?: string;
  // When opened in an overlay the search box auto-focuses; the drawer is permanent and doesn't steal focus
  autoFocus?: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}

// Session list: search and agent filters stay visible even without history; pinned sessions get their own section, the rest is one flat list.
// Each item: vendor mark · title · time; on hover those swap for three actions — pin / rename / delete. Deletion applies immediately, undo lives on the Toast at the shell's bottom
export function SessionList({ sessions, agents, activeId, autoFocus, onSelect, onRename, onDelete, onPin }: SessionListProps) {
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState<string>();
  const [editing, setEditing] = useState<string>();
  const nameOf = (id: string) => agents.find(a => a.id === id)?.name ?? id;

  const q = query.trim().toLowerCase();
  const shown = sessions.filter(s => (!agentFilter || s.agent === agentFilter) && (!q || s.title.toLowerCase().includes(q) || nameOf(s.agent).toLowerCase().includes(q)));

  const now = new Date();
  const dayOf = (iso: string) => Math.floor((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  const pinned = shown.filter(s => s.pinned);
  const rest = shown.filter(s => !s.pinned);

  const renderItem = (s: SessionSummary) => (
    <Item
      key={s.id}
      session={s}
      agentName={nameOf(s.agent)}
      active={s.id === activeId}
      time={fmtTime(s.updatedAt, dayOf(s.updatedAt))}
      editing={editing === s.id}
      onSelect={() => onSelect(s.id)}
      onEdit={() => setEditing(s.id)}
      onRename={t => { setEditing(undefined); if (t.trim() && t.trim() !== s.title) onRename(s.id, t); }}
      onDelete={() => { setEditing(undefined); onDelete(s.id); }}
      onPin={() => onPin(s.id, !s.pinned)}
    />
  );

  return (
    <div className="flex max-h-[60vh] flex-col" onKeyDown={e => { if (e.key === 'Escape' && editing) { e.stopPropagation(); setEditing(undefined); } }}>
      <div className="flex items-center gap-1 px-1 pt-1">
        <label className="flex h-ctl min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-fg-3 focus-within:bg-hover">
          <Search className="size-icon shrink-0" strokeWidth={1.5} />
          <input
            autoFocus={autoFocus}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('session.search')}
            aria-label={t('session.search')}
            className="min-w-0 flex-1 bg-transparent text-2 text-fg-1 outline-none placeholder:text-fg-3"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1 px-1 pt-1">
        <FilterChip active={!agentFilter} onClick={() => setAgentFilter(undefined)}>{t('common.all')}</FilterChip>
        {agents.map(a => (
          <FilterChip key={a.id} active={agentFilter === a.id} onClick={() => setAgentFilter(a.id)}>
            <AgentMark id={a.id} name={a.name} className="size-3" />{a.name}
          </FilterChip>
        ))}
      </div>
      <div className="mt-1 flex min-h-0 flex-col overflow-y-auto border-t border-line pb-1" role="listbox" aria-label={t('session.listAria')}>
        {!shown.length && <div className="px-2 py-3 text-3 text-fg-3">{q ? t('session.noMatch') : agentFilter ? t('session.noneAgent', { name: nameOf(agentFilter) }) : t('session.none')}</div>}
        {pinned.length > 0 && (
          <div className="flex flex-col">
            <div className="px-2 pt-2.5 pb-1 text-3 text-fg-3">{t('session.group.pinned')}</div>
            {pinned.map(renderItem)}
          </div>
        )}
        <div className="flex flex-col pt-1">{rest.map(renderItem)}</div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('inline-flex h-[calc(var(--ctl)-4px)] items-center gap-1 rounded-md px-2 text-3 transition-colors', active ? 'bg-active text-fg-1' : 'text-fg-2 hover:bg-hover hover:text-fg-1 focus-visible:bg-hover focus-visible:text-fg-1')}
    >
      {children}
    </button>
  );
}

interface ItemProps {
  session: SessionSummary;
  agentName: string;
  active: boolean;
  time: string;
  editing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
  onPin: () => void;
}

// One item: the whole row is clickable to select; the tail shows a status dot + time by default, swapping to actions on hover / keyboard focus. Action buttons can't nest inside a button, so the whole row is a div[role=option]
function Item({ session: s, agentName, active, time, editing, onSelect, onEdit, onRename, onDelete, onPin }: ItemProps) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
  };
  const act = 'inline-flex size-lead items-center justify-center rounded-sm text-fg-3 transition-colors hover:bg-active hover:text-fg-1 focus-visible:bg-active focus-visible:text-fg-1';
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={() => { if (!editing) onSelect(); }}
      onKeyDown={onKey}
      className={cn(
        'group flex min-h-row cursor-pointer items-center gap-gap rounded-md px-2 text-2 text-fg-2 transition-colors hover:bg-hover hover:text-fg-1 focus-visible:bg-hover',
        active && 'bg-active text-fg-strong hover:bg-active',
      )}
    >
      <span className="flex size-lead shrink-0 items-center justify-center text-fg-3" title={agentName}><AgentMark id={s.agent} name={agentName} /></span>
      {editing
        ? <RenameInput initial={s.title} onDone={onRename} />
        : <span className="min-w-0 flex-1 truncate">{s.title}</span>}
      {!editing && (
        <span className="ml-auto flex shrink-0 items-center text-3 text-fg-3 tabular-nums">
          <span className="flex items-center gap-2 group-hover:hidden group-focus-within:hidden">
            {s.state && <span className={cn('size-1.5 rounded-full', STATE_DOT[s.state])} />}
            <span>{time}</span>
          </span>
          <span className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
            <button type="button" title={s.pinned ? t('common.unpin') : t('common.pin')} aria-label={s.pinned ? t('common.unpin') : t('common.pin')} onClick={e => { e.stopPropagation(); onPin(); }} className={act}>
              {s.pinned ? <PinOff className="size-3" strokeWidth={1.5} /> : <Pin className="size-3" strokeWidth={1.5} />}
            </button>
            <button type="button" title={t('common.rename')} aria-label={t('common.rename')} onClick={e => { e.stopPropagation(); onEdit(); }} className={act}>
              <Pencil className="size-3" strokeWidth={1.5} />
            </button>
            <button type="button" title={t('common.delete')} aria-label={t('common.delete')} onClick={e => { e.stopPropagation(); onDelete(); }} className={act}>
              <Trash2 className="size-3" strokeWidth={1.5} />
            </button>
          </span>
        </span>
      )}
    </div>
  );
}

// Inline rename: ⏎ commits, Esc cancels, blur commits; the callback fires only once (the blur right after Esc doesn't count)
function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const [value, setValue] = useState(initial);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (v: string) => { if (done.current) return; done.current = true; onDone(v); };
  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(value);
        if (e.key === 'Escape') finish(initial);
      }}
      onBlur={() => finish(value)}
      aria-label={t('session.titleAria')}
      className="min-w-0 flex-1 rounded-sm bg-active px-1 text-2 text-fg-1 outline-none"
    />
  );
}

function startOfDay(d: Date) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

// Today shows the time of day, earlier shows month/day
function fmtTime(iso: string, dayAgo: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (dayAgo <= 0) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
