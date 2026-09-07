// Normalized shape of the transcript: host-side normalize.ts reduces ACP session/update into these blocks; the webview only understands these

// Built-in devin / grok; custom ids can be added in acpilot.agents
export type AgentId = string;

export interface AgentInfo {
  id: AgentId;
  name: string;
  // Goes through the account layer (multiple logins can be stored and switched); agents without it rely on their own CLI's login
  accounts?: boolean;
  // An executable was detected locally; false greys it out in the menu, undefined means not probed yet
  available?: boolean;
}

// One allowance window as the vendor reports it (Devin: daily / weekly; a plan may hide either). remaining is 0..1, resetsAt an ISO timestamp
export interface QuotaWindow {
  id: string;
  remaining: number;
  resetsAt?: string;
}

// Usage allowance of an account, fetched from the vendor by the account provider; in memory only, refreshed after turns and on demand
export interface AccountQuota {
  windows: QuotaWindow[];
  fetchedAt: string;
}

// Account: one login identity of an agent. Only metadata here; secrets live in the host's SecretStorage and never enter the webview
export interface AccountInfo {
  id: string;
  agent: AgentId;
  // Primary label (email) and secondary label (plan · name)
  label: string;
  detail?: string;
  addedAt: string;
  lastUsedAt?: string;
  quota?: AccountQuota;
}

// Session-level options: modes come from modes.availableModes of session/new; the rest (model / reasoning level / …) are select-type configOptions —
// whatever ACP provides is what we show, we don't invent our own
export interface SessionOption {
  id: string;
  name: string;
  description?: string;
  // ACP group identity survives flattening; it need not represent a provider.
  group?: { id: string; name: string };
  // Verified by an agent adapter, never inferred from a display name.
  source?: { id: string; name: string; kind: 'official' | 'custom' };
}

export interface ConfigControl {
  // id of the configOption; required when calling set_config_option
  id: string;
  name: string;
  // ACP's semantic category: model / thought_level / model_config / custom; only affects ordering and icon, not correctness
  category?: string;
  options: SessionOption[];
  value?: string;
}

export interface SessionControls {
  modes: SessionOption[];
  modeId?: string;
  // If modes come from a category=mode configOption, record its id
  modeConfigId?: string;
  options: ConfigControl[];
}

// Slash commands from available_commands_update
export interface SlashCommand {
  name: string;
  description: string;
}

export interface AuthMethodInfo {
  id: string;
  name: string;
  description?: string;
}

// Session lifecycle: starting (spawn process / initialize / session.new) → ready; login failure → auth_required;
// old sessions that can't be resumed → readonly; process died → error
export type SessionStatus = 'starting' | 'ready' | 'auth_required' | 'readonly' | 'error' | 'closed';

// Aligned with ACP ToolKind
export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'diff'; lines: DiffLine[] }
  | { type: 'list'; items: string[] };

export interface DiffLine {
  kind: 'hunk' | 'add' | 'del' | 'ctx';
  text: string;
}

export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  kind: ToolKind;
  verb: string;
  target?: string;
  targetMono?: boolean;
  status: ToolStatus;
  meta?: string;
  diffStat?: { add: number; del: number };
  content?: ToolContent;
}

export interface ThoughtBlock {
  type: 'thought';
  text: string;
  // Start time (epoch ms); while in progress the webview uses it for live timing; once finished only durationSec matters
  startedAt?: number;
  durationSec?: number;
  streaming?: boolean;
}

export type PlanStatus = 'pending' | 'in_progress' | 'completed';
export type PlanPriority = 'high' | 'medium' | 'low';

export interface PlanEntry {
  title: string;
  status: PlanStatus;
  // ACP PlanEntry.priority; absent on entries persisted before it was kept
  priority?: PlanPriority;
}

export interface PlanBlock {
  type: 'plan';
  entries: PlanEntry[];
}

export interface TextBlock {
  type: 'text';
  markdown: string;
  streaming?: boolean;
}

export type PermissionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';

export interface PermissionBlock {
  type: 'permission';
  id: string;
  title: string;
  command?: string;
  description?: string;
  planId?: string;
  options: { id: string; label: string; kind: PermissionKind }[];
}

