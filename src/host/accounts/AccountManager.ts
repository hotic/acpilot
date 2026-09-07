import type { AccountInfo, AgentId } from '@shared/transcript';
import type { AgentProcess } from '../acp/AgentProcess';
import type { AccountStore } from './AccountStore';
import type { AccountProvider } from './types';
import { t } from '../i18n';

export interface AccountManagerDeps {
  store: AccountStore;
  providers: AccountProvider[];
  log: (line: string) => void;
  // Terminal login: open a terminal on the host with the given environment variables and run the command
  runInTerminal: (title: string, command: string, args: string[], env?: Record<string, string | null>) => void;
  toast: (level: 'info' | 'error', text: string) => void;
}

// A terminal login gets this long; past the timeout it's treated as abandoned
const LOGIN_TIMEOUT = 10 * 60_000;

// Account master: who supports the account layer, the list, import / login / removal, plus the two hooks for AcpSession (spawn env, authenticate)
export class AccountManager {
  private providers = new Map<AgentId, AccountProvider>();
  private listeners = new Set<(accounts: AccountInfo[]) => void>();

  constructor(private deps: AccountManagerDeps) {
    for (const p of deps.providers) this.providers.set(p.agent, p);
  }

  supports(agent: AgentId): boolean { return this.providers.has(agent); }

  list(): AccountInfo[] { return this.deps.store.list(); }

  get(id: string): AccountInfo | undefined { return this.deps.store.get(id); }

  defaultFor(agent: AgentId): AccountInfo | undefined { return this.deps.store.defaultFor(agent); }

  subscribe(fn: (accounts: AccountInfo[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() { const list = this.list(); for (const fn of this.listeners) fn(list); }

  private provider(agent: AgentId): AccountProvider {
    const p = this.providers.get(agent);
    if (!p) throw new Error(t('host.noAccountLayer', { agent }));
    return p;
  }

  async import(agent: AgentId): Promise<AccountInfo | undefined> {
    const draft = await this.provider(agent).importLocal();
    if (!draft) { this.deps.toast('info', t('host.noLocalLogin', { agent })); return undefined; }
    const a = await this.deps.store.add(agent, draft);
    this.deps.log(`account imported: ${agent} ${a.label}`);
    this.deps.toast('info', t('host.imported', { label: a.label }));
    this.emit();
    return a;
  }

  // The "+" in the menu: if the local login hasn't been imported yet, import it first (one step); if already imported or there's no local login, go log a new one in a terminal
  async add(agent: AgentId): Promise<AccountInfo | undefined> {
    const draft = await this.provider(agent).importLocal();
    if (draft && !this.list().some(a => a.agent === agent && a.label === draft.label)) {
      const a = await this.deps.store.add(agent, draft);
      this.deps.log(`account imported: ${agent} ${a.label}`);
      this.deps.toast('info', t('host.imported', { label: a.label }));
      this.emit();
      return a;
    }
    return this.login(agent);
  }

  // Open a terminal for the isolated login and wait for it to write to disk in the background; store the result once it arrives. Does not block the caller
  async login(agent: AgentId): Promise<AccountInfo | undefined> {
    const flow = await this.provider(agent).login();
    this.deps.runInTerminal(t('host.loginTerminalTitle', { agent }), flow.command, flow.args, flow.env);
    this.deps.toast('info', t('host.finishLoginInTerminal'));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LOGIN_TIMEOUT);
    try {
      const draft = await flow.collect(ctrl.signal);
      if (!draft) { this.deps.toast('info', t('host.loginIncomplete')); return undefined; }
      const a = await this.deps.store.add(agent, draft);
      this.deps.log(`account login: ${agent} ${a.label}`);
      this.deps.toast('info', t('host.accountAdded', { label: a.label }));
      this.emit();
      return a;
    } finally { clearTimeout(timer); }
  }

  async remove(id: string) {
    await this.deps.store.remove(id);
    this.emit();
  }

  async touch(id: string) { await this.deps.store.touch(id); }

  // AcpSession hook: environment variables before spawn
  async spawnEnv(agent: AgentId, accountId: string): Promise<Record<string, string> | undefined> {
    const p = this.providers.get(agent);
    if (!p?.spawnEnv) return undefined;
    const cred = await this.deps.store.credential(accountId);
    return cred ? p.spawnEnv(cred) : undefined;
  }

  // AcpSession hook: hand the credential to the agent after initialize; if the account or secret is gone, throw so the session enters auth_required
  async authenticate(agent: AgentId, accountId: string, proc: AgentProcess): Promise<void> {
    const p = this.providers.get(agent);
    if (!p?.authenticate) return;
    const cred = await this.deps.store.credential(accountId);
    if (!cred) throw new Error(t('host.credentialGone', { label: this.get(accountId)?.label ?? accountId }));
    await p.authenticate(proc, cred);
    await this.touch(accountId);
  }
}
