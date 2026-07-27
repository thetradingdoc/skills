# Architecture: Agent Systems, Memory, Context & Observability

This document describes the built-in architecture for stateflow, memory (short- and long-term), context window management, orchestration, Jira integration, LLM tracing, reasoning, and hallucination detection.

---

## 1. Stateflow (Rail State Machine)

The system does **not** use LangGraph or any external stateflow library. Instead, it implements a custom rail state machine.

### Source Files

| File | Purpose |
|------|---------|
| `src/agent/rail/orchestrator.ts` | State machine, transitions, guards |
| `src/agent/rail/graph.ts` | Rail graph nodes/edges definition |
| `src/agent/types.ts` | `RailState`, `OrchestratorContext` |

### Rail States

```typescript
type RailState =
  | "PRE_PLANNING"
  | "PLANNING"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "AWAITING_HITL"
  | "VERIFYING"
  | "SELF_CORRECTING"
  | "MATERIALIZING"
  | "ARCHIVED"      // terminal
  | "SUSPENDED"
  | "FAILED";      // terminal
```

### State-to-Graph-Node Mapping

| State | Graph Node |
|-------|------------|
| PRE_PLANNING, PLANNING | `plan_node` |
| AWAITING_APPROVAL | `hitl_approve_plan` |
| EXECUTING, SELF_CORRECTING | `executor_node` |
| AWAITING_HITL, SUSPENDED | `hitl_gate_node` |
| VERIFYING | `reviewer_node` |
| MATERIALIZING | `materialize_node` |
| ARCHIVED, FAILED | `archive_node` |

### Valid Transitions

```typescript
// From src/agent/rail/orchestrator.ts
PRE_PLANNING → PLANNING | AWAITING_APPROVAL | SUSPENDED | FAILED
PLANNING → AWAITING_APPROVAL | SUSPENDED | FAILED
AWAITING_APPROVAL → EXECUTING | SUSPENDED | FAILED  // requires planApproved
EXECUTING → AWAITING_HITL | VERIFYING | SELF_CORRECTING | SUSPENDED | FAILED
AWAITING_HITL → EXECUTING | SUSPENDED | FAILED
VERIFYING → MATERIALIZING | SELF_CORRECTING | SUSPENDED | FAILED  // requires reviewerPassed
SELF_CORRECTING → EXECUTING | AWAITING_HITL | SUSPENDED | FAILED
MATERIALIZING → ARCHIVED | SUSPENDED | FAILED  // requires materializationApproved
SUSPENDED → AWAITING_APPROVAL | EXECUTING
FAILED, ARCHIVED → (terminal)
```

### Guards

- **EXECUTING**: `planApproved === true`
- **MATERIALIZING**: `reviewerPassed === true`
- **ARCHIVED**: `materializationApproved === true` (from MATERIALIZING)
- **Materialize lock**: If `hallucinationIndex > 0.5` or `intentDriftScore > 0.6`, human must acknowledge before materialization

### Code Summary

```typescript
// src/agent/rail/orchestrator.ts
export function canTransition(from: RailState, to: RailState, ctx?: OrchestratorContext): boolean
export function transitionRail(rootPath, railId, to, ctx?): { ok, rail, error? }
export function completeMaterializeAndArchive(rootPath, railId): Rail | null
```

---

## 2. Short-Term Memory

Short-term memory is in-memory and session-scoped: chat history, rail context, and session persistence.

### Sources

| Component | Location | Content |
|-----------|----------|---------|
| Chat history | `manager.ts`, `claudeEnricher.ts` | User/assistant turns, trimmed to budget |
| Rail context | `src/agent/rail/context.ts` | Rail outcome, logic path, recent rail-scoped messages |
| Session | `src/agent/sessionPersistence.ts` | `tokenUsage`, `llmCallCount`, `sessionTouchedPaths` |
| In-memory rail store | `src/agent/rail/manager.ts` | Rails, tasks; loaded from disk on startup |

### Token Budget for History

```typescript
// src/ai/manager.ts
const HISTORY_BUDGET = 60_000;  // tokens
localHistory = trimHistoryToBudget(localHistory, HISTORY_BUDGET);
```

### Rail-Scoped Context

```typescript
// src/agent/rail/context.ts
export function buildRailContext(rail, fullHistory, tokenBudget): ArchitectureChatHistory
```

- **Tier 1**: Rail summary (outcome, state, logic path)
- **Tier 2**: Recent messages scoped to rail (max 12, or digest if over budget)
- Uses `TIER2_FRACTION = 0.8` from `tokenBudget.ts` for recent-message allocation

