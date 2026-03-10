/**
 * Agent types — AGENT_ROADMAP v4 (§2, §4c, §5c, §9, §10)
 */

import type { NodeLayer } from "../types";

// ─── Rails: core ids & triggers ─────────────────────────────────────────────

export type RailId = string;
export type TaskId = string;

export type GreenfieldArchetype =
  | "saas-web-app"
  | "api-service"
  | "data-pipeline"
  | "monolith-split"
  | "unknown";

export type RailTrigger =
  | { source: "governance"; violationId: string }
  | { source: "chat"; userMessage: string; sessionId: string }
  | { source: "jira"; jiraKey: string; changeType: "created" | "updated" | "assigned" };

export type RailState =
  | "PRE_PLANNING"
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "AWAITING_HITL"
  | "VERIFYING"
  | "SELF_CORRECTING"
  | "MATERIALIZING"
  | "ARCHIVED"
  | "SUSPENDED"
  | "FAILED";

export interface LogicPathStep {
  step: number;
  layer: "UI" | "API" | "Service" | "Infrastructure" | "External";
  nodeId: string;
  filePath: string;
  action: string;
}

export type TaskKind =
  | "code_change"
  | "governance_violation"
  | "governance_sync"
  | "verification"
  | "meta";

export type TaskStatus =
  | "pending"
  | "executing"
  | "awaiting_hitl"
  | "completed"
  | "rejected"
  | "skipped";

export type TaskAgent = "executor" | "reviewer";

export interface Task {
  id: TaskId;
  railId: RailId;
  kind: TaskKind;
  description: string;
  files: string[];
  autoCapable: boolean;
  status: TaskStatus;
  agent: TaskAgent;
  logicStep: number;
  evidence?: string;
  hitlPrompt?: string;
  jiraKey?: string;
  createdAt: number;
  resolvedAt?: number;
}

export interface RailOverlap {
  railId: RailId;
  sharedJira: string[];
  sharedNodes: string[];
  flaggedBy: "reviewer";
  flaggedAt: number;
  suggestion: string;
}

export interface Rail {
  id: RailId;
  version: number;
  outcome: string;
  trigger: RailTrigger;
  /** Owning workspace for this rail (Supabase workspaces.id). */
  workspaceId?: string | null;
  /** Repo URL associated with this rail's workspace (graphs.repo_url). */
  repoUrl?: string | null;
  /** Optional linked violation id when rail was spawned from a governance event. */
  violationId?: string | null;
  archetype?: string;
  logicPath: LogicPathStep[];
  state: RailState;
  /**
   * Frozen scope snapshot captured on first entry to EXECUTING.
   * These fields are immutable once set and are the canonical anchor
   * for outcome/plan-level reasoning and drift checks.
   */
  frozenOutcome?: string;
  frozenLogicPath?: LogicPathStep[];
  baselineNodeIds?: string[];
  /** High-level intent summary derived from goal/outcome/plan for drift checks. */
  intentSummary?: string;
  /** Latest computed intent drift score in [0,1]. */
  intentDriftScore?: number;
  activeAgent: "executor" | "reviewer" | null;
  tasks: Task[];
  jiraKeys: string[];
  traceIds: string[];
  overlaps: RailOverlap[];
  createdAt: number;
  updatedAt: number;
  createdBy: "agent" | "human";
  sessionId: string;
  /** Human-readable "why this rail exists" for Board; derived from trigger/question. */
  originSummary?: string;
  /** Optional link to chat message that created this rail. */
  originMessageId?: string;
  snapshotPath?: string;
  traces?: AgentTrace[];
  telemetry?: RailTelemetry;
  hallucinationIndex?: number;
  hallucinationAcknowledgedAt?: number;
  /** Compact history of verification / execution attempts for debugging. */
  attemptHistory?: Array<{
    timestamp: number;
    summary: string;
  }>;
  /** Last critique or failure summary for SELF_CORRECTING / HITL flows. */
  lastCritique?: {
    source: "reviewer" | "executor" | "playwright" | "lint" | "test" | "visual" | "unknown";
    message: string;
    failureType?: FailureType;
    createdAt: number;
    attempt?: number;
    totalAttempts?: number;
    criticScore?: number;
    violations?: Array<{ type: string; severity: string; description: string }>;
  };
  /** Greenfield: acceptance criteria for design phase and verification specs. */
  acceptanceCriteria?: {
    functional: string[];
    visual: string[];
    architectural: string[];
  };
}

