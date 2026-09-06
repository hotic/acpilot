import type { AgentId } from './transcript';
import type { McpTransport } from './settings';

// What the settings page shows per agent: where its executable is, what its own config files declare (MCP servers / skills / rules).
// Read-only: ACPilot lists and opens these files, it never writes them

export type InventoryScope = 'user' | 'project';

export interface InventoryFile {
  path: string;
  scope: InventoryScope;
  exists: boolean;
  // Bytes; only when it exists
  size?: number;
}

export interface InventoryMcp {
  name: string;
  transport: McpTransport;
  // Command line (stdio) or URL (http / sse), for display
  target: string;
  // The config file it was declared in
  source: string;
  scope: InventoryScope;
  enabled: boolean;
}

export interface InventorySkill {
  name: string;
  description?: string;
  // The SKILL.md
  path: string;
  scope: InventoryScope;
}

// Runtime facts known only from a live process's initialize response; absent until a session of that agent has been opened
export interface AgentRuntimeInfo {
  name?: string;
  version?: string;
  mcp?: { http: boolean; sse: boolean };
}

export interface AgentInventory {
  agent: AgentId;
  // Resolved executable; null when not found
  binary: string | null;
  runtime?: AgentRuntimeInfo;
  // Whether a second session/prompt mid-turn steers the running turn (registry knowledge, see FollowUp)
  steer: boolean;
  config: InventoryFile[];
  mcp: InventoryMcp[];
  skills: InventorySkill[];
  rules: InventoryFile[];
  scannedAt: string;
}
