# STELLA — Rails, Tracing & Sandbox: Complete Implementation TODOs

> Every item is required. Nothing is optional. Order within sections reflects dependency — do not skip ahead.

---

## Section 0 — Entry Points & Trigger Model

### 0.1 — Define `RailTrigger` union type
**File:** `src/agent/types.ts`
```typescript
export type RailTrigger =
  | { source: 'governance';  violationId: string }
  | { source: 'chat';        userMessage: string; sessionId: string }
  | { source: 'jira';        jiraKey: string; changeType: 'created' | 'updated' | 'assigned' }
```

### 0.2 — Implement `triggerFromViolation`
**File:** `src/agent/entrypoints.ts`
- Called when Governance scanner detects a new/unresolved `ArchViolation`
- Creates Rail with `trigger.source = 'governance'`, `state = 'PRE_PLANNING'`
- Passes to `RailManager.createRail`

### 0.3 — Implement `triggerFromChat`
**File:** `src/agent/entrypoints.ts`
- Called when user sends a message in `ChatPanel` expressing change intent
- Creates Rail with `trigger.source = 'chat'`, outcome = raw message (refined by `plan_node` later)

### 0.4 — Implement `triggerFromJira`
**File:** `src/agent/entrypoints.ts`
- Called when Jira webhook fires
- **Before creating:** check `RailRegistry.index.byJira[event.issue.key]` for existing active Rails
- If one exists: call `RailManager.resumeRail(existingRailId, event)` — never duplicate
- If none: create Rail with `trigger.source = 'jira'`
- This is what makes collaboration adaptive

---

## Section 1 — Core Type Definitions

### 1.1 — `RailId` and `TaskId`
```typescript
export type RailId = string;
export type TaskId = string;
```

### 1.2 — `RailState` lifecycle enum
```typescript
export type RailState =
  | 'PRE_PLANNING' | 'PLANNING' | 'AWAITING_APPROVAL'
  | 'EXECUTING' | 'AWAITING_HITL' | 'VERIFYING'
  | 'SELF_CORRECTING' | 'MATERIALIZING'
  | 'ARCHIVED' | 'SUSPENDED' | 'FAILED'
```

### 1.3 — `LogicPathStep`
```typescript
export interface LogicPathStep {
  step:     number;
  layer:    'UI' | 'API' | 'Service' | 'Infrastructure' | 'External';
  nodeId:   string;
  filePath: string;
  action:   string;
}
```

### 1.4 — `RailOverlap`
```typescript
export interface RailOverlap {
  railId:      RailId;
  sharedJira:  string[];
  sharedNodes: string[];
  flaggedBy:   'reviewer';
  flaggedAt:   number;
  suggestion:  string;
}
```

### 1.5 — `Rail` interface
```typescript
export interface Rail {
  id:           RailId;
  version:      number;        // increments on every mutation
  outcome:      string;
  trigger:      RailTrigger;
  archetype?:   string;
  logicPath:    LogicPathStep[];
  state:        RailState;
  activeAgent:  'executor' | 'reviewer' | null;
  tasks:        Task[];
  jiraKeys:     string[];
  traceIds:     string[];
  overlaps:     RailOverlap[];
  createdAt:    number;
  updatedAt:    number;
  createdBy:    'agent' | 'human';
  sessionId:    string;
  snapshotPath?: string;
}
```

### 1.6 — `Task` interface
```typescript
export type TaskKind = 'code_change' | 'governance_violation' | 'governance_sync' | 'verification' | 'meta';
export type TaskStatus = 'pending' | 'executing' | 'awaiting_hitl' | 'completed' | 'rejected' | 'skipped';
export type TaskAgent = 'executor' | 'reviewer';

export interface Task {
  id:          TaskId;
  railId:      RailId;
  kind:        TaskKind;
  description: string;
  files:       string[];
  autoCapable: boolean;
  status:      TaskStatus;
  agent:       TaskAgent;
  logicStep:   number;
  evidence?:   string;
  hitlPrompt?: string;
  jiraKey?:    string;
  createdAt:   number;
  resolvedAt?: number;
}
```

