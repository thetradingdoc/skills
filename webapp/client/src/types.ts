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

export type Persona = "overview" | "learn" | "deep_dive";

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
  /** Short natural-language summary of what the node represents. */
  summary?: string;
  /**
   * Optional language/idiom notes for this node — used by the Learn / Code
   * viewer panels to teach concepts.
   */
  languageNotes?: string;
  /**
   * Rough complexity hint for visualization and badges in the inspector.
   * Free-form string but typically "simple" | "moderate" | "complex".
   */
  complexity?: string;
  /**
   * Optional line range in the primary file this node maps to, for code
   * viewer line hints (e.g. [42, 87]).
   */
  lineRange?: [number, number];
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
  /** Inferred domain (auth, payments, users, etc.). From SystemModel. */
  domain?: string;
  /** Inferred runtime roles (controller, service, repository, etc.). From SystemModel. */
  runtimeRoles?: string[];
  /** Inferred tier (core/supporting/peripheral). From SystemModel. */
  tier?: "core" | "supporting" | "peripheral";
}

export type EdgeImportance = "architectural" | "utility" | "config";

/** Request/flow edge semantics: dependency (static), runtime_path (observed), event (async), job (scheduled). */
export type FlowKind = "dependency" | "runtime_path" | "event" | "job";

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  type: "import" | "reexport" | "dynamic" | "runtime";
  /** Request/flow semantics for runtime and path analysis. */
  flowKind?: FlowKind;
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
  /** Agent inventory from scan (scripts/agent-inventory.ts). */
  agents?: AgentInventoryResult;
  layers?: Array<{
    id: string;
    name: string;
    nodeIds: string[];
  }>;
  tour?: Array<{
    order: number;
    title: string;
    description: string;
    nodeIds: string[];
    languageLesson?: string;
  }>;
}

/** Tool declared on an agent surface (from agent-inventory). */
export type AgentTool = {
  name: string;
  handler: string | null;
  description: string | null;
  params: string[];
  note?: string;
  reach?: ToolReach;
};

export type ResourceKind = "db" | "db_call" | "service" | "external" | "fs";
export type ResourceClass =
  | "patient"
  | "money"
  | "external"
  | "internal"
  | "plumbing"
  | "unclassified";

export type CellState = "reaches" | "none" | "not-traced";
export type ClaimConfidence = "high" | "medium" | "low";

export type ReachHop = {
  file: string;
  line: number | null;
  snippet: string;
  label: string;
};

export type ReachResource = {
  kind: ResourceKind;
  name: string;
  class: ResourceClass;
  depth: number;
  path: string[];
  evidence: string;
  guess?: boolean;
  hops?: ReachHop[];
  proof?: string;
  confidence?: ClaimConfidence;
};

export type ClassCell = {
  state: CellState;
  depth: number | null;
  path: string[] | null;
  reason: string | null;
  resources: ReachResource[];
  confidence?: ClaimConfidence | null;
};

export type ToolReach = {
  resources: ReachResource[];
  cells: Record<ResourceClass, ClassCell>;
  truncated: boolean;
  truncationReasons: string[];
  /** @deprecated use cells + truncationReasons */
  truncationNote?: string | null;
};

export type AgentAuthFinding = {
  found: boolean;
  location: string | null;
  evidence: string;
};

export type AgentSurfaceKind = "agent" | "helper" | "unknown";
export type AgentLoopKind =
  | "hosted"
  | "tool-loop"
  | "single-shot-with-tools"
  | "unknown";

/** Per-file agent surface detected at scan time. */
export type AgentSurface = {
  file: string;
  provider: string;
  evidence: string;
  model: string | null;
  systemPrompt: string | null;
  /** @deprecated Prefer `tools` for agents. */
  toolCandidates: string[];
  confidence: "high" | "low";
  kind: AgentSurfaceKind;
  kindSignal: string;
  loopKind: AgentLoopKind | null;
  tools: AgentTool[];
  auth?: AgentAuthFinding;
};

export type AgentInventoryResult = {
  agents: AgentSurface[];
  scannedFiles: number;
  languages: Record<string, number>;
  pythonAgents: string[];
  searchedFor: string[];
};

// ── Scene model (iCraft-style authored scenes) ────────────────────────────────

export interface CameraPreset {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export type LayoutMode = "depth" | "layer" | "domain" | "elk";

export interface WorkspaceSceneDoc {
  schemaVersion: number;
  settings?: {
    layoutMode?: LayoutMode;
    pinnedNodeIds?: string[];
    [key: string]: unknown;
  };
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
    /** Built-in 3D camera preset name (top/front/side/iso) */
    cameraPresetId?: string;
    /** Full 2D viewport (ReactFlow x, y, zoom). */
    viewport2D?: { x: number; y: number; zoom: number };
    /** Full 3D camera position/target (overrides preset when set). */
    camera3D?: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
    /** Hide/show nodes (nodeId -> visible) */
    visibility?: Record<string, boolean>;
    /** Which annotations are visible in this state (annotation ids). Omit to show all. */
    annotationIds?: string[];
    /** Per-object overrides (e.g. node position, props). */
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

export interface RuntimeEdgeMetrics {
  latencyMs?: number;
  errorRate?: number;
  throughputPerMin?: number;
  /** Request/flow semantics when inferred from traces. */
  flowKind?: FlowKind;
}

export interface RuntimeNodeMetrics {
  errorRate?: number;
  throughputPerMin?: number;
}

export interface WorkspaceRuntimeSnapshot {
  id: string;
  workspaceId: string;
  recordedAt: string;
  edges: Record<string, RuntimeEdgeMetrics>;
  nodes: Record<string, RuntimeNodeMetrics>;
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
      skeletonCode?: string;
      layoutHint?: string;
      group?: string;
    }
  | {
      action: "connect";
      fromId: string;
      toId: string;
      edgeType?: "import" | "reexport" | "dynamic";
    }
  | { action: "trace_path"; nodeIds: string[]; intensity?: number };

export type ArchitectureChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  rails?: { id: string }[];
  reasoningSteps?: string[];
  citations?: Array<{
    label: string;
    nodeId?: string;
    edgeId?: string;
    filePath?: string;
  }>;
  confidenceScore?: number | null;
  suggestedActions?: string[];
  graphCommands?: GraphCommand[];
  relevantNodeIds?: string[];
  taskId?: string;
  feedback?: "up" | "down";
};