export interface RailStateSnapshot {
  railId: RailId;
  logicPath: LogicPathStep[];
  activeTaskIds: TaskId[];
  tokenUsage: number;
  llmCallCount: number;
  retryCount: number;
  hallucinationIndex: number;
}

export interface RailTelemetry {
  railId: RailId;
  critiqueLoopCount: number;
  tokenUsage: number;
  llmCallCount: number;
  playwrightPasses: number;
  playwrightFailures: number;
  pathSuccessRate: number;
  taskLatencies: Record<TaskId, number>;
}

export interface AgentTrace {
  id: string;
  railId?: RailId;
  taskId?: TaskId;
  role: "executor" | "reviewer" | "manager";
  type: "info" | "tool_call" | "critic_feedback" | "error";
  message: string;
  timestamp: number;
  metadata?: {
    logicPathStep?: string;
    filePath?: string;
    tokens?: number;
    cost?: number;
    divergedNodeIds?: string[];
  };
}

export interface TasksPanelViewModel {
  railId: RailId;
  outcome: string;
  state: RailState;
  archetype?: string;
  progress: { completed: number; total: number };
  activeAgent: TaskAgent | "human" | null;
  tasks: Array<{
    id: TaskId;
    label: string;
    kind: TaskKind;
    status: TaskStatus;
    agent: TaskAgent;
    isHitl: boolean;
    evidence?: string;
    jiraKey?: string;
  }>;
  jiraLinks: Array<{ key: string; url: string; title: string }>;
  collaborators: Array<{ railId: RailId; outcome: string; sharedWith: string[] }>;
  telemetry: { tokenUsage: number; critiqueLoopCount: number; pathSuccessRate: number };
  canMaterialize: boolean;
  canSuspend: boolean;
}

export interface RailRegistry {
  version: number;
  updatedAt: number;
  index: {
    byJira: Record<string, RailId[]>;
    byNode: Record<string, RailId[]>;
    byState: Record<RailState, RailId[]>;
    bySession: Record<string, RailId[]>;
  };
  rails: Record<
    RailId,
    {
      id: RailId;
      outcome: string;
      state: RailState;
      jiraKeys: string[];
      updatedAt: number;
    }
  >;
}

// ─── Plan ───────────────────────────────────────────────────────────────────

export interface ProposedFileSpec {
  name: string;
  purpose: string;
  todos: string[];
}

export type SuccessCheck =
  | { kind: "staging_write"; required: true }
  | { kind: "lint"; required: true; paths?: string[] }
  | { kind: "vitest"; required: true; pattern?: string }
  | { kind: "playwright"; required: true; specs: string[]; baseUrl?: string };

export interface AgentPlanTask {
  id: string;
  module: string;
  layer: NodeLayer;
  action: "create" | "modify" | "refactor";
  expectedOutput: string;
  /** Machine-checkable success conditions for this task. */
  successChecks?: SuccessCheck[];
  /**
   * Full file specs from the Architect's design proposal.
   * Includes name, purpose, and implementation todos per file.
   */
  proposedFiles?: ProposedFileSpec[];
}

export interface AgentPlan {
  goal: string;
  tasks: AgentPlanTask[];
  dependencies: Array<[string, string]>; // [blocker_task_id, blocked_task_id]
}

// ─── Verification & Error Classification ─────────────────────────────────────

export type FailureType =
  | "ts_error"
  | "lint_error"
  | "layer_violation"
  | "vitest_failure_touched"
  | "vitest_failure_untouched"
  | "playwright_failure_touched"
  | "playwright_failure_untouched"
  | "playwright_visual_failure"
  | "retry_limit_exceeded"
  | "jira_fingerprint_mismatch"
  | "unknown_llm_output";