### 1.7 — `RailStateSnapshot` (runtime object threaded through graph)
```typescript
export interface RailStateSnapshot {
  railId:             RailId;
  logicPath:          LogicPathStep[];
  activeTaskIds:      TaskId[];
  tokenUsage:         number;
  llmCallCount:       number;
  retryCount:         number;
  hallucinationIndex: number;  // 0–1; elevated when executor touches nodes outside logicPath
}
```

### 1.8 — `RailTelemetry`
```typescript
export interface RailTelemetry {
  railId:             RailId;
  critiqueLoopCount:  number;
  tokenUsage:         number;
  llmCallCount:       number;
  playwrightPasses:   number;
  playwrightFailures: number;
  pathSuccessRate:    number;
  taskLatencies:      Record<TaskId, number>;
}
```

### 1.9 — `AgentTrace` (updated)
```typescript
export interface AgentTrace {
  id:        string;
  railId?:   RailId;
  taskId?:   TaskId;
  role:      'executor' | 'reviewer' | 'manager';
  type:      'info' | 'tool_call' | 'critic_feedback' | 'error';
  message:   string;
  timestamp: number;
  metadata?: {
    logicPathStep?: string;
    filePath?:      string;
    tokens?:        number;
    cost?:          number;
  };
}
```

### 1.10 — `TasksPanelViewModel` (webview data contract)
```typescript
export interface TasksPanelViewModel {
  railId:      RailId;
  outcome:     string;
  state:       RailState;
  archetype?:  string;
  progress:    { completed: number; total: number };
  activeAgent: TaskAgent | 'human' | null;
  tasks: {
    id: TaskId; label: string; kind: TaskKind; status: TaskStatus;
    agent: TaskAgent; isHitl: boolean; evidence?: string; jiraKey?: string;
  }[];
  jiraLinks:     { key: string; url: string; title: string }[];
  collaborators: { railId: RailId; outcome: string; sharedWith: string[] }[];
  telemetry:     { tokenUsage: number; critiqueLoopCount: number; pathSuccessRate: number };
  canMaterialize: boolean;
  canSuspend:     boolean;
}
```

---

## Section 2 — Rail Registry

### 2.1 — `RailRegistry` type
```typescript
export interface RailRegistry {
  version:   number;
  updatedAt: number;
  index: {
    byJira:    Record<string, RailId[]>;
    byNode:    Record<string, RailId[]>;
    byState:   Record<RailState, RailId[]>;
    bySession: Record<string, RailId[]>;
  };
  rails: Record<RailId, { id: RailId; outcome: string; state: RailState; jiraKeys: string[]; updatedAt: number }>;
}
```

### 2.2 — Implement `registry.ts`
**File:** `src/agent/rail/registry.ts`
- `loadRegistry(rootPath)` — reads `.agent/rail_registry.json`; creates empty if missing
- `saveRegistry(rootPath, registry)` — atomic write (`.tmp` then rename)
- `registerRail(registry, rail)` — adds to all index buckets
- `deregisterRail(registry, railId)` — removes from all index buckets
- `updateRailInRegistry(registry, rail)` — updates pointer and re-indexes

### 2.3 — Implement collision detection
**File:** `src/agent/rail/collisions.ts`
```typescript
export async function checkRailCollisions(
  rail: Rail, registry: RailRegistry, loadRail: (id: RailId) => Rail
): Promise<RailOverlap[]>
```
- For each `jiraKey` in `rail.jiraKeys`: find siblings in `registry.index.byJira`
- For each `logicPath` step: find siblings in `registry.index.byNode`
- Compare nodeIds, build `RailOverlap[]`
- **Overlaps are UI warnings only, never hard blocks**

---

## Section 3 — Rail Manager

### 3.1 — Implement `RailManager`
**File:** `src/agent/rail/manager.ts`