// A saved implementation plan, separate from the live to-do list.
export interface PlanDocumentBlock {
  type: 'plan_document';
  id: string;
  title: string;
  markdown: string;
  path?: string;
  toolCallId: string;
  approvalToolCallId?: string;
  status: 'draft' | 'ready' | 'approved' | 'rejected' | 'executing';
}

// Context compaction (ACP compaction_update): a single status line
export type CompactionStatus = 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface CompactionBlock {
  type: 'compaction';
  id: string;
  status: CompactionStatus;
}

export type AgentBlock = ThoughtBlock | PlanBlock | ToolCallBlock | TextBlock | PermissionBlock | CompactionBlock | PlanDocumentBlock;

// What the composer attaches to a prompt before the host has seen it: images and dropped text carry their payload (base64 / text),
// files carry a URI (Explorer drag / @ mention) that the host resolves — image files become `image`, everything else stays a link
export type Draft =
  | { kind: 'image'; mimeType: string; data: string; name?: string }
  | { kind: 'text'; name: string; text: string }
  | { kind: 'file'; uri: string; name: string };

// Attachment as persisted on a user turn. Images and dropped text live in the session's blob directory (the turn keeps only the file name,
// the webview loads it via blobBase; absent when the write failed — the prompt still went out, only the preview is gone); files are paths the agent reads by itself (sent as resource_link)
export type Attachment =
  | { kind: 'image'; blob?: string; mimeType: string; name?: string }
  | { kind: 'text'; blob?: string; name: string }
  | { kind: 'file'; uri: string; name: string };

export interface UserTurn {
  role: 'user';
  id?: string;
  text: string;
  attachments?: Attachment[];
  // The exact ACP selections used when this message was sent; older records omit it.
  settings?: TurnSettings;
  // Retrying a failed edited turn must rebuild its preceding context as well.
  edited?: true;
  // Sent automatically by ACPilot (/compact over threshold); rendered as a note line instead of a bubble
  auto?: boolean;
}

export interface TurnSettings {
  modeId?: string;
  config: Record<string, string>;
}

// How an agent turn ended. `end_turn` and `cancelled` are the normal outcomes; the rest stopped the turn short and are shown to the user:
// the ACP stopReasons max_tokens / max_turn_requests / refusal, plus `error` when session/prompt itself failed (details in AgentTurn.error)
export type TurnStop = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | 'error';

export interface TurnError {
  message: string;
  // JSON-RPC error code when the failure was a protocol error
  code?: number;
  // The vendor's error kind (Devin: data['cognition.ai/errorKind']) and whether it says the same request may succeed if retried
  kind?: string;
  retryable?: boolean;
}

export interface AgentTurn {
  role: 'agent';
  blocks: AgentBlock[];
  // Wall-clock prompt duration, including tools and permission waits. Absent on older transcripts.
  startedAt?: number;
  endedAt?: number;
  // What it's currently doing (inferred from usage and tool states); empty when the turn ends
  activity?: { kind: ToolKind; label: string };
  // How the turn ended; absent while it runs (and on turns persisted before this field existed)
  stop?: TurnStop;
  error?: TurnError;
}

export type Turn = UserTurn | AgentTurn;

export interface SessionSummary {
  id: string;
  title: string;
  agent: AgentId;
  accountId?: string;
  // ISO timestamp; the webview formats it itself
  updatedAt: string;
  pinned?: boolean;
  state?: 'working' | 'waiting' | 'unread' | 'error';
}

export interface Usage {
  used: number;
  size: number;
  cost?: number;
}

// Everything a session looks like to the webview: the host pushes the whole thing on every change (the transcript is small, not worth diffing)
export interface SessionView {
  id: string;
  agent: AgentId;
  // Bound account (only agents on the account layer have one); a session uses a single account from start to finish
  accountId?: string;
  title: string;
  cwd: string;
  status: SessionStatus;
  error?: string;
  authMethods?: AuthMethodInfo[];
  turns: Turn[];
  running: boolean;
  controls: SessionControls;
  usage?: Usage;
  commands: SlashCommand[];
  // Next queued prompt (sent while a turn is in progress)
  queued?: string;
  createdAt: string;
  updatedAt: string;
}