### Session Persistence

```typescript
// src/agent/sessionPersistence.ts
const SESSION_FILE = ".arch-agent-session.json";

interface AgentSession {
  planState: AgentPlan;
  currentTaskIndex: number;
  sessionTouchedPaths: string[];
  tokenUsage: number;
  llmCallCount: number;
  retryCounts: Record<string, number>;
  activeGate: GateType;
  stagingIds: string[];
}
```

---

## 3. Long-Term Memory

Long-term memory is persisted in Supabase, file system, and `.agent` directories.

### Supabase Tables

| Table | Purpose |
|-------|---------|
| `workspace_memories` | Saved insights, rail completions; `content`, `memory_type`, `node_id`; `superseded_at` for conflict handling |
| `user_memories` | Cross-workspace preferences (`memory_type: user_preference`) |
| `conversation_snapshots` | Lightweight intent/outcome per exchange |

### Memory Types (workspace_memories)

- `user_preference` (user_memories)
- `user_saved` — manually saved insights
- `rail_completion` — rail archived summary
- `rail_result`
- `arch_insight`

### File-Based Memory

| Path | Purpose |
|------|---------|
| `.archy.md` | Project memory; injected into Claude system prompt |
| `.agent/rails/anti-patterns/*.json` | Past failures; loaded by archetype, injected into critic |
| `.agent/nodes/history.json` | Node history for rail memory (AGENT_ROADMAP) |
| `.arch-agent-session.json` | Session persistence (tokens, paths) |

### Retrieval

```typescript
// webapp/server/src/memoryRetrieval.ts
getMemoriesForContext(db, workspaceId, { nodeId?, limit?, maxAgeDays? })
getSnapshotsForContext(db, workspaceId, { nodeId?, limit?, maxAgeDays? })
getUserMemoriesForContext(db, userId, { limit?, maxAgeDays? })
buildMemoryContextBlock(memories, snapshots, userMemories?): string
```

- Default limits: workspace 20, 30 days; snapshots 10, 14 days; user 10, 90 days
- Freshness hints (`[2d ago]`) added for model weighting
- Excludes superseded memories

### Code Summary: Rail Completion → Memory

```typescript
// webapp/server/src/railsRoutes.ts
async function writeRailCompletionMemory(workspaceId, rail): Promise<void> {
  await supabaseAdmin.from("workspace_memories").insert({
    workspace_id: workspaceId,
    node_id: rail.logicPath?.[0]?.nodeId ?? null,
    content: `Rail ${rail.id} archived: ${rail.outcome}. archetype: ${rail.archetype}. tasks: ${completed}/${total} completed`,
    memory_type: "rail_completion",
  });
}
```

---

## 4. Context Window

### Limits

| Constant | Value | Location |
|----------|-------|----------|
| `CONTEXT_WINDOW_SAFE` | 180,000 tokens | `src/agent/tokenBudget.ts` |
| Claude model limit | ~200K | Implicit |
| Reserve for output | 4,000 | `claudeEnricher.ts` |
| History budget (manager) | 60,000 | `manager.ts` |
| Rail token budget default | 100,000 | `tokenBudget.ts` |

### Pre-Send Trim (Main Chat)

```typescript
// src/ai/claudeEnricher.ts
// Pre-send trim: avoid exceeding model context window (200K; we cap at 180K)
if (totalEst > CONTEXT_WINDOW_SAFE - reserveForOutput) {
  const toTrim = totalEst - (CONTEXT_WINDOW_SAFE - reserveForOutput);
  contextText = trimTextToBudget(contextText, Math.max(0, contextEst - toTrim));
}
```

### Token Estimation

```typescript
// src/ai/contextTrim.ts
export function estimateTokens(text: string): number {
  return Math.ceil((text?.length ?? 0) / 4);  // ~4 chars/token heuristic
}
```

### Trim Functions

```typescript
// src/ai/contextTrim.ts
trimHistoryToBudget(messages, budget, fractionForRecent = 0.8): TrimMessage[]
trimTextToBudget(text, budget): string
```

- Keeps most recent messages within budget
- Replaces dropped turns with a digest: `(Prior N turns, latest): role: content…`

### Token Budget Controls

```typescript
// src/agent/tokenBudget.ts
getTokenUsage(), getTokenBudget(), addTokenUsage(count)
setTokenBudget(value), extendBudget(amount = 20_000)
isOverBudget(), isWarningThreshold()  // 80%
resetTokenBudget()
const CEILING = CONTEXT_WINDOW_SAFE;
```

