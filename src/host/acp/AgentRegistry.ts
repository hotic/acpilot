import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import type { AgentId, AgentInfo, SessionOption } from '@shared/transcript';
import { t } from '../i18n';

// How an ACP agent is launched: command, args, candidate binary paths, login command
export interface AgentDef {
  id: AgentId;
  name: string;
  command: string;
  args: string[];
  // Explicit candidate paths take precedence over PATH (a CLI installed under ~/.local/bin etc. may not be on a GUI process's PATH)
  candidates: string[];
  login?: { command: string; args: string[] };
  env?: Record<string, string>;
  // Modes the protocol doesn't advertise but the CLI actually supports (fills in when session/new returns empty modes); switching still goes through session/set_mode
  modes?: SessionOption[];
}

export const BUILTIN_AGENTS: AgentDef[] = [
  {
    id: 'grok', name: 'Grok Build',
    command: 'grok', args: ['agent', 'stdio'],
    candidates: ['~/.grok/bin/grok', '~/.local/bin/grok', '/opt/homebrew/bin/grok', '/usr/local/bin/grok'],
    login: { command: 'grok', args: ['login'] },
    // Grok doesn't give modes in session/new, but CLI ≥ 0.2.117 accepts session/set_mode (verified in probe-set-mode.ts):
    // default / plan go through the protocol; yolo is host-side auto-approval of permission requests, and the CLI stays in default.
    // The descriptions are i18n keys, resolved against the host locale when the modes enter a session
    modes: [
      { id: 'default', name: 'Agent', description: 'mode.grok.default' },
      { id: 'plan', name: 'Plan', description: 'mode.grok.plan' },
      { id: 'yolo', name: 'Auto accept', description: 'mode.grok.yolo' },
    ],
  },
  {
    id: 'devin', name: 'Devin',
    command: 'devin', args: ['acp'],
    // Devin Desktop bundles its own CLI; use it when devin-cli isn't installed separately
    candidates: [
      '~/.local/bin/devin', '/opt/homebrew/bin/devin', '/usr/local/bin/devin',
      '/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin',
    ],
    login: { command: 'devin', args: ['auth', 'login'] },
    // An ACP service with ACP_BACKEND set accepts only the credential the host hands over and ignores the local login (the Windsurf inside Devin.app launches it the same way),
    // so the account layer becomes the sole source of credentials, and it's obvious which account the usage is billed to
    env: { ACP_BACKEND: 'windsurf' },
  },
  {
    id: 'kimi', name: 'Kimi Code',
    command: 'kimi', args: ['acp'],
    candidates: ['~/.local/bin/kimi', '~/.kimi-code/bin/kimi', '/opt/homebrew/bin/kimi', '/usr/local/bin/kimi'],
    // Kimi's login is /login typed inside the TUI; launching kimi in a terminal is enough
    login: { command: 'kimi', args: [] },
  },
];

// Custom agents from the acpilot.agents setting (id → definition fragment)
export interface CustomAgentSetting {
  name?: string;
  command: string;
  args?: string[];
  login?: string;
  env?: Record<string, string>;
  // Modes the protocol doesn't advertise but the CLI supports (same as AgentDef.modes)
  modes?: SessionOption[];
}

export class AgentRegistry {
  private defs = new Map<AgentId, AgentDef>();
  private resolved = new Map<AgentId, string>();
  private probed = false;

  constructor(custom: Record<string, CustomAgentSetting> = {}) {
    for (const d of BUILTIN_AGENTS) this.defs.set(d.id, d);
    for (const [id, c] of Object.entries(custom)) {
      if (!c?.command) continue;
      const login = c.login?.trim().split(/\s+/);
      this.defs.set(id, {
        id, name: c.name ?? id, command: c.command, args: c.args ?? [], candidates: [], env: c.env, modes: c.modes,
        login: login?.length ? { command: login[0]!, args: login.slice(1) } : undefined,
      });
    }
  }

  // Only after a probe pass can we claim available; unprobed agents aren't marked, so the menu doesn't flicker grey before lighting up
  list(): AgentInfo[] {
    return [...this.defs.values()].map(d => ({ id: d.id, name: d.name, ...(this.probed ? { available: this.resolved.has(d.id) } : {}) }));
  }

  // Locate every agent's executable in one pass; afterwards list() carries available
  async probeAll(): Promise<void> {
    await Promise.all([...this.defs.keys()].map(id => this.resolveBinary(id)));
    this.probed = true;
  }

  get(id: AgentId): AgentDef {
    const d = this.defs.get(id);
    if (!d) throw new Error(t('host.unknownAgent', { id }));
    return d;
  }

  // Find the executable: explicit candidates → PATH; returns null if not found (the UI then prompts to install)
  async resolveBinary(id: AgentId): Promise<string | null> {
    const cached = this.resolved.get(id);
    if (cached) return cached;
    const def = this.get(id);
    const found = await resolveCommand(def.command, def.candidates);
    if (found) this.resolved.set(id, found);
    return found;
  }
}

export async function resolveCommand(command: string, candidates: string[] = []): Promise<string | null> {
  if (isAbsolute(command)) return (await executable(command)) ? command : null;
  for (const c of candidates) {
    const p = expandHome(c);
    if (await executable(p)) return p;
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const p = join(dir, command);
    if (await executable(p)) return p;
  }
  return null;
}

export function expandHome(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

async function executable(p: string): Promise<boolean> {
  try { await access(p, constants.X_OK); return true; } catch { return false; }
}