All methods required:
- `createRail`, `resumeRail`, `getRail`, `updateRailState`, `updateRailVersion`
- `createTask`, `getTask`, `updateTaskStatus`, `getTasksByRail`, `getRailsByJiraKey`
- `saveRails(rootPath)`, `loadRails(rootPath)`
- `archiveRail(railId)` — state → ARCHIVED, write snapshot, stamp Jira
- `suspendRail(railId)` — state → SUSPENDED
- `failRail(railId, reason)` — state → FAILED, create HITL escalation

Storage layout:
```
.agent/rail_registry.json
.agent/rails/{railId}.json
.agent/rails/templates/{archetype}.json
.agent/rails/anti-patterns/{timestamp}-{railId}.json
```

### 3.2 — Attach canonical Rails to existing flows in `extension.ts`
- `rail:governance:view-issues` — created/updated when `fetchJiraTests` runs
- `rail:violations:create-ticket` — created/updated when `createViolationJira` runs

### 3.3 — Map `AgentPlan` tasks to `Task` entries
- After `validatePlan` succeeds: for each plan task call `RailManager.createTask`
- Maintain `agentPlanTaskId → TaskId` map for status sync
- Call `updateTaskStatus` on diff approval, lint pass, test pass

---

## Section 4 — Rail Archetypes & Logic Path Inference

### 4.1 — Define built-in archetypes
**File:** `src/agent/rail/archetypes.ts`
```typescript
export const RAIL_ARCHETYPES = {
  'ui-api-external':     { layers: ['UI', 'API', 'External'] },
  'ui-api-persistence':  { layers: ['UI', 'API', 'Infrastructure'] },
  'governance-violation':{ layers: ['Service', 'Infrastructure'] }
} as const;
export type RailArchetype = keyof typeof RAIL_ARCHETYPES;
```

### 4.2 — Implement `inferLogicPath`
**File:** `src/agent/rail/logicPath.ts`
```typescript
export function inferLogicPath(
  outcome: string, archGraph: ArchGraph,
  archetype: RailArchetype, seedNodeIds?: string[]
): LogicPathStep[]
```
- Identify seed nodes from `seedNodeIds` or by matching keywords in `outcome` against ArchGraph nodes
- Traverse edges following the archetype's layer order
- Return ordered `LogicPathStep[]`

### 4.3 — Implement `computeHallucinationIndex`
**File:** `src/agent/rail/logicPath.ts`
```typescript
export function computeHallucinationIndex(
  intendedPath: LogicPathStep[], actuallyTouchedNodeIds: string[]
): number
```
- Compare intended nodeIds vs actually modified nodeIds
- Returns 0–1 score (0 = perfect alignment, 1 = total drift)
- When score > 0.5: emit `AgentTrace` with `role: 'reviewer'`, `type: 'critic_feedback'` flagging drift
- Store in `RailStateSnapshot.hallucinationIndex`

---

## Section 5 — State Machine

### 5.1 — Define all 7 graph nodes
**File:** `src/agent/rail/graph.ts`

| Node | Agent | Responsibility |
|---|---|---|
| `plan_node` | executor | `inferLogicPath` + produce `Task[]` → state: `AWAITING_APPROVAL` |
| `hitl_approve_plan` | human | **Blocking.** Approve → `EXECUTING`. Reject → `SUSPENDED`. |
| `executor_node` | executor | Run tasks in sandbox, emit traces → state: `VERIFYING` |
| `hitl_gate_node` | human | Fires every 2–3 tasks or on `awaiting_hitl`. Approve → continue. Reject → `SUSPENDED`. |
| `reviewer_node` | reviewer | Lint + Vitest + Playwright + `computeHallucinationIndex`. Pass → `MATERIALIZING`. Fail → `SELF_CORRECTING`. |
| `materialize_node` | executor | **Blocking.** Human approves → copy sandbox to `src/` → state: `ARCHIVED` |
| `archive_node` | system | Save snapshot, update registry, stamp Jira, update template_library |

### 5.2 — Self-correction loop hard limit
- Track retries in `RailStateSnapshot.retryCount`
- **Maximum 3 cycles.** On 4th failure: call `failRail`
- `failRail` triggers HITL modal: "Investigate manually" / "Create Jira" / "Abandon rail"

