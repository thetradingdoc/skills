/**
 * Shared types for Arch Visualizer — used by extension host and webview.
 */

/** Semantic signals extracted by scanner for AI enrichment */
export interface SemanticSignals {
  exports: string[];
  externalImports: string[];
  fileCount: number;
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

/** Agent execution mode: analysis (existing repo) or greenfield (design from scratch) */
export type AgentMode = "analysis" | "greenfield";

// ── Critic / violation types (shared between manager, critic, and webapp) ─────

/** Single structured architecture violation detected by the Critic. */
export interface CriticViolation {
  type:
    | "layer_violation"
    | "drift"
    | "missing_context"
    | "circular_dep"
    | "god_module";
  severity: "critical" | "high" | "medium";

  /** Primary node that is considered at fault. Must match an ArchNode.id. */
  sourceNodeId: string;
  /** Optional secondary node (e.g. the forbidden dependency target). */
  targetNodeId?: string;

  /** Human-readable description shown in the sidebar. */
  description: string;
  /** Human-readable recommendation for how to fix it. */
  suggestedFix?: string;

  /** Manager trace ID when violation was produced (for debugging). */
  traceId?: string;

  // These fields are populated after the user chooses "Track in Jira".
  jiraKey?: string;
  jiraStatus?: string;
  trackedAt?: number;
  resolvedAt?: number;
  recurrences?: number;
}

/** Acceptance criteria extracted from greenfield critic for rails and verification. */
export interface GreenfieldAcceptanceCriteria {
  functional: string[];
  visual: string[];
  architectural: string[];
}

/** Full critic output, including structured violations. */
export interface CriticResult {
  approved: boolean;
  score: number;
  report: string;
  violations: CriticViolation[];
  /** Greenfield: criteria to persist on rail and use for Playwright spec generation. */
  acceptanceCriteria?: GreenfieldAcceptanceCriteria;
}

/** Aggregated violation state for a node, for display on the canvas. */
export interface ArchNodeViolationState {
  violations: CriticViolation[];
  highestSeverity: "critical" | "high" | "medium" | null;
}

/** Coarse-grained technical classification for a node. */
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

/** Optional cloud provider hint for tech-specific rendering. */
export type CloudProvider = "aws" | "gcp" | "azure" | "other" | "unknown";

export type ArchNodeId = string;

export interface ArchNode {
  id: ArchNodeId;
  label: string;
  path: string;
  /**
   * Stable identifier used to link this node to logs, Jira, and external tools.
   * Default convention: normalized module path without extension (e.g. "routes/auth").
   */
  archNodeId?: string;
  role?: string;
  /** AI-suggested display label (primary over label when present) */
  suggestedLabel?: string;
  /** Architectural layer */
  layer?: NodeLayer;
  /** AI-specific classification (agent, orchestrator, guardrail, infra, etc.) */
  kind?: NodeKind;
  /** LLM provider when kind is agent/orchestrator (anthropic, openai, ollama, etc.) */
  llmProvider?: string;
  /** Model version string (e.g. claude-sonnet-4-6) */
  modelVersion?: string;
  /** Whether this node uses RAG/vector retrieval */
  hasRAG?: boolean;
  /** Number of tools exposed when kind is agent */
  toolCount?: number;
  /** Whether this node has traces in model_traces / LangSmith (for Reasoning/Orchestration/Memory) */
  hasTraces?: boolean;
  /** Short description of what the module does */
  description?: string;
  /** Semantic signals for AI (exports, external libs used) */
  semanticSignals: SemanticSignals;
  /** Tech classification for richer 2D/3D visuals (DB, queue, k8s, etc.). */
  techKind?: TechKind;
  /** Cloud provider hint when applicable. */
  cloudProvider?: CloudProvider;
  /** Free-form tags for UI rendering (k8s, API, DB, external, etc.). */
  tags?: string[];
  /**
   * Short natural-language summary of what this node represents.
   * More end-user friendly than description when present.
   */
  summary?: string;
  /**
   * Optional language/idiom notes for this node — used by the Learn / Code
   * viewer panels to teach concepts (e.g. “React hook”, “NestJS module”).
   */
  languageNotes?: string;
  /**
   * Rough complexity hint for visualization and badges in the inspector.
   * Kept free-form enough to allow future buckets.
   */
  complexity?: "simple" | "moderate" | "complex" | string;
  /**
   * Optional line range in the primary file this node maps to, for code
   * viewer line hints (e.g. [42, 87]).
   */
  lineRange?: [number, number];
  /** Icon key for mapping to specific glyph/mesh on the frontend. */
  iconKey?: string;
  /**
   * File paths in this module. Always relative to project root (e.g. "src/middleware/routes.ts").
   * Use path.join(graph.projectRoot, f) to get an absolute path.
   */
  files: string[];
  health: {
    hasDocs: boolean;
    hasTests: boolean;
    hasContext: boolean;
  };
  /** Raw content of .context.md when present */
  contextRawContent?: string;
  status: NodeStatus;
  isDrift: boolean;
  driftReason?: string;
  /** No other module imports this — bootstrap/entry point */
  isEntryPoint?: boolean;
  /** Hops from entry point (0 = entry, 1 = direct dependency, etc.) */
  depth?: number;
  /** Live violations associated with this node (merged from CriticResult). */
  violationState?: ArchNodeViolationState;
  /** Inferred domain (e.g. auth, payments, users). Set by SystemModel builder. */
  domain?: string;
  /** Inferred runtime roles (controller, service, repository, etc.). Set by SystemModel builder. */
  runtimeRoles?: string[];
  /** Inferred tier (core/supporting/peripheral). Set by SystemModel builder. */
  tier?: NodeTier;
}

/** Node tier: core = critical path, supporting = used by core, peripheral = utilities/config. */
export type NodeTier = "core" | "supporting" | "peripheral";

/** Runtime roles inferred from path, layer, and semantic signals. */
export type RuntimeRole =
  | "controller"
  | "service"
  | "repository"
  | "worker"
  | "scheduler"
  | "event-consumer"
  | "gateway"
  | "client";

/** How significant an edge is architecturally */
export type EdgeImportance = "architectural" | "utility" | "config";

export interface EnrichmentResult {
  suggestedLabel: string;
  layer: NodeLayer;
  description: string;
  status: NodeStatus;
  confidence: "high" | "medium" | "low";
}

/** Request/flow edge semantics: dependency (static), runtime_path (observed), event (async), job (scheduled). */
export type FlowKind = "dependency" | "runtime_path" | "event" | "job";

export interface ArchEdge {
  id: string;
  source: ArchNodeId;
  target: ArchNodeId;
  type: "import" | "reexport" | "dynamic" | "runtime";
  /** Request/flow semantics for runtime and path analysis. */
  flowKind?: FlowKind;
  isDrift: boolean;
  driftReason?: string;
  /** architectural = cross-layer load-bearing, utility = helpers/config, config = env reads */
  importance?: EdgeImportance;
  /** Edge violates layer hierarchy (e.g. Data Access → Presentation) */
  isLayerViolation?: boolean;
}

/**
 * Scaffold Node definition
 *
 * Canonical contract used by greenfield design, scaffold/materialize flows,
 * and skills that create new modules on disk.
 *
 * - archNodeId: stable identifier for the module (e.g. routes/auth, services/cache).
 * - path: directory or file path relative to project root where the module should live.
 * - layer: architectural layer for visualization and validation.
 * - kind: free-form module kind hint (service, route, adapter, job, etc.).
 * - template: optional template/skeleton identifier or inline stub description.
 */
export interface ScaffoldNodeDefinition {
  archNodeId: ArchNodeId;
  path: string;
  layer: NodeLayer | string;
  kind: string;
  template?: string;
}

export interface ArchGraph {
  nodes: ArchNode[];
  edges: ArchEdge[];
  generatedAt: number;
  projectRoot: string;
  projectName?: string;
  /** Last time the workspace was manually saved (ms since epoch). */
  lastSavedAt?: number;
  /** Agent inventory from scripts/agent-inventory.ts (scan-time). */
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
  findings?: ContractFinding[];
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

export type AgentSurfaceKind = "agent" | "helper" | "unknown";
export type AgentLoopKind =
  | "hosted"
  | "tool-loop"
  | "single-shot-with-tools"
  | "unknown";

/** Per-file agent surface detected by agent-inventory. */
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

/** SystemModel node: ArchNode + inferred domain, runtimeRoles, tier for reasoning. */
export interface SystemModelNode extends ArchNode {
  domain: string;
  runtimeRoles: RuntimeRole[];
  tier: NodeTier;
}

/** SystemModel: enriched view of ArchGraph for AI and visualization. */
export interface SystemModel {
  nodes: SystemModelNode[];
  edges: ArchEdge[];
  domains: string[];
  generatedAt: number;
  projectRoot: string;
  projectName?: string;
  /** Optional reference to source graph id. */
  graphId?: string;
  /** Snapshot id if stored in workspace_system_models. */
  snapshotId?: string;
}

/** History for manager/Claude; may include system messages (e.g. Librarian skill context). */
export type ArchitectureChatHistory = Array<{
  role: "user" | "assistant" | "system";
  content: string;
  /** Optional reasoning trace and metadata for explainability. */
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
}>;

/** Chat can optionally trigger graph actions (highlight, filter, focus, design, trace) */
export type GraphCommand =
  | { action: "highlight_nodes"; nodeIds: string[] }
  | { action: "filter_layer"; layer: NodeLayer }
  | { action: "filter_edge_type"; edgeType: "arch" | "drift" | "violations" | "all" }
  | { action: "focus_node"; nodeId: string }
  | { action: "reset" }
  // Visual construction: ghost nodes and connections
  | {
      action: "create_node";
      id: string;
      label: string;
      layer: NodeLayer;
      description?: string;
      archNodeId?: string;
      /** Optional minimal skeleton/stub code for the module (designer can propose) */
      skeletonCode?: string;
      /** Optional layout hint for canvas auto-arrangement (e.g. "left", "center", "right") */
      layoutHint?: string;
      /** Optional group ID to cluster related nodes visually */
      group?: string;
    }
  | {
      action: "connect";
      fromId: string;
      toId: string;
      edgeType?: "import" | "reexport" | "dynamic";
    }
  // Pulse: visualize a runtime trace across nodes
  | { action: "trace_path"; nodeIds: string[]; intensity?: number };

/** Static analysis finding from contract/reference/env scanners */
export interface ContractFinding {
  type:
    | "missing_caller"
    | "missing_implementor"
    | "missing_file"
    | "missing_env_var"
    | "config_mismatch";
  severity: "critical" | "warning" | "info";
  description: string;
  location: string;
  expectedLocation?: string;
  evidence: string[];
}

/** Raw graph before AI enrichment — for MockEnricher contract */
export type RawGraph = ArchGraph;

/** Enriched graph after drift + AI — for display */
export type EnrichedGraph = ArchGraph;

/** Validation pipeline result (arch + tests + Jira) */
export interface ValidationResult {
  archPassed: boolean;
  archViolations: Array<{ source: string; target: string; reason: string }>;
  testsRun: boolean;
  testsPassed: boolean | null;
  testFailures: Array<{ file: string; name: string }>;
  jiraCreated: Array<{ key: string; summary: string; type: string }>;
  jiraBaseUrl: string | null;
}

/** Runtime metrics for a single edge (from OTEL/APM). */
export interface RuntimeEdgeMetrics {
  latencyMs?: number;
  errorRate?: number;
  throughputPerMin?: number;
  /** Request/flow semantics when inferred from traces. */
  flowKind?: FlowKind;
}

/** Runtime metrics for a single node (service). */
export interface RuntimeNodeMetrics {
  errorRate?: number;
  throughputPerMin?: number;
}

/** Snapshot of runtime metrics for a workspace. */
export interface WorkspaceRuntimeSnapshot {
  id: string;
  workspaceId: string;
  recordedAt: string;
  edges: Record<string, RuntimeEdgeMetrics>;
  nodes: Record<string, RuntimeNodeMetrics>;
}

/** Agent plan (for Plan Review UI) — AGENT_ROADMAP v4 */
export interface AgentPlanMessage {
  goal: string;
  tasks: Array<{
    id: string;
    module: string;
    layer: string;
    action: string;
    expectedOutput: string;
  }>;
  dependencies: Array<[string, string]>;
  /** Section 10.4: Anti-pattern warnings injected from failed rails of same archetype. */
  warnings?: string[];
}

/** Trace entry (for Trace Panel) — AGENT_ROADMAP v4 */
export interface AgentTraceEntry {
  id: string;
  sessionId: string;
  timestamp: string;
  stepType: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  decision: string;
  reasoning?: string;
  llmCallCount?: number;
  tokenUsage?: number;
  /** Optional rail-scoped metadata from AgentTrace stream. */
  railId?: string;
  role?: "executor" | "reviewer" | "manager";
  eventType?: "info" | "tool_call" | "critic_feedback" | "error";
  metadata?: {
    logicPathStep?: string;
    filePath?: string;
  };
}

// ── Scene model (iCraft-style authored scenes) ────────────────────────────────

/** Saved camera preset for 3D views. */
export interface CameraPreset {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/**
 * Scene document stored per workspace.
 * Intentionally separated from `ArchGraph` so authored layout/assets/states persist across rescans.
 */
export interface WorkspaceSceneDoc {
  /** Schema version for forward migrations of scene_json. */
  schemaVersion: number;
  /** Scene-level settings (grid, theme, etc.). */
  settings?: Record<string, unknown>;
  /** Objects in the scene (2D or 3D). */
  objects: Array<{
    id: string;
    kind: "node" | "group" | "plate" | "annotation" | "link" | "custom";
    /** Optional link back to scanned graph nodes. */
    archNodeId?: string;
    /** Free-form props; renderer/editor specific. */
    props?: Record<string, unknown>;
    /** Transform in world/canvas space. */
    transform?: {
      position?: { x: number; y: number; z?: number };
      rotation?: { x: number; y: number; z: number };
      scale?: { x: number; y: number; z?: number };
    };
  }>;
  /** Optional state/slide system (presentation). */
  states?: Array<{
    id: string;
    name: string;
    /** Built-in 3D camera preset name (top/front/side/iso) */
    cameraPresetId?: string;
    /** Hide/show nodes (nodeId -> visible) */
    visibility?: Record<string, boolean>;
    /** Which annotations are visible in this state (annotation ids). Omit to show all. */
    annotationIds?: string[];
    objectOverrides?: Record<string, Record<string, unknown>>;
  }>;
  /** Saved camera presets for this workspace scene. */
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

/** Extension host → webview messages */
export type ExtToWebMessage =
  | { type: "graph"; data: ArchGraph }
  | { type: "graphUpdate"; data: ArchGraph }
  | { type: "loading"; message: string }
  | { type: "error"; message: string }
  | { type: "aiResponse"; answer: string; graphCommand?: GraphCommand }
  | { type: "writeContextResult"; success: boolean; error?: string }
  | { type: "rulesPreview"; rules: { id: string; description: string; severity: string }[]; raw: string }
  | { type: "generateRulesResult"; success: boolean; error?: string }
  | { type: "fileContent"; filePath: string; content: string | null; error?: string }
  | { type: "validationResult"; data: ValidationResult }
  | {
      type: "jiraIssues";
      issues: Array<{ key: string; summary: string; status: string; type: string; priority?: string; baseUrl: string; labels?: string[] }>;
      repoName?: string | null;
      staleMismatches?: Array<{
        key: string;
        summary: string;
        storedFingerprint: string | null;
        storedModule: string | null;
        currentFingerprint: string | null;
        reason: "changed" | "orphaned" | "missing_stored";
      }>;
    }
  | { type: "jiraIssuesError"; error: string }
  | { type: "agentJiraAddLabelResult"; key: string; label: string; success: boolean; error?: string }
  | { type: "agentPlan"; plan: AgentPlanMessage }
  | { type: "agentPlanValidationError"; error: string }
  | { type: "agentTrace"; entry: AgentTraceEntry }
  | { type: "agentTraceBatch"; entries: AgentTraceEntry[] }
  | { type: "agentStagingEntries"; entries: Array<{ path: string; content: string; taskId?: string }> }
  | { type: "agentTokenWarning"; usage: number; budget: number }
  | { type: "agentSessionRecovery"; session: unknown }
  | { type: "agentTraceExport"; json: string }
  | {
      type: "agentJiraResolvePrompt";
      issues: Array<{ key: string; summary: string; module: string; baseUrl: string }>;
    }
  | {
      type: "agentPartialPlanFailure";
      failedTaskIndex: number;
      committedCount: number;
      failedTaskId: string;
    }
  | {
      type: "agentProposeRuleChange";
      proposal: {
        category: string;
        currentRule: string;
        proposedRule: string;
        rationale: string;
        affectedModules: string[];
      };
    }
  | {
      type: "playwrightHitl";
      railId: string;
      failures: Array<{ testName: string; error: string; screenshotPath?: string }>;
      tracePath?: string;
      spec: string;
    }
  | {
      type: "agentCostGate";
      gate: "token_budget_exceeded" | "session_llm_limit";
      tokenUsage: number;
      tokenBudget: number;
      llmCallCount: number;
      llmLimit: number;
      estimatedCost?: number;
    }
  | { type: "tasksSnapshot"; rails: unknown[]; tasks: unknown[]; telemetry: Record<string, { tokenUsage: number; critiqueLoopCount: number; pathSuccessRate: number }> }
  | { type: "taskUpdate"; taskId: string; update: Partial<unknown> }
  | { type: "railUpdate"; railId: string; update: Partial<unknown> }
  | { type: "agentActive"; active: boolean };

/** Webview → extension host messages */
export type WebToExtMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "nodeClick"; nodeId: string }
  | {
      type: "askAI";
      question: string;
      nodeId?: string;
      history?: { role: "user" | "assistant"; content: string }[];
      pdfBase64?: string;
      pdfFileName?: string;
    }
  | { type: "writeContext"; nodeId: string; layer?: string; description?: string; role?: string }
  | { type: "generateRules" }
  | { type: "writeRules"; raw: string }
  | { type: "openInEditor"; nodeId: string }
  | { type: "openFile"; nodeId: string; filePath: string }
  | { type: "readFileContent"; nodeId: string; filePath: string }
  | { type: "runValidation"; createJira?: boolean }
  | { type: "fetchJiraTests"; filterByRepo?: boolean }
  | { type: "agentJiraAddLabel"; key: string; label: string }
  | { type: "requestPlan"; goal: string }
  | { type: "agentPlanAction"; action: "approve" | "reject"; editFeedback?: string }
  | { type: "agentDiffApprove"; paths: string[] }
  | { type: "agentDiffReject"; paths: string[] }
  | { type: "agentSessionRestore" }
  | { type: "agentSessionDiscard" }
  | { type: "agentExtendBudget"; amount?: number }
  | { type: "agentExportTrace"; entries: unknown[] }
  | {
      type: "agentRuleProposalAction";
      action: "accept" | "reject" | "edit";
      editedRule?: string;
    }
  | {
      type: "agentJiraSyncAction";
      key: string;
      action: "retag" | "archive" | "keep";
      newFingerprint?: string;
      newModule?: string;
    }
  | {
      type: "agentJiraResolveAction";
      key: string;
      action: "resolve" | "keep" | "dismiss";
    }
  | {
      type: "agentPartialPlanFailureAction";
      action: "abort" | "revert" | "create_jira";
    }
  | {
      type: "playwrightHitlAction";
      railId: string;
      action: "retry" | "suspend" | "create_jira" | "investigate";
      tracePath?: string;
    }
  | { type: "openPlaywrightScreenshot"; path: string }
  | {
      type: "agentCostGateAction";
      action: "extend" | "abort" | "create_jira";
      amount?: number;
    }
  | { type: "taskAction"; taskId: string; action: "approve" | "reject" | "take_ownership" }
  | { type: "railAction"; railId: string; action: "suspend" | "resume" | "abandon" | "acknowledge_drift" | "materialize" }
  | { type: "setAgentActive"; active: boolean }
  | { type: "openTaskFile"; filePath: string };
