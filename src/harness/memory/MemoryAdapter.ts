export interface MemoryRecord {
  id?: string;
  agentId: string;
  text: string;
  metadata?: Record<string, unknown>;
  salience?: number;
  createdAt?: Date;
}

export interface RunLogEntry {
  id?: string;
  agentId: string;
  input: string;
  output: string;
  toolCalls?: { name: string; input: unknown; output: unknown }[];
  configVersionIds?: string[];
  createdAt?: Date;
}

export type ConfigNodeKind =
  | "RulesNode"
  | "ContextPolicyNode"
  | "GuardrailNode"
  | "ToolAccessNode";

export interface ConfigVersion {
  id?: string;
  nodeId: string;
  nodeKind: ConfigNodeKind;
  payload: Record<string, unknown>;
  proposedBy: string; // "reflection" or a user id
  status: "proposed" | "applied" | "rejected";
  diffSummary?: string;
  approvedBy?: string;
  createdAt?: Date;
  appliedAt?: Date;
}

export interface MemoryAdapter {
  remember(record: MemoryRecord): Promise<{ id: string }>;
  recall(params: { agentId: string; query: string; k?: number }): Promise<MemoryRecord[]>;
  logRun(entry: RunLogEntry): Promise<{ id: string }>;
  getRecentRuns(params: { agentId: string; limit?: number }): Promise<RunLogEntry[]>;
  proposeConfigChange(version: Omit<ConfigVersion, "status" | "id">): Promise<{ id: string }>;
  approveConfigChange(id: string, approvedBy: string): Promise<void>;
  getVersionHistory(nodeId: string): Promise<ConfigVersion[]>;
  close(): Promise<void>;
}