### 5.3 — State transition guards
- Cannot enter `EXECUTING` without `hitl_approve_plan` approval
- Cannot enter `MATERIALIZING` without Reviewer passing
- Cannot enter `ARCHIVED` without `materialize_node` completing
- Cannot resume `SUSPENDED` without re-entering `hitl_approve_plan`
- `FAILED` is terminal — no automated transitions out

---

## Section 6 — Sandboxing

### 6.1 — Sandbox directory layout
```
{rootPath}/.agent/sandboxes/rail-{id}/
```
- Add `.agent/sandboxes/` to `.gitignore`
- Created when Rail enters `EXECUTING`
- Deleted when Rail enters `ARCHIVED` or `FAILED`

### 6.2 — Route all Executor writes to sandbox
**File:** `src/agent/rail/executor.ts`
- All file writes resolve relative to `{rootPath}/.agent/sandboxes/rail-{id}/`
- HITL diff preview must label changes as "sandbox — not yet in src/"

### 6.3 — Update `runLint`, `runVitest`, `runPlaywrightTrace` to accept `workingDir`
- Add required `workingDir: string` param to each
- Pass `cwd: workingDir` to all `spawnSync` calls
- In `extension.ts`, pass rail's sandbox path for verification

### 6.4 — Implement `materializeRail`
**File:** `src/agent/rail/executor.ts`
```typescript
export function materializeRail(railId: RailId, sandboxPath: string, rootPath: string): MaterializationResult
```
- Copies changed files from sandbox to real `src/`
- Records materialized files in Task evidence
- On any copy failure: abort entirely, leave `src/` untouched, return error for HITL

---

## Section 7 — Playwright Integration

### 7.1 — Add VS Code config key
In `package.json` contributes.configuration:
```json
"archVisualizer.playwrightSpecs": {
  "type": "array", "items": { "type": "string" },
  "description": "Spec paths/globs for UI rail verification."
}
```

### 7.2 — Implement `runPlaywrightForRail`
**File:** `src/agent/runPlaywrightTrace.ts`
```typescript
export async function runPlaywrightForRail(
  railId: RailId, projectRoot: string, sandboxPath: string,
  specs: string[], baseUrl: string
): Promise<PlaywrightOutput>
```
- Runs each spec against `sandboxPath`
- Emits `AgentTrace` per spec (`role: 'reviewer'`, `railId`, `taskId`)
- Attaches screenshot paths and failure summaries to verification `Task.evidence`

### 7.3 — Wire Playwright into post-diff approval
**File:** `src/extension.ts`
After `agentDiffApprove` + lint + Vitest pass:
- Check `rail.logicPath.some(step => step.layer === 'UI')`
- If yes: call `runPlaywrightForRail` with rail's sandbox path
- Set `GateCheckContext.playwrightPassed` from result
- Update verification Task status and `RailTelemetry`

### 7.4 — Gate and HITL on Playwright failure
When `playwrightPassed === false`:
- Run `errorClassifier`
- HITL modal with: failing tests, screenshots, options:
  - "Investigate in UI" — open Playwright trace viewer
  - "Create Jira for this failure"
  - "Retry" — back to `SELF_CORRECTING` (counts against limit)
  - "Suspend rail"

---

## Section 8 — Tracing

### 8.1 — Update `emitTrace` signature
```typescript
export function emitTrace(entry: Omit<AgentTrace, 'id' | 'timestamp'>): void
```
- Auto-generates `id` (UUID) and `timestamp` (Date.now()) internally
- `railId` and `taskId` required wherever an active Rail exists

### 8.2 — Tag all existing call sites with `role`
- `role: 'executor'` — plan execution, code changes, tool calls
- `role: 'reviewer'` — critic feedback, verification results
- `role: 'manager'` — gates, budget decisions, state transitions

### 8.3 — Attach `logicPathStep` and `filePath` to traces
- Resolve active `LogicPathStep` from `RailStateSnapshot`
- Set `metadata.logicPathStep` and `metadata.filePath` on all Rail-scoped traces

