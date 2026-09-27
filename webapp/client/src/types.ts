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
  | "Evaluation"
  | "Data Access"
  | "Safety"
  | "External Services"
  | "Infrastructure"
  | "Utilities"
  | "Configuration"
  | "Uncategorized";

/** Quant cockpit subsystem (car systems). Distinct from node.tier. */
export type NodeSubsystem =
  | "ingress"
  | "strategy"
  | "risk_execution"
  | "data_obs"
  | "unclassified";

/** Trading readiness + design-plan status. */
export type TradingBuildStatus =
  | "planned"
  | "building"
  | "built"
  | "paper"
  | "stub"
  | "missing";

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
  /**
   * P4: explicit platform bindings (provider catalog id + account status).
   * Detected llmProvider/cloudProvider still apply when this is empty.
   */
  platformBindings?: Array<{
    providerId: string;
    accountLabel?: string;
    status: "connected" | "missing_credentials" | "unknown" | "unbound";
    source: "detected" | "declared";
    evidence?: string;
    role?: "primary" | "fallback";
  }>;
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
  /**
   * Quant cockpit functional subsystem (not the same as tier).
   * ingress | strategy | risk_execution | data_obs | unclassified
   */
  subsystem?: NodeSubsystem;
  /** Trading readiness + design-plan status (paper/stub/missing for quant cockpit). */
  buildStatus?: TradingBuildStatus;
  /** Design mode: authored canvas position, set on drop/drag. Absent nodes fall back to auto-layout. */
  position?: { x: number; y: number };
  /** P6: LLMOps refs for agent-like nodes — prompt/config lineage, linked memory/eval nodes. */
  llmops?: { promptRef?: string; configRef?: string; memoryNodeId?: string; evalNodeId?: string };
  /**
   * Post-V1: polymorphic property bag driven by nodePropertySchemas (db connection, queue topic, etc.).
   */
  properties?: Record<string, string | number | boolean | null>;
  /** Post-V1: env vars this node expects (design-declared or detected). */
  requiredEnv?: string[];
  /** Post-V1: deploy/CI/env health adjacent to the architecture node. */
  deployHealth?: {
    status: "healthy" | "degraded" | "failed" | "unknown";
    summary?: string;
    checkedAt?: string;
    missingEnv?: string[];
    ciStatus?: "success" | "failure" | "pending" | "unknown";
  };
  /**
   * Stable external identity for re-import.
   * n8n: `n8n:{workflowId}:{variantKey}:{n8nNodeId}`
   */
  externalId?: string;
  workflowId?: string;
  variantKey?: string;
  importSource?: "n8n" | "scan" | "design";
  /** n8n: node.disabled → deactivated on canvas. */
  disabled?: boolean;
  /** n8n: trigger / webhook / schedule entry nodes. */
  isTrigger?: boolean;
}

export type EdgeImportance = "architectural" | "utility" | "config";

/** Request/flow edge semantics: dependency (static), runtime_path (observed), event (async), job (scheduled). */
export type FlowKind = "dependency" | "runtime_path" | "event" | "job";

/** Design-graph edge meaning (optional; scanned import graphs leave this unset). */
export type EdgeRelation =
  | "calls"
  | "uses"
  | "retrieves"
  | "reads"
  | "writes"
  | "publishes"
  | "subscribes"
  | "authenticates_via"
  | "caches"
  | "depends_on"
  | "channel_to";

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  type: "import" | "reexport" | "dynamic" | "runtime";
  /** Request/flow semantics for runtime and path analysis. */
  flowKind?: FlowKind;
  /**
   * Semantic relation for design graphs (calls/reads/…).
   * Optional so scanned graphs remain unchanged.
   */
  relation?: EdgeRelation;
  isDrift: boolean;
  driftReason?: string;
  importance?: EdgeImportance;
  isLayerViolation?: boolean;
  /** Display label (e.g. n8n branch true/false / switch rule / error). */
  label?: string;
  /** Upstream handle / branch key when preserved from import. */
  sourceHandle?: string;
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

/** Design-vs-reality diff produced by reconciling a design workspace against a fresh scan. */
export interface ArchGraphReconciliation {
  matched: Array<{ designNodeId: string; scanNodeId: string; confidence: number; method: string }>;
  missing: Array<{ designNodeId: string; label: string; layer?: string }>;
  unplanned: Array<{ scanNodeId: string; label: string; layer?: string }>;
}

