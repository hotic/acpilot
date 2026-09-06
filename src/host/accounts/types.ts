import type { AgentId } from '@shared/transcript';
import type { AgentProcess } from '../acp/AgentProcess';

// Credential = secret + non-secret companion fields (service URL, etc.). The secret appears only in SecretStorage and in the ACP authenticate request
export interface AccountCredential {
  secret: string;
  meta?: Record<string, string>;
}

export interface AccountDraft extends AccountCredential {
  label: string;
  detail?: string;
}

// Terminal login flow: run the CLI's login command in an isolated directory and collect the credential once written; the local login is unaffected
export interface LoginFlow {
  command: string;
  args: string[];
  // null means the variable must be removed from the terminal environment
  env: Record<string, string | null>;
  // Wait until the login writes to disk (or the signal aborts); clean up the isolated directory once obtained
  collect(signal: AbortSignal): Promise<AccountDraft | undefined>;
}

// Account adaptation for one agent: where the credential comes from and how it's handed to the ACP process.
// Common pattern of OAuth-style CLIs: login yields a long-lived key; multiple accounts = multiple keys stored separately, and one is picked and handed over at process spawn
export interface AccountProvider {
  readonly agent: AgentId;
  // Read the CLI's own local login (the user has already logged in via a terminal)
  importLocal(): Promise<AccountDraft | undefined>;
  login(): Promise<LoginFlow>;
  // Environment variables injected before spawn (for CLIs that isolate identity via directories / variables)
  spawnEnv?(cred: AccountCredential): Record<string, string>;
  // Hand the credential to the agent after initialize and before session/new
  authenticate?(proc: AgentProcess, cred: AccountCredential): Promise<void>;
}