### 8.4 — Persist traces per Rail on archive
- Collect all `AgentTrace` entries with matching `railId`
- Include in Rail snapshot under `traces` field
- Every archived Rail must be fully self-contained and auditable

### 8.5 — Update `AgentTracePanel` with Rail filtering
- Filter by `railId`, `role`, `type`
- Show `logicPathStep` badge
- "Jump to task" link from trace entry → `TasksPanel`
- "Jump to rail" link from trace entry → Rail in `TasksPanel`

---

## Section 9 — Context Window & Cost Controls

### 9.1 — Implement tiered context builder
**File:** `src/agent/rail/context.ts`
```typescript
export function buildRailContext(rail: Rail, fullHistory: ChatMessage[], tokenBudget: number): ChatMessage[]
```
- **Tier 1 (always):** Rail summary — outcome + logicPath + key decisions. Max 500 tokens.
- **Tier 2 (recent):** Last N messages scoped to this rail's `sessionId`. Trim oldest first on budget overrun.
- **Tier 3 (on-demand):** Skill code injected only when referenced by name.
- When Tier 2 exceeds budget: summarize into "rail history digest" system message, drop raw turns, store digest in `RailStateSnapshot`

### 9.2 — Feed rail-scoped usage into `GateCheckContext`
```typescript
gateContext.tokenUsage   = railState.tokenUsage;
gateContext.llmCallCount = railState.llmCallCount;
gateContext.tokenBudget  = configuredBudgetPerRail;
```

### 9.3 — HITL modal for cost gate
When `token_budget_exceeded` or `session_llm_limit` fires:
- Blocking modal showing: current usage, estimated cost
- Options: "Extend budget" / "Abort rail" / "Create Jira to continue later"

---

## Section 10 — Telemetry & Institutional Memory

### 10.1 — Maintain `RailTelemetry` in real time
- Increment `critiqueLoopCount` each time `reviewer_node` rejects
- Accumulate `tokenUsage` and `llmCallCount` after each LLM call
- Compute `pathSuccessRate` = tasks passing verification first-try / total tasks
- Record `taskLatencies` for each Task on resolution

### 10.2 — Save telemetry with Rail snapshot
- Include `RailTelemetry` in `.agent/rails/{id}.json` on archive — not stored separately

### 10.3 — Promote successful Rails to canonical templates
When `archive_node` runs with all verification tasks green:
- Write to `.agent/rails/templates/{archetype}.json`: outcome, logicPath, task descriptions, telemetry
- `plan_node` loads this template as starting point for same-archetype Rails

### 10.4 — Record failed intent maps as anti-patterns
When `failRail` is called:
- Write to `.agent/rails/anti-patterns/{timestamp}-{railId}.json`: intendedOutcome, archetype, logicPath, last rejection reason, `critiqueLoopCount`
- `plan_node` loads anti-patterns for same archetype and injects as system-level warnings

### 10.5 — Track skill performance metadata
**File:** `src/agent/rail/telemetry.ts`
- Per skill: `usageCount`, `approvalRate` (led to Reviewer approval vs retry), `lastUsedAt`
- Store at `.agent/skill_performance.json`
- In `plan_node`: prefer skills with higher `approvalRate`
- Flag skills with `approvalRate < 0.4` for refactoring

---

## Section 11 — UI: Tasks Panel & Rails Surfacing

### 11.1 — Implement message protocol
Extension → webview:
```typescript
{ type: 'tasksSnapshot', rails: RailDTO[], tasks: TaskDTO[], telemetry: Record<RailId, RailTelemetry> }
{ type: 'taskUpdate',    taskId: TaskId,   update: Partial<Task> }
{ type: 'railUpdate',    railId: RailId,   update: Partial<Rail> }
```
Webview → extension:
```typescript
{ type: 'taskAction', taskId: TaskId, action: 'approve' | 'reject' | 'take_ownership' }
{ type: 'railAction', railId: RailId, action: 'suspend' | 'resume' | 'abandon' }
```