export type RouteTarget = "code_writer" | "arch_planner" | "hitl";

export interface VerificationError {
  filePath: string;
  line?: number;
  message: string;
  code?: string;
  type: "ts" | "lint" | "layer" | "test" | "runtime" | "unknown";
}

export interface VerificationOutput {
  tool: "run_lint" | "run_vitest" | "run_playwright_trace" | "diff_graph" | "llm_response";
  passed: boolean;
  errors: VerificationError[];
  rawOutput?: string;
}

export interface LintError {
  filePath: string;
  line: number;
  column: number;
  message: string;
  ruleId: string;
  severity: "error" | "warning";
}

export interface LintOutput {
  passed: boolean;
  errors: LintError[];
}

export interface VitestFailure {
  testName: string;
  filePath: string;
  error: string;
  stackTrace: string;
}

export interface VitestOutput {
  passed: boolean;
  summary: { total: number; passed: number; failed: number; skipped: number };
  failures: VitestFailure[];
}

export interface ClassifyFailureContext {
  touchedPaths: string[];
  plan: AgentPlan;
  retryCounts: Record<string, number>;
}

export interface ClassifyFailureResult {
  type: FailureType;
  route: RouteTarget;
}

// ─── Gates ──────────────────────────────────────────────────────────────────

export type GateType =
  | "plan_review"
  | "layer_violation_planning"
  | "diff_preview"
  | "scope_violation"
  | "test_failure"
  | "runtime_failure_untouched"
  | "stale_jira_mismatch"
  | "token_budget_exceeded"
  | "cost_cap_exceeded"
  | "session_llm_limit"
  | "jira_resolve_prompt"
  | "partial_plan_failure"
  | "rule_proposal";

export type UserActionToken =
  | "approve"
  | "reject"
  | "edit_and_retry"
  | "create_jira_and_stop"
  | "extend_budget"
  | "abort"
  | "resolve_jira"
  | "keep_jira"
  | "dismiss_jira"
  | "accept_rule"
  | "reject_rule";

// ─── Session & Persistence ──────────────────────────────────────────────────

export interface AgentSession {
  planState: AgentPlan;
  currentTaskIndex: number;
  sessionTouchedPaths: string[];
  tokenUsage: number;
  llmCallCount: number;
  retryCounts: Record<string, number>;
  activeGate: GateType | null;
  stagingIds: string[];
  /** User-extended token budget (added to config tokenBudgetSession). */
  extendedTokenBudget?: number;
  /** User-extended LLM call limit (added to config retryLimitSession). */
  extendedLlmLimit?: number;
}

// ─── Trace ──────────────────────────────────────────────────────────────────

export type TraceStepType =
  | "plan"
  | "read_file"
  | "get_ast"
  | "write_file"
  | "commit_file"
  | "run_lint"
  | "run_vitest"
  | "run_playwright"
  | "diff_graph"
  | "gate"
  | "llm_call"
  | "llm_tool"
  | "llm_reasoning"
  | "error"
  | "jira"
  | "context_write";

export interface TraceEntry {
  id: string;
  sessionId: string;
  timestamp: string; // ISO 8601
  stepType: TraceStepType;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  decision: string;
  reasoning?: string;
  llmCallCount?: number;
  tokenUsage?: number;
}

// ─── Arch Rules (v2 format from roadmap §0d) ─────────────────────────────────

export interface LayerDirection {
  from: string;
  to: string;
  allowed: boolean;
}

export interface ModuleThresholds {
  maxFanOut: number;
  maxFanIn: number;
  maxExportCount: number;
  maxFileCount: number;
  maxExternalImports: number;
}

export interface NamingConvention {
  pattern: string;
  expectedLayer: string;
}

export interface DenyListEntry {
  from: string;
  to: string;
  reason: string;
}

export interface ArchRulesV2 {
  layerDirections?: LayerDirection[];
  moduleThresholds?: Partial<ModuleThresholds>;
  namingConventions?: NamingConvention[];
  denyList?: DenyListEntry[];
}
