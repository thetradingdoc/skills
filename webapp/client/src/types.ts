export interface SemanticSignals {
  exports: string[];
  externalImports: string[];
  fileCount?: number;
}

export type NodeStatus =
  | "stable"
  | "new"
  | "deprecated"
  | "unknown"
  | "warning"
  | "error";

/** AI-specific node classification (agent, orchestrator, guardrail, infra, etc.). */
export type NodeKind =
  | "agent"
  | "orchestrator"
  | "guardrail"
  | "infra"
  | "module"
  | "unknown";

export type NodeLayer =
  | "Presentation"
  | "Orchestration"
  | "Reasoning"
  | "Business Logic"
  | "Memory"
  | "Data Access"
  | "Safety"
  | "External Services"
  | "Infrastructure"
  | "Utilities"
  | "Configuration"
  | "Uncategorized";

// ── Critic / violation types (frontend copy — mirrors src/types.ts) ───────────

export interface CriticViolation {
  type:
    | "layer_violation"
    | "drift"
    | "missing_context"
    | "circular_dep"
    | "god_module";
  severity: "critical" | "high" | "medium";

  sourceNodeId: string;
  targetNodeId?: string;

  description: string;
  suggestedFix: string;

  jiraKey?: string;
  jiraStatus?: string;
  trackedAt?: number;
  resolvedAt?: number;
  recurrences?: number;
}

export interface ArchNodeViolationState {
  violations: CriticViolation[];
  highestSeverity: "critical" | "high" | "medium" | null;
}

export interface ArchNode {
  id: string;
  label: string;
  path: string;
  role?: string;
  suggestedLabel?: string;
  layer?: NodeLayer | string;
  kind?: NodeKind;
  llmProvider?: string;
  modelVersion?: string;
  hasRAG?: boolean;
  toolCount?: number;
  hasTraces?: boolean;
  description?: string;
  semanticSignals?: SemanticSignals;
  files: string[];
  health: { hasDocs: boolean; hasTests: boolean; hasContext: boolean };
  contextRawContent?: string;
  status: NodeStatus;
  isDrift: boolean;
  driftReason?: string;
  isEntryPoint?: boolean;
  depth?: number;
  violationState?: ArchNodeViolationState;
}

export type EdgeImportance = "architectural" | "utility" | "config";

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  type: "import" | "reexport" | "dynamic";
  isDrift: boolean;
  driftReason?: string;
  importance?: EdgeImportance;
  isLayerViolation?: boolean;
}

export interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  generatedAt: number;
  projectRoot: string;
  projectName?: string;
  /** Last time the workspace was manually saved (ms since epoch). */
  lastSavedAt?: number;
}

/** Chat can trigger graph actions (highlight, filter, design, trace). From manager response. */
export type GraphCommand =
  | { action: "highlight_nodes"; nodeIds: string[] }
  | { action: "filter_layer"; layer: NodeLayer | string }
  | { action: "filter_edge_type"; edgeType: "arch" | "drift" | "violations" | "all" }
  | { action: "focus_node"; nodeId: string }
  | { action: "reset" }
  | {
      action: "create_node";
      id: string;
      label: string;
      layer: NodeLayer | string;
      description?: string;
      archNodeId?: string;
    }
  | {
      action: "connect";
      fromId: string;
      toId: string;
      edgeType?: "import" | "reexport" | "dynamic";
    }
  | { action: "trace_path"; nodeIds: string[]; intensity?: number };
