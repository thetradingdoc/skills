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

export type TechKind =
  | "database"
  | "cache"
  | "queue"
  | "message-bus"
  | "http-api"
  | "web-ui"
  | "mobile-app"
  | "kubernetes"
  | "container-service"
  | "serverless"
  | "object-storage"
  | "external-saas"
  | "generic-service"
  | "unknown";

export type CloudProvider = "aws" | "gcp" | "azure" | "other" | "unknown";

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
  techKind?: TechKind;
  cloudProvider?: CloudProvider;
  tags?: string[];
  iconKey?: string;
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
  type: "import" | "reexport" | "dynamic" | "runtime";
  isDrift: boolean;
  driftReason?: string;
  importance?: EdgeImportance;
  isLayerViolation?: boolean;
}

export type BackgroundTaskStatus = "running" | "completed" | "failed" | "needs_review";

export interface BackgroundTask {
  id: string;
  label: string;
  mode: "greenfield" | "analysis";
  /** Workspace this task belongs to — filter by activeWorkspaceId when rendering. */
  workspaceId?: string | null;
  status: BackgroundTaskStatus;
  /** Optional remote task id from the backend /tasks API. */
  remoteTaskId?: string;
  /** Optional kind for specialized UI handling. */
  kind?: "chat" | "materialize" | "other";
  steps: string[];
  currentStep: number;
  totalSteps: number;
  /** Retry attempt (e.g. 2/3 for self-correcting). Red when >= 2. */
  retryAttempt?: number;
  retryMax?: number;
  createdAt: number;
  result?: unknown;
  error?: string;
  /** SELF_CORRECTING: Reviewer rejection reason. */
  rejectionReason?: string;
  /** SELF_CORRECTING: What the agent is changing. */
  selfCorrectingChange?: string;
  /** Hallucination drift index 0–1. Blocks materialize when > 0.5 and unacknowledged. */
  hallucinationIndex?: number;
  hallucinationAcknowledged?: boolean;
  /** Logic path steps for breadcrumb (e.g. ["UI", "API", "Jira"]). */
  logicPath?: string[];
  reviewed?: boolean;
  dismissed?: boolean;
  toastDismissed?: boolean;
  prompt?: string;
  answerPreview?: string;
  railId?: string;
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

// ── Scene model (iCraft-style authored scenes) ────────────────────────────────

export interface CameraPreset {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export interface WorkspaceSceneDoc {
  schemaVersion: number;
  settings?: Record<string, unknown>;
  objects: Array<{
    id: string;
    kind: "node" | "group" | "plate" | "annotation" | "link" | "custom";
    archNodeId?: string;
    props?: Record<string, unknown>;
    transform?: {
      position?: { x: number; y: number; z?: number };
      rotation?: { x: number; y: number; z: number };
      scale?: { x: number; y: number; z?: number };
    };
  }>;
  states?: Array<{
    id: string;
    name: string;
    cameraPresetId?: string;
    objectOverrides?: Record<string, Record<string, unknown>>;
  }>;
  cameraPresets?: CameraPreset[];
}

export interface WorkspaceScene {
  id: string;
  workspaceId: string;
  name: string;
  sceneVersion: number;
  scene: WorkspaceSceneDoc;
  createdAt: string;
  updatedAt: string;
}

/** Annotation pinned to a node, layer, or canvas position. */
export interface WorkspaceAnnotation {
  id: string;
  type: "note" | "highlight" | "question";
  content: string;
  author_name?: string | null;
  node_id?: string | null;
  layer?: string | null;
  canvas_x?: number | null;
  canvas_y?: number | null;
  created_at: string;
  updated_at: string;
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