---

## 5. LangGraph & LangChain Orchestration

**The codebase does not use LangGraph or LangChain for orchestration.**

- **Rail flow** is custom: `orchestrator.ts` + `manager.ts` + `entrypoints.ts` / `extension.ts`
- **LangChain** appears only in `enricher-v2.ts` as a detected package for layer assignment (e.g. `packages: /^(langchain|@langchain)/` → provider `langchain`), not for orchestration
- **No LangGraph**: no graph-based agent workflows; rails use the explicit state machine above

---

## 6. Jira Configuration

### Storage

- **Per-user**: `integrations` table
  - `user_id`, `provider = 'jira'`
  - `base_url`, `email`, `api_token` (encrypted), `default_project`
  - `verified`, `verified_at`, `last_error`
- **Per-workspace**: `workspaces.jira_project_key`

### API Endpoints

| Route | Purpose |
|-------|---------|
| `GET /jira-status` | Whether user has Jira connected |
| `GET /jira-projects` | List projects for dropdown |
| `GET /jira-issues` | Search issues (with stale Jira detection) |
| `POST /jira-add-label` | Add label to issue |
| `POST /integrations/jira` | Save & verify credentials |
| `DELETE /integrations/jira` | Disconnect |

### Config Retrieval

```typescript
// webapp/server/src/jiraConfig.ts
export async function getUserJiraConfig(userId): Promise<UserJiraConfig | null>
export async function getUserJiraConfigWithSource(userId): Promise<UserJiraConfigWithSource | null>
```

- Fetches `integrations` for `user_id` + `provider = 'jira'` + `verified = true`
- Decrypts `api_token`; on failure throws `JiraDecryptError` and marks integration unverified

### Integration Save Flow

```typescript
// webapp/server/src/integrationRoutes.ts
POST /integrations/jira
// Body: baseUrl, email, apiToken, defaultProject
// 1. Test auth: GET {baseUrl}/rest/api/3/myself
// 2. Encrypt api_token
// 3. Upsert integrations (onConflict: user_id, provider)
```

### Stale Jira Detection

```typescript
// src/agent/staleJiraDetector.ts
export function extractFingerprintFromDescription(issue: JiraIssueWithFingerprint): { fingerprint, module } | null
export function detectStaleJira(graph, issuesWithFp): StaleJiraMismatch[]
```

- Compares stored fingerprints in Jira descriptions with current graph
- `arch-fingerprint:`, `arch-module:` in description

---

## 7. Tracing of LLM

### Architecture

| Component | Role |
|-----------|------|
| `src/agent/traceLogger.ts` | Emit, subscribe, collect traces |
| `toolExecutor.ts` | Emit on tool execution |
| `llmClient.ts` | Emit on LLM calls |
| `claudeEnricher.ts` | Emit on architect LLM + tool use |

### Trace Step Types

```typescript
// src/agent/types.ts
type TraceStepType =
  | "plan"
  | "read_file" | "get_ast" | "write_file" | "commit_file"
  | "run_lint" | "run_vitest" | "run_playwright"
  | "diff_graph" | "gate"
  | "llm_call" | "llm_tool" | "llm_reasoning"
  | "error" | "jira" | "context_write";
```

### Trace Types

**Legacy `TraceEntry`** (step-oriented):

```typescript
interface TraceEntry {
  id: string;
  sessionId: string;
  timestamp: string;  // ISO 8601
  stepType: TraceStepType;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  decision: string;
  reasoning?: string;
  llmCallCount?: number;
  tokenUsage?: number;
}
```

**Agent `AgentTrace`** (role-oriented):

```typescript
interface AgentTrace {
  id: string;
  railId?: string;
  taskId?: string;
  role: "executor" | "reviewer" | "manager";
  type: "info" | "tool_call" | "critic_feedback" | "error";
  message: string;
  timestamp: number;
  metadata?: { logicPathStep?, filePath?, tokens?, cost?, divergedNodeIds? };
}
```

### Trace API

```typescript
// src/agent/traceLogger.ts
emitTrace(entry: Omit<AgentTrace, "id" | "timestamp">): AgentTrace
emitTrace(stepType, input, output, decision, opts?): TraceEntry  // legacy
subscribeTrace(cb: (entry: TraceEntry) => void): () => void
subscribeAgentTrace(cb: (entry: AgentTrace) => void): () => void
getAgentTraces(): AgentTrace[]
collectRecentReasoning(railId, windowN): Array<{ message, timestamp, role, type }>
setTraceContext(ctx), clearTraceContext(), getTraceContext()
```

