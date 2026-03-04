/** Types shared with extension host — keep in sync with src/types.ts */

export type NodeLayer =
  | "Presentation"
  | "Business Logic"
  | "Data Access"
  | "Infrastructure"
  | "External Services"
  | "Utilities"
  | "Configuration"
  | "Uncategorized";

/** Chat can trigger graph actions (highlight, filter, focus) */
export type GraphCommand =
  | { action: "highlight_nodes"; nodeIds: string[] }
  | { action: "filter_layer"; layer: NodeLayer }
  | { action: "filter_edge_type"; edgeType: "arch" | "drift" | "violations" | "all" }
  | { action: "focus_node"; nodeId: string }
  | { action: "reset" };

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

export interface ArchNode {
  id: string;
  label: string;
  path: string;
  role?: string;
  suggestedLabel?: string;
  layer?: string;
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
  suggestedFix?: string;
  traceId?: string;
  jiraKey?: string;
  jiraStatus?: string;
  trackedAt?: number;
  resolvedAt?: number;
  recurrences?: number;
}

export interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  generatedAt: number;
  projectRoot: string;
  projectName?: string;
  findings?: {
    type: string;
    severity: "critical" | "warning" | "info";
    description: string;
    location: string;
    expectedLocation?: string;
  }[];
}
