import { useEffect, useState } from 'react';
import { ChevronLeft, Plus } from 'lucide-react';
import type { AccountInfo, AgentInfo } from '@shared/transcript';
import type { AddAccountVia } from '@shared/protocol';
import { MenuFooter, MenuHeader, MenuList } from '../ui/Popover';
import { QuotaBars } from '../ui/QuotaBars';
import { t } from '../i18n';
import { AgentMark } from './AgentMark';

export interface AgentPanelProps {
  agent: AgentInfo;
  agents: AgentInfo[];
  // Accounts of the current agent only
  accounts: AccountInfo[];
  accountId?: string;
  close: () => void;
  onSelectAgent: (id: AgentInfo['id']) => void;
  onSelectAccount: (id: string) => void;
  onAddAccount: (agent: AgentInfo['id'], via: AddAccountVia) => void;
  onRemoveAccount: (id: string) => void;
  // Called when the accounts page opens, so the quotas on its rows are fresh
  onRefreshQuota?: (agent: AgentInfo['id']) => void;
}

// Agent menu (modeled on Devin): the options area lists agents only, one row each with vendor mark + name + check; ones not installed locally are greyed out.
// Agents that go through the account layer show the current account in the footer (click to enter the accounts page) plus a "＋" (import from local login if never imported, otherwise go sign in a new one in the terminal).
// Accounts page: a sub-page with a navigation bar on top (back · agent name · "＋"), one account per row (removable on hover), no footer.
// An account row carries its quota bars under the label / plan line when the provider reports any (Devin: one per window the plan has)
export function AgentPanel(p: AgentPanelProps) {
  const [view, setView] = useState<'agents' | 'accounts'>('agents');
  const current = p.accounts.find(a => a.id === p.accountId);
  const add = { label: t('composer.addAccount'), icon: <Plus strokeWidth={1.75} />, onClick: () => { p.onAddAccount(p.agent.id, 'auto'); p.close(); } };
  const { onRefreshQuota, agent } = p;
  useEffect(() => { if (view === 'accounts') onRefreshQuota?.(agent.id); }, [view, agent.id, onRefreshQuota]);

  if (view === 'accounts') {
    return (
      <MenuList
        items={p.accounts.map(a => ({
          id: a.id, label: a.label, description: a.detail, checked: a.id === p.accountId, onRemove: () => p.onRemoveAccount(a.id),
          extra: a.quota && <QuotaBars quota={a.quota} />,
        }))}
        empty={t('composer.noAccounts')}
        onSelect={id => { p.onSelectAccount(id); p.close(); }}
        header={<MenuHeader lead={{ label: t('common.back'), icon: <ChevronLeft strokeWidth={1.75} />, onClick: () => setView('agents') }} action={add}>{p.agent.name}</MenuHeader>}
      />
    );
  }
  return (
    <MenuList
      items={p.agents.map(a => ({
        id: a.id, label: a.name, icon: <AgentMark id={a.id} name={a.name} />, checked: a.id === p.agent.id, disabled: a.available === false,
      }))}
      onSelect={id => { p.onSelectAgent(id); p.close(); }}
      footer={p.agent.accounts
        ? <MenuFooter onClick={() => setView('accounts')} action={add}>{current ? current.label : t('composer.notLoggedIn')}</MenuFooter>
        : undefined}
    />
  );
}