/** Canvas grouping container (n8n sticky notes, authored regions). */
export interface ArchGraphGroup {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** n8n sticky color index (1–7) or CSS color. */
  color?: number | string;
  workflowId?: string;
  source?: "n8n-sticky" | string;
}

export interface AgentHarnessConfig {
  rules: string;
  context: string;
  guardrails: string;
  toolAccess: string;
  behaviour: string;
  model: string;
}

export interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  generatedAt: number;
  projectRoot: string;
  projectName?: string;
  /** Last time the workspace was manually saved (ms since epoch). */
  lastSavedAt?: number;
  /**
   * Post-V1 multiplayer: monotonic revision counter bumped on each save/merge.
   * See webapp/client/src/graphSync.ts (mergeGraphs) and the /save endpoint's
   * optimistic-concurrency check (baseRevision).
   */
  revision?: number;
  /**
   * Architecture board (e.g. trading spine) overlaid on / replacing scan layout.
   * Still may keep projectRoot so Rescan can refresh the clone + re-bind files.
   */
  architectureBoard?: boolean;
  /**
   * Which DESIGN_BLUEPRINTS id this graph was forked from / its spine belongs
   * to (e.g. "trading-agent", "voice-agent", "rag-agent"). Undefined for
   * scans, blank designs, or graphs predating this field.
   */
  blueprintId?: string;
  /** User-authored agent harness policy; travels with saved/shared design graphs. */
  harnessConfig?: AgentHarnessConfig;
  /** Git tip of the clone when this graph was last produced by scan/refresh. */
  scannedCommit?: string;
  /** Agent inventory from scan (scripts/agent-inventory.ts). */
  agents?: AgentInventoryResult;
  /**
   * Static provider probe from scan (scripts/lib/scanProviders.ts).
   * Credential flags reflect the scanned repo's .env — not live :4100 / vendor balances.
   */
  providers?: {
    static: true;
    note: string;
    providers: Array<{
      id: string;
      detected: boolean;
      hasCredential: boolean;
      boundToNode: boolean;
      credentialEnv: string[];
      configuredEnvKeys: string[];
      evidence: string[];
    }>;
    llmRouting: {
      primary: string;
      fallback: string;
      source: "detected" | "default";
      kellyPrimaryProvider: string | null;
      note: string;
    };
  };
  /** Set when a scan is reconciled against a prior design workspace for the same repo. */
  reconciliation?: ArchGraphReconciliation;
  /** Grouping containers (n8n sticky regions). Absolute canvas coords. */
  groups?: ArchGraphGroup[];
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
export type ClaimConfidence = "high" | "medium";

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

export type AgentSurfaceKind = "agent" | "helper" | "unknown" | "infrastructure";
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
  layers?: Array<{
    id: string;
    name: string;
    question: string;
    whyItMatters: string;
    status: "filled" | "thin" | "empty" | "unsearched";
    /** agent = evidence is only from this agent's turn path (e.g. safety, observability). */
    scope?: "agent" | "system";
    emptyReason?: string;
    components: Array<{
      id: string;
      label: string;
      evidence: string;
      sensitive?: "patient" | "money" | null;
    }>;
  }>;
  catalogId?: string;
};

export type AgentInventoryResult = {
  agents: AgentSurface[];
  scannedFiles: number;
  languages: Record<string, number>;
  pythonAgents: string[];
  searchedFor: string[];
  toolCatalogs?: Record<string, AgentTool[]>;
};

// ── Scene model (iCraft-style authored scenes) ────────────────────────────────

export interface CameraPreset {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

export type LayoutMode = "depth" | "layer" | "domain" | "elk" | "subsystem";

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
  /** Sticky/group geometry (n8n import). */
  width?: number | null;
  height?: number | null;
  color?: number | string | null;
  kind?: "sticky" | "group" | null;
  created_at: string;
  updated_at: string;
}

/** A claim that a user has taken ownership of a layer/node/section for now. */
export interface SectionClaim {
  id: string;
  workspace_id: string;
  kind: "layer" | "node" | "section";
  target_id: string;
  target_label?: string | null;
  claimer_id: string;
  claimed_at: string;
  claimerNickname?: string | null;
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
      /** Design semantic relation; client defaults to calls when absent. */
      relation?: EdgeRelation;
    }
  | {
      action: "update_node";
      id: string;
      label?: string;
      layer?: NodeLayer | string;
      description?: string;
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
