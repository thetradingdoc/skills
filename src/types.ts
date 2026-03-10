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

export interface ArchNode {
  id: string;
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
}

/** How significant an edge is architecturally */
export type EdgeImportance = "architectural" | "utility" | "config";

export interface EnrichmentResult {
  suggestedLabel: string;
  layer: NodeLayer;
  description: string;
  status: NodeStatus;
  confidence: "high" | "medium" | "low";
}

export interface ArchEdge {
  id: string;
  source: string;
  target: string;
  type: "import" | "reexport" | "dynamic";
  isDrift: boolean;
  driftReason?: string;
  /** architectural = cross-layer load-bearing, utility = helpers/config, config = env reads */
  importance?: EdgeImportance;
  /** Edge violates layer hierarchy (e.g. Data Access → Presentation) */
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
  findings?: ContractFinding[];
}

/** History for manager/Claude; may include system messages (e.g. Librarian skill context). */
export type ArchitectureChatHistory = Array<{
  role: "user" | "assistant" | "system";
  content: string;
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