### 11.2 — Add `rails` and `tasks` state to `App.tsx`
- State: `rails: Rail[]`, `tasks: Task[]`, `railTelemetry: Record<RailId, RailTelemetry>`
- Handle `tasksSnapshot`, `taskUpdate`, `railUpdate` in message handler
- Derive: `openVerificationTasks`, `hitlPendingTasks`, `collaboratorWarnings`

### 11.3 — Implement `TasksPanel`
- Rails listed with: outcome, state badge, archetype, progress bar
- Tasks per Rail: numbered ID, description, kind chip, status chip, agent badge, Jira link
- Red border on tasks where `isHitl === true` or `status === 'blocked'`
- Approve / Reject buttons on `isHitl` tasks only
- Telemetry row per Rail: token usage, critique loop count, path success rate
- Collaborator badge: "N other rails touch this feature"

### 11.4 — Place `TasksPanel` in sidebar
- Below Governance, above Agent tools
- Badge count on header for `hitlPendingTasks.length`

### 11.5 — Implement `RailCollaboratorBadge`
- Rendered when `rail.overlaps.length > 0`
- Shows count, expands to list each overlapping Rail with outcome, state, shared nodes
- Links to overlapping Rail's task list

### 11.6 — Augment `AgentTracePanel`
- Filter by `railId`, `role`, `type`
- `logicPathStep` badge per entry
- "Jump to task" and "Jump to rail" links per entry

---

## Section 12 — Persistence & Session Integration

### 12.1 — Load rails on extension activation
- Call `RailManager.loadRails(rootPath)` and `loadRegistry(rootPath)`
- Emit initial `tasksSnapshot` to webview

### 12.2 — Save rails incrementally
- After every Rail/Task state change: `RailManager.saveRails(rootPath)`
- After every registry mutation: `saveRegistry(rootPath)`
- Always atomic writes — `.tmp` then rename

### 12.3 — Clean stale sandboxes on activation
- Delete sandbox for any Rail in `ARCHIVED` or `FAILED` state
- Delete sandbox for any Rail in `SUSPENDED` state > 7 days, emit warning trace

---

## Section 13 — Dogfood First Rail (Acceptance Test)

This section validates the entire implementation. All prior sections must be complete first.

**Outcome:** `"Governance 'View Issues' button always shows live, filtered Jira data for the selected project"`

**Logic path:**

| Step | Layer | File | Action |
|---|---|---|---|
| 1 | UI | `webview-ui/src/App.tsx` | `RENDER_VIEW_ISSUES_BUTTON` |
| 2 | UI | `webview-ui/src/components/GovernancePanel.tsx` | `PASS_ACTIVE_PROJECT_ID` |
| 3 | API | `extension.ts` | `HANDLE_FETCH_JIRA_TESTS` |
| 4 | Service | `src/agent/jiraClient.ts` | `CALL_JIRA_GET_ISSUES` |
| 5 | External | Jira Cloud API | `RETURN_FILTERED_ISSUES` |

**Acceptance criteria — all must pass:**

- [ ] Rail created with correct trigger, logicPath, tasks
- [ ] State machine transitions correctly through all 7 nodes
- [ ] HITL gates block at T3 and T6
- [ ] Executor writes go to sandbox, not `src/`
- [ ] Playwright runs against sandbox, result sets `GateCheckContext.playwrightPassed`
- [ ] On Playwright pass, Rail enters `MATERIALIZING`
- [ ] On human approval, sandbox files move to `src/`
- [ ] Rail archived at `.agent/rails/{id}.json` with telemetry and traces
- [ ] Jira ticket stamped with Rail ID
- [ ] Archetype template written to `.agent/rails/templates/ui-api-external.json`
- [ ] `TasksPanel` shows all tasks with correct status and HITL controls
- [ ] `AgentTracePanel` traces filterable by `railId`
- [ ] `RailCollaboratorBadge` renders correctly when sibling rail exists
- [ ] Registry persists correctly across VS Code restarts