### Emit Sites

- **llm_call**: `claudeEnricher`, `llmClient`, `llmRailClient` — after each LLM request
- **llm_reasoning**: tool-use blocks in Claude response
- **read_file, write_file, get_ast, run_lint, run_vitest**: `toolExecutor`
- **error**: tool failures, LLM errors

---

## 8. Reasoning

### Definitions

- **Reasoning trace**: Human-readable steps and metadata for explainability (`reasoningSteps`, `citations` in types).
- **Reasoning samples**: Text from trace entries used for intent drift (`collectRecentReasoning`).

### Reasoning Flow

1. **LLM calls**: Each architect/code_writer call is traced with `llm_call` or `llm_reasoning`.
2. **collectRecentReasoning**: Filters `agentTraces` by `railId` and `type in (info, critic_feedback, error)`, returns last N for intent drift.
3. **Intent drift**: `computeIntentDriftScore` compares `intentSummary` (or `frozenOutcome`) with reasoning samples via embeddings.

### Intent Drift

```typescript
// src/ai/intentDrift.ts
export async function computeIntentDriftScore(
  rail: Rail,
  reasoningSamples: IntentDriftSample[],
  apiKey?: string
): Promise<number | null>
```

- Uses `text-embedding-ada-002` (OpenAI)
- Cosine similarity between intent summary and reasoning vectors
- Drift = `1 - avg(similarity)`; clamped [0, 1]
- If drift > 0.6: materialize blocked until acknowledged (same as hallucination)

### Code Writer “Reasoning Step”

```typescript
// src/agent/llmClient.ts
emitTrace("llm_call", inputForTrace, { tokens: totalTokens }, "Code writer reasoning step");
```

---

## 9. Hallucination Detection

### Definition

**Hallucination index** = mismatch between **intended** nodes (from `logicPath`) and **actually touched** nodes during execution.

### Implementation

```typescript
// src/agent/rail/archetypes.ts
export function computeHallucinationIndex(
  intendedPath: LogicPathStep[],
  actuallyTouchedNodeIds: string[]
): number
```

**Logic:**

1. `intendedIds` = node IDs from `logicPath`
2. `touchedSet` = node IDs touched by executor
3. `coverage` = matched / intendedIds.size
4. `driftPenalty` = extra touched nodes not in intended path
5. Index = `1 - coverage + driftPenalty`, clamped [0, 1]

Higher index ⇒ more drift (“hallucination”).

### Storage

- `rail.hallucinationIndex`
- `rail.hallucinationAcknowledgedAt` — timestamp when user acknowledged drift

### Guards

```typescript
// src/agent/rail/orchestrator.ts — completeMaterializeAndArchive
if (hallucinationIndex > 0.5 && !hallucinationAcknowledgedAt) return null;
if (intentDriftScore > 0.6 && !hallucinationAcknowledgedAt) return null;
```

Materialization is blocked until the user acknowledges.

### UI

- Confidence bar: `(1 - hallucinationIndex) * 100`
- Drift badge when `hallucinationIndex > 0.5`
- “Acknowledge drift” action sets `hallucinationAcknowledgedAt`

### Computation Trigger

- After plan approval: `computeHallucinationIndex(rail.logicPath, touchedNodeIds)`
- Touched nodes come from session/execution paths (e.g. `sessionTouchedPaths`)

---

## Summary Table

| Area | Primary location | Key config |
|------|------------------|------------|
| Stateflow | `orchestrator.ts` | 11 states, guards for EXECUTING/MATERIALIZING/ARCHIVED |
| Short-term memory | `context.ts`, `manager.ts`, `sessionPersistence.ts` | 60K history, rail-scoped 12 msgs |
| Long-term memory | Supabase + `.archy.md` + anti-patterns | workspace_memories, user_memories, rail_completion |
| Context window | `tokenBudget.ts`, `contextTrim.ts`, `claudeEnricher.ts` | 180K cap, 4K reserve, 60K history |
| LangGraph/LangChain | N/A | Not used for orchestration |
| Jira | `jiraConfig.ts`, `integrationRoutes.ts`, `jira.ts` | Per-user integrations, per-workspace project key |
| Tracing | `traceLogger.ts` | TraceStepType, AgentTrace, emit on tools + LLM |
| Reasoning | `intentDrift.ts`, `collectRecentReasoning` | Embeddings, cosine similarity |
| Hallucination | `archetypes.ts`, `orchestrator.ts` | Path vs touched, HITL lock at > 0.5 |
