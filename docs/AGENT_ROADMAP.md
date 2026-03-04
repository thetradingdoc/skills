# Arch Visualizer — Agent Roadmap v4

**What this document covers:** Architectural quality signal taxonomy, agent loop design, planning discipline, HITL gates, error routing, context management, tool definitions, security boundaries, Jira fingerprinting, observability, and implementation order.

---

## 0. Architectural Quality — The Evaluation Framework

This is the shared reference for the scanner, enricher, Arch Planner system prompt, and rules generator. Every component that judges architecture quality uses these signals and thresholds. Without this, each component makes different assumptions about what "bad" means.

### 0a. The Four Evaluation Dimensions

The agent evaluates architecture in this order. Earlier dimensions take priority.

**1. Structural integrity** — Do dependency directions comply with the layer model?
An edge from a lower layer to a higher one is a violation. Data Access importing from Presentation is always wrong. This is the most objective signal and is checked first.

**2. Responsibility coherence** — Does the module do one thing?
A module's exports, imports, and description should tell the same story. A module named `auth` that also imports from the email service and the analytics pipeline has leaked responsibility. Checked second because it requires semantic reasoning.

**3. Drift** — Does the written code match the intended plan?
New imports that weren't in the plan, edges that weren't approved, modules that moved layers without a plan update. Checked after every commit via `diff_graph`.

**4. Testability and documentation** — Is the boundary understood?
A module with no tests and no `.context.md` means the team can't describe what it does. This is a health signal, not a hard violation, but it compounds over time.

### 0b. Structural Signal Thresholds

These are the specific measurements the scanner extracts and scores. They map directly to `ArchNode.health` in the data model.

| Signal | How Computed | Warning Threshold | Bad Threshold | What It Means |
|--------|-------------|-------------------|---------------|---------------|
| **Fan-in** | Count of modules that import this module | > 8 | > 15 | High fan-in is fine for utilities; bad for business logic |
| **Fan-out** | Count of external modules this module imports | > 6 | > 10 | Module knows too much about the rest of the system |
| **Fan-in + Fan-out simultaneously high** | Both fan-in > 5 AND fan-out > 5 | — | Both exceed 5 | Module is both a hub and a consumer — two jobs |
| **Circular dependency depth** | Shortest cycle length involving this module | Any cycle | — | Hard violation; always flagged regardless of length |
| **External import count** | Imports from outside `src/` (npm packages) | > 5 | > 10 | Module has too many external concerns |
| **Export count** | Number of exported symbols | > 15 | > 25 | Likely a dumping ground module |
| **File count in module** | Number of files grouped under the module path | > 8 | > 15 | Module boundary is too wide |
| **Missing context** | No `.context.md` and no README | Warning | — | Module is undocumented |
| **Missing tests** | No test files in or adjacent to module | Warning | — | Module is untested |

**Dumping ground detection:** A module is flagged as a dumping ground if it has export count > 15 AND its name contains `utils`, `helpers`, `common`, `shared`, or `misc`. The enricher treats these as `Uncategorized` regardless of import patterns.

**Health score mapping to `ArchNode.health`:**
- `green` — no warnings, no violations
- `amber` — one or more warnings, no hard violations
- `red` — any hard violation (circular dep, layer direction, bad fan-in+out, dump ground)

### 0c. Semantic Signal Thresholds

These require the Phase 3 semantic scanner. Until then, the enricher uses AI inference as an approximation.

| Signal | Source | What It Detects |
|--------|--------|-----------------|
| **Description vs import mismatch** | `get_ast` imports + enricher description | Module says it does X but imports suggest Y |
| **Layer hint from export names** | Export function/class names | React components → Presentation; `Repository`, `Model` → Data Access; `Service`, `Handler` → Business Logic |
| **Cohesion score** | Variance in import layers across files in a module | Files in a module touching different layers = low cohesion |
| **Naming convention violation** | Module name vs assigned layer | A module named `UserRepository` assigned to Presentation is a mismatch |

### 0d. Rule Categories in `.arch-rules.json`

The rules file is not just a list of allowed edges. It covers four categories:

```json
{
  "layerDirections": [
    { "from": "Presentation", "to": "Business Logic", "allowed": true },
    { "from": "Business Logic", "to": "Data Access", "allowed": true },
    { "from": "Data Access", "to": "Presentation", "allowed": false },
    { "from": "Business Logic", "to": "Presentation", "allowed": false }
  ],
  "moduleThresholds": {
    "maxFanOut": 10,
    "maxFanIn": 15,
    "maxExportCount": 25,
    "maxFileCount": 15,
    "maxExternalImports": 10
  },
  "namingConventions": [
    { "pattern": ".*Repository$", "expectedLayer": "Data Access" },
    { "pattern": ".*Service$", "expectedLayer": "Business Logic" },
    { "pattern": ".*Controller$|.*Page$|.*View$", "expectedLayer": "Presentation" }
  ],
  "denyList": [
    { "from": "src/data", "to": "src/ui", "reason": "Data layer must not import UI" }
  ]
}
```

The Arch Planner receives the full rules file in context. The rules generator (AI-powered) produces a fresh version of this file from the current graph when invoked.

### 0e. Arch Planner Evaluation Order

When the Arch Planner evaluates a plan or a `diff_graph` output, it must ask these four questions in order and stop at the first failure:

1. Does any planned edge violate `layerDirections`? → `layer_violation`
2. Does any module exceed `moduleThresholds`? → flag as `health: amber` or `health: red`
3. Does the written code (after commit) match the planned graph? → `drift` if not
4. Are there modules with no tests and no `.context.md`? → `health: amber`, surface to engineer

Only structural violations (questions 1 and 2) block the loop. Drift triggers `diff_graph` routing. Documentation gaps are surfaced as HITL alerts but do not stop execution.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          AGENT LOOP (with gates)                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   [Prompt] → [PLANNER] → [AgentPlan] → [HITL: Plan Review] ──► Continue    │
│                                    │                                         │
│                                    ▼                                         │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │ TOOL PHASE (sequential, verification after each write)                │  │
│   │   read_file / get_ast → write_file (staging) → [HITL: Diff Preview]  │  │
│   │   → commit_file → diff_graph → run_lint → run_vitest                 │  │
│   │   → run_playwright_trace                                              │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                         │
│                                    ▼                                         │
│   [Error?] → [ERROR CLASSIFIER] → Code Writer | Arch Planner | HITL         │
│                                    │                                         │
│                                    ▼                                         │
│   [Retry < N?] → loop back    OR   [HITL Gate] → pause, create Jira, alert  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Core principle:** The agent never writes code without a plan. It never commits code without a diff preview. It never retries indefinitely. Every pause condition is defined and handled explicitly.

---

## 2. Mandatory Planning Step

**Rule:** No tool call is dispatched until the agent has produced a structured plan and the engineer has approved it.

### Plan Schema

```ts
interface AgentPlan {
  goal: string;
  tasks: Array<{
    id: string;
    module: string;           // target module path (e.g. "src/services")
    layer: NodeLayer;         // layer assignment per §0d naming conventions
    action: "create" | "modify" | "refactor";
    expectedOutput: string;   // what success looks like — testable criterion
  }>;
  dependencies: Array<[string, string]>;  // [blocker_task_id, blocked_task_id]
}
```

### Plan Validation (Automated, Before Plan Review)

Run these checks before showing the plan to the engineer. On any failure, return the error to the model automatically — do not surface to HITL.

1. **JSON parse** — if output is not valid JSON, return parse error to model.
2. **Schema validation** — all required fields present and correctly typed.
3. **Dependency cycle detection** — topological sort on `dependencies`; if a cycle exists, return "Circular dependency detected between tasks X and Y."
4. **File conflict check** — expand each task's `module` to all file paths it contains. If any file path appears in more than one task's set, reject: "Tasks X and Y both touch path P. Split or merge tasks." Module containment is transitive: `src/services` and `src/services/index.ts` are in conflict.
5. **Layer rules check** — validate each task's `layer` against `layerDirections` in `.arch-rules.json`. A task planning to place a module in a layer that violates the rules triggers a `layer_violation` — route to Arch Planner, not shown to engineer yet.

### Plan Review Gate

After validation passes, surface the plan to the engineer:
- **UI:** "Agent Plan" panel in sidebar — task list, dependency graph, module targets, layer assignments.
- **Engineer actions:** Approve | Reject | Edit (edit returns to model with feedback).
- **Gate:** No tool calls dispatched until Approved.

### Why

- Mid-loop failures are diagnosable: you know exactly which task failed.
- HITL happens on intent, not code — reviewing a plan is faster than reviewing a diff.
- Layer violations are caught before any code is written.

---

## 3. HITL Gate Definitions

These are the **only** conditions that pause the loop and require human input.

| Gate | Condition | Action | UI |
|------|-----------|--------|-----|
| **Plan Review** | Agent produced a valid plan | Show plan, Approve / Reject / Edit | "Agent Plan" panel |
| **Layer Violation (Planning)** | Plan or `diff_graph` detects layer direction violation | Route to Arch Planner; if second replan fails → HITL | Alert banner |
| **Diff Preview** | Agent wrote to staging buffer | Show before/after diff, Approve / Reject / Edit | Diff Preview panel |
| **Scope Violation** | `write_file` targets path outside planned module or allowlist | Reject write, do not commit, log | Toast + Trace Panel |
| **Test Failure (N retries)** | Vitest or Playwright fails after `RETRY_LIMIT_CODE` retries | Pause, create Jira, show trace | HITL modal |
| **Runtime Failure (Untouched)** | Playwright fails on flow agent did not touch | Flag human, no retry | Alert + "Investigate" button |
| **Stale Jira Mismatch** | Fingerprint no longer matches open Jira issue | Retag / Archive / Keep per issue | Jira Sync panel |
| **Token Budget Exceeded** | Session token usage ≥ `TOKEN_BUDGET_SESSION` | Stop loop; Increase budget / Create Jira / Abort | HITL modal |
| **Session LLM Limit** | LLM call count ≥ `RETRY_LIMIT_SESSION` | Stop loop; Extend / Create Jira / Abort | HITL modal |
| **Jira Resolve Prompt** | Successful commit to module with open Jira issues | Batched table; Resolve / Keep / Dismiss per row | HITL modal |
| **Partial Plan Failure** | Task N fails after tasks 1..N-1 committed | Show committed state; Abort / Revert manually / Create Jira | HITL modal |
| **Rule Proposal** | Arch Planner outputs `propose_rule_change` | Show proposed diff + rationale; Accept / Reject / Edit | HITL modal |

### Gate Implementation

- Central `GateChecker` module evaluates conditions after each orchestration step.
- When a gate triggers: stop tool dispatch, emit to Trace Logger, render UI, await user action.
- Defined user action tokens: `approve`, `reject`, `edit_and_retry`, `create_jira_and_stop`, `extend_budget`, `abort`, `resolve_jira`, `keep_jira`, `dismiss_jira`, `accept_rule`, `reject_rule`.
- **Unknown LLM output:** If the model returns output that doesn't parse as any known type (tool call, `agent_plan`, `revised_plan`, `propose_rule_change`), log to trace, count against `RETRY_LIMIT_SESSION`, retry with: "Your last response was not a valid tool call or plan. Output only valid JSON matching one of the defined types."

---

## 4. Agent Definitions — Code Writer and Arch Planner

**Implementation:** Both are the same LLM endpoint with different system prompts and injected context. No separate services.

### Code Writer

| Property | Value |
|----------|-------|
| **Invoked when** | `ts_error`, `lint_error`, `vitest_failure_touched`, `playwright_failure_touched` |
| **System prompt** | "You are a code writer. Fix the error below. You may only edit files within the planned module scope. Output tool calls only: `read_file`, `write_file`, `run_lint`, `run_vitest`. Do not produce plans or rule changes." |
| **Context injected** | Error output (full stack trace, file, line, message), current file content, plan task id, `sessionTouchedPaths` |
| **Allowed outputs** | Tool calls only |
| **Retry limit** | `RETRY_LIMIT_CODE` (see §4a) |

### Arch Planner

| Property | Value |
|----------|-------|
| **Invoked when** | `layer_violation` from plan validation or `diff_graph` |
| **System prompt** | "You are an architecture planner. Evaluate using this order: (1) Does any edge violate `layerDirections`? (2) Does any module exceed `moduleThresholds`? (3) Does written code match the plan? (4) Are modules untested or undocumented? Fix the violation below by: moving the module to a valid layer, splitting it, or proposing a rule change. Do not edit code. Output: `revised_plan` fragment OR `propose_rule_change`." |
| **Context injected** | Violation details, full `.arch-rules.json`, current plan, affected module's `get_ast` output, `diff_graph` delta |
| **Allowed outputs** | `revised_plan` (partial plan fragment) OR `propose_rule_change` |
| **Retry limit** | `RETRY_LIMIT_ARCH` (see §4a) |

**Revised plans are not auto-applied.** A `revised_plan` is surfaced in the Plan Review UI as a delta — "Task 3 reassigned from Business Logic to Data Access — approve?" — and requires engineer approval before taking effect. Plan-before-act is preserved.

### HITL (Human in the Loop)

| Property | Value |
|----------|-------|
| **Invoked when** | `playwright_failure_untouched`, `vitest_failure_untouched`, `retry_limit_exceeded`, `jira_fingerprint_mismatch`, `scope_violation` (on untouched path) |
| **LLM call** | None |
| **Behaviour** | Loop pauses. UI surfaces the failure with context. Engineer decides: investigate, create Jira, abort, or manually fix and resume. |

---

## 4a. Retry Limits

| Constant | Default | Applies To | Counts | Reasoning |
|----------|---------|------------|--------|-----------|
| `RETRY_LIMIT_CODE` | 3 | Code Writer per task | LLM calls | Fixable in 1–2 retries; 3 avoids infinite loops |
| `RETRY_LIMIT_ARCH` | 2 | Arch Planner per violation | LLM calls | If second replan fails, rules are likely wrong → HITL |
| `RETRY_LIMIT_SESSION` | 50 | Entire session | LLM API calls only | `run_lint`, `run_vitest`, `read_file` do not count. 5 tasks × 2–3 LLM calls × retries ≈ 40–50 |

**Reset policy:** All counters reset when the engineer starts a new session (new goal). They do **not** reset between tasks within the same plan.

**Extension:** When `RETRY_LIMIT_SESSION` is hit, the HITL modal offers:
- **Extend:** Number input + "Add 20" default. Ceiling: 150 total. Apply immediately, no restart.
- **Create Jira for partial work.**
- **Abort.**

**Configuration:** All three constants are configurable via `archVisualizer.retryLimitCode`, `archVisualizer.retryLimitArch`, `archVisualizer.retryLimitSession`.

---

## 4b. Token and Cost Budget

| Setting | Default | Behaviour |
|---------|---------|-----------|
| `TOKEN_BUDGET_SESSION` | 100,000 tokens | Hard cap. When reached → stop loop, HITL |
| `TOKEN_WARNING_THRESHOLD` | 0.80 | At 80% → warning in Trace Panel AND Project Overview banner. Continue. |
| `COST_CAP_SESSION` | Optional (e.g. $2.00) | Estimate cost per call. Hard stop when reached. |

**80% warning channel:** Emit to both Trace Panel and Project Overview banner so the warning is visible regardless of which panel is active.

**When budget is exceeded:**
1. Stop loop immediately. No new tool calls.
2. HITL modal: Extend (+20,000 tokens default, ceiling 500,000) | Create Jira | Abort.
3. Attach trace to any Jira created.
4. Counters reset on new session.

---

## 5. Rails & Memory Architecture (v4)

### 5.1 Rail Scope Locking and Outcome Anchor

- Each rail is created in planning states (`PRE_PLANNING`, `PLANNING`, `AWAITING_APPROVAL`) with a mutable `outcome` and `logicPath`.
- On first transition into `EXECUTING`, the rail's scope is frozen:
  - `frozenOutcome` is set from the current `outcome`.
  - `frozenLogicPath` is set from the current `logicPath`.
  - `baselineNodeIds` is derived from `logicPath.step.nodeId` (unique, non-empty).
- After this point, partial updates in execution/verification states cannot mutate `outcome` or `logicPath`; all drift metrics and safety checks use the frozen fields.
- All rail-aware LLM calls (Code Writer / executor path) use a shared wrapper that:
  - Computes a rail-aware context via `buildRailContext(rail, fullHistory, tokenBudget)`.
  - Prepends a system anchor:
    - `You are executing rail <rail.id>.`
    - `Frozen outcome: <rail.frozenOutcome ?? rail.outcome>.`
    - Instructions not to change the outcome, not to introduce new goals, and not to expand scope beyond the rail.
  - Injects Tier 1–2 rail context and then the task-specific user message.

### 5.2 Tiered Context (Rail-Aware Short‑Term Memory)

- `buildRailContext(rail, fullHistory, tokenBudget)` is the canonical entry point for rail-scoped memory.
- **Tier 1 — Rail summary**:
  - System message summarizing:
    - `RAIL OUTCOME: <frozenOutcome | outcome>`
    - `RAIL STATE: <state>`
    - `LOGIC PATH: <layer:nodeId → …>` (up to 8 steps, using `frozenLogicPath` when present).
- **Tier 2 — Recent conversation and traces**:
  - Filters `fullHistory` to messages that are:
    - Tagged with `railId === rail.id`, or
    - Not tagged with any `railId` but have `sessionId === rail.sessionId`, or
    - Global (no `sessionId`) when neither rail nor session tagging is present.
  - Takes up to the last 12 messages, then greedily includes them until reaching `TIER2_FRACTION` of the per-call token budget.
  - If messages must be dropped, it emits a `RAIL HISTORY DIGEST` system message summarizing recent turns, instead of silently truncating:
    - The digest is trimmed as needed to respect the remaining token budget.
    - The most recent turn is never dropped; either it is present verbatim or included in the digest.
- **Tier 3 — Skills / tools**:
  - Injected by higher-level callers (e.g. Claude enricher tools, Skill Library), not by `buildRailContext` itself.

### 5.3 Drift Metrics: Path vs Intent

- **Type 1 — Path drift (hallucination index)**:
  - `computeHallucinationIndex(logicPath, touchedNodeIds)` compares intended nodes from the rail's logic path with nodes actually touched in the session.
  - The result is stored on the rail as `hallucinationIndex` and surfaced in the UI as a confidence bar and "Drift" badge.
  - When diffs are rejected and `hallucinationIndex > 0.5`:
    - A reviewer trace is emitted with diverged node IDs.
    - The VERIFYING → MATERIALIZING flow is gated:
      - `completeMaterializeAndArchive` will not proceed if `hallucinationIndex > 0.5` and `hallucinationAcknowledgedAt` is unset.
      - The rail list shows "Acknowledge drift" in VERIFYING; acknowledging sets `hallucinationAcknowledgedAt` and allows materialization.
- **Type 2 — Intent drift (reasoning vs intent)**:
  - Each rail has an `intentSummary` derived from the approved plan and outcome (for plan rails: `"<plan.goal> — <rail.outcome>"`).
  - The trace logger records structured reasoning events for executor/reviewer steps.
  - `collectRecentReasoning(railId, windowN)` returns the last N reasoning messages for a rail.
  - `computeIntentDriftScore(rail, reasoningSamples)`:
    - Embeds `intentSummary` and reasoning samples using embeddings.
    - Computes cosine similarity and maps to a drift score in \[0, 1] via `1 - avg_similarity`.
    - Stores the result on the rail as `intentDriftScore`.
  - High `intentDriftScore` blocks automatic materialization and surfaces an "Intent drift" HITL card that requires explicit human approval or abandonment.

### 5.4 Node History — Long‑Term Rail Memory

- Node-level history is stored under `.agent/nodes/history.json` keyed by `ArchNode.id`.
- Each entry tracks:
  - `successCount` / `failureCount`.
  - `lastSuccessAt` / `lastFailureAt`.
  - A bounded list of recent rails that touched the node (rail id, outcome, archetype, state, finishedAt).
- On rail completion:
  - `archiveRail` records node history with state `"ARCHIVED"`.
  - `failRail` records node history with state `"FAILED"`.
- The planner loads this store and converts it into a compact `nodeHistory` summary for the planner system prompt:
  - Hints about fragile nodes (many failures), recently stabilized nodes (recent successes), and high-churn areas.

### 5.5 Planner Context (Cold Start and Governance)

- `PlannerContext` is the single structured input to planning:
  - `antiPatterns`: loaded from `.agent/rails/anti-patterns` and rendered as "Avoid: …" hints.
  - `nodeHistory`: summarized data from `.agent/nodes/history.json`.
  - `violations`: per-node violation summaries (severity, count, lastSeenAt) from the Supabase-backed `violations` table.
  - `skillHints`: future extension for skill performance heuristics.
  - `gates`: active gate types influencing planning decisions.
- `loadPlannerContext(rootPath, archetype?)` hydrates this structure and is called at plan request time.
- The planner system prompt uses `PlannerContext` to:
  - Remind the model of anti-patterns observed in prior failed rails.
  - Call out fragile nodes and suggest more conservative plans for them.
  - Surface open violations as contextual constraints (things to consider or warn about), not as implicit goals.
  - Require that any plan touching nodes with open high/critical violations either addresses them explicitly or justifies why they are out of scope.

### 5.6 Self‑Correction Semantics

- Rails can enter a `SELF_CORRECTING` state when verification tools (lint, tests, Playwright, visual critique) fail on a rail's sandbox changes.
- When verification fails:
  - The session's retry counter is incremented for the current plan task.
  - A `lastCritique` object is attached to the rail:
    - `source` (e.g. `"test"`, `"playwright"`, `"visual"`, `"unknown"`).
    - `message` (structured failure summary: lint errors, test failures, visual violations).
    - Optional `failureType` and attempt metadata.
  - The rail transitions into `SELF_CORRECTING`, and the corresponding rail task is marked `executing`.
- `buildSelfCorrectingContext` starts from `buildRailContext` and appends a user message with:
  - The latest critique.
  - A concise failure summary.
  - The current retry index and maximum retries for the task.
- When `SELF_CORRECTING` exhausts its retry budget for a rail:
  - The rail is marked `FAILED`.
  - An anti-pattern snapshot is written under `.agent/rails/anti-patterns` including frozen outcome, logic path, and a reason summarizing the full sequence of attempts.
  - This snapshot feeds back into `PlannerContext.antiPatterns` for future planning.

---

## 4c. Error Classification and Routing

```
Verification output (failed)
           │
           ▼
    Error Classifier
    (classifyFailure)
           │
    ┌──────┼──────────────┬────────────────┬─────────────────┐
    │      │              │                │                 │
    ▼      ▼              ▼                ▼                 ▼
ts_error  lint_error  layer_violation  vitest/playwright  retry_limit /
                                       _touched           jira_mismatch
    │      │              │                │                 │
    ▼      ▼              ▼                ▼                 ▼
Code Writer (retry)  Arch Planner   Code Writer (retry)   HITL
                      (replan)
                          │
                    retry >= RETRY_LIMIT_ARCH?
                          │
                          ▼
                        HITL
```

**Untouched flow failures** (playwright or vitest fails on paths NOT in `sessionTouchedPaths`) → always HITL, no retry.

### Error Classifier Contract

```ts
type FailureType =
  | "ts_error"
  | "lint_error"
  | "layer_violation"
  | "vitest_failure_touched"
  | "vitest_failure_untouched"
  | "playwright_failure_touched"
  | "playwright_failure_untouched"
  | "retry_limit_exceeded"
  | "jira_fingerprint_mismatch"
  | "unknown_llm_output";

interface VerificationOutput {
  tool: "run_lint" | "run_vitest" | "run_playwright_trace" | "diff_graph" | "llm_response";
  passed: boolean;
  errors: Array<{
    filePath: string;
    line?: number;
    message: string;
    code?: string;           // TypeScript error code, ESLint rule id, etc.
    type: "ts" | "lint" | "layer" | "test" | "runtime" | "unknown";
  }>;
  rawOutput?: string;
}

function classifyFailure(
  failure: VerificationOutput,
  agentContext: { touchedPaths: string[]; plan: AgentPlan; retryCounts: Record<string, number> }
): { type: FailureType; route: "code_writer" | "arch_planner" | "hitl" };
```

### `run_lint` Output Schema

```ts
interface LintOutput {
  passed: boolean;
  errors: Array<{
    filePath: string;
    line: number;
    column: number;
    message: string;
    ruleId: string;           // ESLint rule or tsc error code
    severity: "error" | "warning";
  }>;
}
```

### `run_vitest` Output Schema

```ts
interface VitestOutput {
  passed: boolean;
  summary: { total: number; passed: number; failed: number; skipped: number };
  failures: Array<{
    testName: string;
    filePath: string;
    error: string;            // error message
    stackTrace: string;       // full stack
  }>;
}
```

### `touchedPaths` — Population

The orchestration layer maintains a **session-scoped `sessionTouchedPaths: Set<string>`**. On every approved `commit_file`, add each committed path to the set. Pass `Array.from(sessionTouchedPaths)` to `classifyFailure` after every verification step.

**Phase 1 stub:** Implement `sessionTouchedPaths` in Phase 1 as a mock — populated on dry-run commits (paths added, no file written). Phase 2 replaces with real staging population. Interface is identical; classifier code does not change.

---

## 5. Context Window Management

### Pinned (Always in Context)

- Current `ArchGraph` compact summary (node ids, layers, health scores)
- Full `.arch-rules.json`
- Active task from the plan
- Last 2–3 tool results
- Current gate state
- `sessionTouchedPaths` (as array)

### Summarised and Dropped

- Completed tasks → one-line summary: "Task T1: created src/auth/index.ts — lint pass, vitest pass"
- Old tool results → keep result type only: "run_vitest: passed" or "run_lint: ts_error → routed to Code Writer"
- Full file contents from `read_file` → drop after the write that used them

### Agent-Written Summaries

After each successful module touch, the agent calls `write_context_summary` to append a structured block to the module's `.context.md`. Next run, the scanner reads this instead of full edit history.

---

## 5b. Plan-Level Transactions and Rollback

**Design: Partial success is allowed. No automatic rollback.**

Each approved task commits independently. If task N fails after tasks 1..N-1 are committed:

1. Already-committed tasks remain on disk.
2. Staging for task N is discarded.
3. HITL modal: "Task N failed. Tasks 1..N-1 are committed. Options: (a) Keep commits and abort plan, (b) Manually revert — use git to undo, (c) Create Jira for partial completion and retry task N in a new session."
4. Plan state: mark task N as `failed`. New session can begin with committed state already present.

**Rationale:** Automatic git revert across multiple committed tasks risks breaking intermediate states the engineer may want to keep. Explicit choice is safer.

---

## 5c. Crash Recovery and Session Persistence

**What is lost in a crash:** staging buffer, `sessionTouchedPaths`, token counters, plan state, retry counts, active gate.

**Design:** Persist after every `write_file` and `commit_file`.

**What to persist** (to `.arch-agent-session.json` in project root, gitignored):
```ts
interface AgentSession {
  planState: AgentPlan;
  currentTaskIndex: number;
  sessionTouchedPaths: string[];
  tokenUsage: number;
  llmCallCount: number;
  retryCounts: Record<string, number>;   // keyed by task id + error type
  activeGate: GateType | null;           // which gate was open when crash occurred
  stagingIds: string[];                   // pending staging buffer refs
}
```

**Recovery on restart:**
1. Check for `.arch-agent-session.json`.
2. If found: prompt "Previous session interrupted. Recover?" — Restore | Discard.
3. On Restore: re-load state, re-evaluate `activeGate`. If a gate was pending (e.g. Diff Preview awaiting approval), re-surface it. **Never silently continue past a gate.** Engineer must complete the interrupted interaction.

**Staging durability:** `.arch-agent-staging/` is written to disk on every `write_file`. Never kept in memory only. If crash occurs between `write_file` and `commit_file`, staged changes are recoverable.

**Webapp deployment note:** The webapp deployment clones repos to a temporary server directory with no persistent project root. Session persistence for the webapp must use server-side storage keyed by `{repoUrl}:{sessionId}`. This is a separate implementation path from the VS Code extension.

**Setup:** Add to `.gitignore` as part of Phase 1:
```
.arch-agent-session.json
.arch-agent-staging/
```

---

## 6. Diff Preview and Security Boundary

**Rule: No direct writes to the repo. Always stage first.**

### Write Flow

1. `write_file` → writes to `.arch-agent-staging/` (durable, keyed by path).
2. Diff Preview UI → file path, module, layer, before/after diff, plan task id.
3. Engineer: Approve (commit to disk) | Reject (discard) | Edit (human adjusts, then approve).
4. `commit_file` → applies staged changes. Adds path to `sessionTouchedPaths`.

### UI

- Collapsible "Pending Changes" panel in sidebar.
- Each file: Approve | Reject buttons.
- "Approve All" only if all paths pass scope check.

### Security Allowlist

Applies to `read_file`, `get_ast`, and `write_file`. Read tools inject content into LLM context — credentials must not be readable.

**Path must satisfy all of:**
- Under project root. No `../` traversal. No symlinks outside repo.
- Under `src/` or `docs/` (configurable; defaults: `["src/", "docs/"]`).
- Extension in: `.ts`, `.tsx`, `.js`, `.jsx`, `.md`
- Not matching: `node_modules/`, `.env*`, `*.config.*`, `*.lock`, any path in a configured deny list.

**Scope check (write only):** Path must be within a planned module's expanded file set.

**On any failure:** Reject tool call. Trigger Scope Violation gate. Log path and failure reason to Trace Panel.

---

## 7. Scanner — Structural Signal Extraction

The scanner must produce the signals defined in §0b. This is what enables the quality evaluation framework.

### Per-Module Outputs

For each module (grouped file path set):

```ts
interface ModuleSignals {
  moduleId: string;
  filePaths: string[];
  fanIn: number;                    // count of modules importing this one
  fanOut: number;                   // count of external modules this imports
  externalImportCount: number;      // npm package imports
  exportCount: number;              // total exported symbols
  fileCount: number;                // files in module
  hasTests: boolean;
  hasContextMd: boolean;
  circularDependencies: string[][];  // each entry is a cycle path
  health: "green" | "amber" | "red";
  healthReasons: string[];          // e.g. ["fan-out exceeds threshold (12 > 10)"]
}
```

### Health Computation

Apply thresholds from §0b. Assign:
- `red` if: any circular dependency, OR (fan-in > 5 AND fan-out > 5), OR any hard threshold exceeded
- `amber` if: any warning threshold exceeded, OR missing tests, OR missing `.context.md`
- `green` otherwise

### Fingerprinting

Each module gets an AST-based fingerprint: deterministic hash of export signatures + import specifiers (not file paths, not line numbers). This fingerprint is stable across renames and moves. It is stored in `.context.md` after every agent session and used for Jira binding.

---

## 8. Stale Jira Detection

### On Every Scan

1. Compute current module fingerprints (§7).
2. Fetch open Jira issues for this project (by label, project key, or custom field).
3. Extract stored fingerprint from each issue (description footer, custom field, or linked artifact).
4. Compare:

| Current Fingerprint | Stored Fingerprint | State | Action |
|---------------------|--------------------|-------|--------|
| Same | Same | Valid | None |
| Different | Stored exists | Code changed | Surface HITL: Retag / Archive / Keep |
| None (module deleted) | Stored exists | Orphaned | Surface HITL: Archive / Keep |
| Current exists | None stored | New issue format | Treat as valid; add fingerprint on next update |

### Jira Sync Panel

- Lists all mismatched issues: key, summary, stored fingerprint, current fingerprint.
- Per-row actions: **Retag** (update stored fingerprint), **Archive** (mark resolved), **Keep** (no change).
- Surfaced as HITL alert before agent creates new issues — prevents duplicates.

### Resolve Policy

When the agent successfully commits to a module with open Jira issues, **do not auto-close**. Surface one batched HITL modal: table of matched issues, per-row Resolve | Keep open | Dismiss. One interaction, not N sequential modals.

### Issue Creation Schema

Every Jira issue created by the agent must include a fingerprint footer in the description:

```
---
arch-fingerprint: <hash>
arch-module: src/services
arch-session: <trace-id>
arch-type: [Arch|Test|Scan|Agent|Doc|HITL]
```

This is what enables stale detection on future scans.

### Tag Taxonomy

| Tag | Triggers |
|-----|----------|
| `[Arch]` | Layer violations, dependency drift |
| `[Test]` | Vitest failures after retry exhaustion |
| `[Scan]` | Scanner errors, fingerprint mismatches |
| `[Agent]` | Retry limit reached, scope violations |
| `[Doc]` | Missing `.context.md` on multiple modules |
| `[HITL]` | Any gate requiring human review that was escalated |

---

## 9. Observability — Live Trace Panel

### Trace Entry Schema

```ts
interface TraceEntry {
  id: string;
  sessionId: string;
  timestamp: string;           // ISO 8601
  stepType: "plan" | "read_file" | "get_ast" | "write_file" | "commit_file" |
            "run_lint" | "run_vitest" | "run_playwright" | "diff_graph" |
            "gate" | "llm_call" | "llm_reasoning" | "error" | "jira" | "context_write";
  input: Record<string, unknown>;
  output: Record<string, unknown>;    // summary; full output expandable in UI
  decision: string;                    // e.g. "retry → Code Writer", "route → Arch Planner", "gate: Diff Preview"
  reasoning?: string;                  // extended thinking block (Arch Planner only); separate from input/output
  llmCallCount?: number;               // running total after this step
  tokenUsage?: number;                 // running total after this step
}
```

### UI

- "Agent Trace" panel or tab.
- Streams in real time during a session.
- Each entry: timestamp, step type badge, expandable input/output, decision.
- Playback: step-through past runs.
- Export: full trace as JSON (for Jira attachment or debugging).

### Integration

- Trace Logger emits events; Trace Panel subscribes and renders.
- On HITL gate or Jira creation, attach `traceId` to the issue description.

### Reasoning Trace

Two distinct signals: what the model *did* (action trace, covered above) and what it *decided* (reasoning trace).

**Action trace** — already covered. Tool-executor interception, one `TraceEntry` per step with input, output, and decision. The `decision` field is sufficient for Code Writer: decisions are mechanical and the output speaks for itself.

**Reasoning trace — Arch Planner only.** Arch Planner decisions are consequential. When it proposes a rule change or reassigns a module to a different layer, the engineer needs to know *why*, not just *what*. Enable extended thinking on Arch Planner LLM calls. The model's reasoning chain is emitted as a `TraceEntry` with `stepType: "llm_reasoning"` and the block stored in `reasoning?: string` — kept separate from `input`/`output` so it doesn't contaminate the structured tool call trace.

**In the Trace Panel UI:** `llm_reasoning` entries render inline alongside tool calls, collapsed by default and expandable. Engineers see the full thought sequence for any Arch Planner decision in the same view as the actions it produced.

**Chain-of-thought is not used** in place of extended thinking. Prompted `<reasoning>` blocks are unreliable — the model skips them, simplifies them, or produces post-hoc rationalisation rather than causal reasoning. They also produce format drift that complicates parsing. If extended thinking is unavailable (model or cost constraint), the fallback is the structured `decision` field on the action trace, not chain-of-thought prompting.

**Replay:** The `TraceEntry` stream is sufficient for step-through of decisions, gate triggers, and tool sequences. Exact reproduction of model calls (full message array at each LLM boundary) is not mandated — it has high storage cost and the audit goal is "what happened and when," not "reproduce the exact model call." If exact replay is added in future, store the full message array as an optional field on `TraceEntry` at `llm_call` boundaries.

---

## 10. Tools

### Full Tool Table

| Tool | Input | Output | Gate / Guard |
|------|-------|--------|--------------|
| `get_plan` | `{ goal: string }` | `AgentPlan` | Plan validation → Plan Review |
| `read_file` | `{ path: string }` | `{ content: string }` | Security allowlist |
| `get_ast` | `{ path: string }` | `GetAstOutput` (§10b) | Security allowlist |
| `write_file` | `{ path: string; content: string }` | `{ stagingId: string }` | Scope + allowlist; Diff Preview |
| `commit_file` | `{ stagingId: string }` | `{ success: boolean }` | Only after Diff Preview approval |
| `run_lint` | `{ paths?: string[] }` | `LintOutput` (§4c) | — |
| `run_vitest` | `{ pattern?: string }` | `VitestOutput` (§4c) | — |
| `run_playwright_trace` | `{ spec: string; url: string }` | `PlaywrightOutput` (§10c) | Human-authored specs only |
| `diff_graph` | `{}` | `DiffGraphOutput` (§10d) | Auto-invoked by orchestration |
| `update_jira` | `{ issueKey: string; fingerprint: string; action: JiraAction }` | `{ success: boolean }` | Fingerprint mismatch → HITL |
| `write_context_summary` | `{ module: string; summary: ContextSummaryBlock }` | `{ success: boolean }` | Allowlist; schema validation |

### 10a. `propose_rule_change` — Arch Planner Output

When the Arch Planner cannot replan around a layer violation (retry limit reached, or the violation is structural to the goal), it outputs:

```ts
interface ProposeRuleChange {
  type: "propose_rule_change";
  rulePath: ".arch-rules.json";
  category: "layerDirections" | "moduleThresholds" | "namingConventions" | "denyList";
  currentRule: string;       // JSON snippet of current rule
  proposedRule: string;      // JSON snippet of proposed replacement
  rationale: string;         // why the current rule blocks valid architecture
  affectedModules: string[]; // module ids affected by this rule
}
```

**HITL modal:** Shows proposed diff, rationale, affected modules. Engineer: Accept (write to `.arch-rules.json`) | Reject (rules stay; agent replans) | Edit (adjust proposal, then accept).

### 10b. `get_ast` Output Schema

```ts
interface GetAstOutput {
  path: string;
  fingerprint: string;
  exports: {
    functions: Array<{ name: string; params: string; returnType?: string }>;
    classes: Array<{ name: string; extends?: string }>;
    interfaces: Array<{ name: string }>;
    constants: Array<{ name: string }>;
  };
  imports: Array<{ specifier: string; default?: string; named?: string[] }>;
  topLevelDeclarations: string[];
}
```

No more than this. Used by semantic scanner (Phase 3) and Arch Planner for structure reasoning.

### 10c. `run_playwright_trace` Output Schema

Screenshots are **not** included inline — they blow the context window. Instead:

```ts
interface PlaywrightOutput {
  passed: boolean;
  spec: string;
  failures: Array<{
    testName: string;
    error: string;
    screenshotPath: string;     // saved to .arch-agent-staging/traces/<id>.png
    domSnapshot: string;        // abbreviated DOM (body only, truncated to 2000 chars)
    consoleErrors: string[];
    networkFailures: Array<{ url: string; status: number }>;
  }>;
  tracePath: string;             // .arch-agent-staging/traces/<id>.zip
}
```

The agent receives paths and text summaries, not image bytes.

### 10d. `diff_graph` — Trigger, Output, Consumer

| Aspect | Definition |
|--------|------------|
| **Trigger** | Auto-invoked by orchestration after every `commit_file`. Not called by the LLM. |
| **Timing** | After commit, before `run_lint`. |
| **Input** | None (implicit: current graph from scanner, planned graph from `AgentPlan`). |
| **Output** | `{ delta: { added: ArchEdge[]; removed: ArchEdge[]; layerMismatches: Array<{ edge: ArchEdge; violation: string }> } }` |
| **Consumer** | Error classifier. `layerMismatches.length > 0` → `layer_violation` → Arch Planner. Clean → continue to `run_lint`. |
| **Failure mode** | Scanner error (parse fail, permission, ts-morph crash) → treat as `layer_violation`. Log error to trace. Surface warning: "Scanner failed during diff_graph. Routing to Arch Planner." Conservative: assume structure may be wrong. |

### 10e. `write_context_summary` — Input Schema and Validation

```ts
interface ContextSummaryBlock {
  sessionDate: string;           // YYYY-MM-DD
  action: "create" | "modify" | "refactor";
  layer: string;
  tests: { vitest: "pass" | "fail"; playwright?: "pass" | "fail" };
  fingerprint: string;
}
```

**Validation:** Validate against schema before writing. On failure, reject tool call and return validation error to agent.
**Path:** `<module>/.context.md`. Subject to full security allowlist — must be under `src/` or `docs/`, extension `.md`.

---

## 11. Implementation Order

### Phase 1 — Foundation (Weeks 1–2)

**Setup first:**
- Add `.arch-agent-session.json` and `.arch-agent-staging/` to `.gitignore`.

**Build:**
1. `AgentPlan` schema + JSON validation + cycle detection + file conflict check.
2. Plan Review gate UI — task list, dependency graph, Approve/Reject/Edit.
3. `sessionTouchedPaths` stub — `Set<string>` populated on dry-run commits.
4. Error classifier with defined `VerificationOutput`, `LintOutput`, `VitestOutput` schemas.
5. `GateChecker` module — all gate conditions from §3, codified.
6. Trace Logger + minimal Trace Panel — real-time step stream.
7. Unknown LLM output handler — log, count against `RETRY_LIMIT_SESSION`, retry with correction prompt.

**Deliverable:** Agent loop that plans, validates, classifies errors, triggers HITL gates, and logs — without yet writing real code.

---

### Phase 2 — Safety (Weeks 3–4)

8. Staging + Diff Preview — `write_file` → `.arch-agent-staging/`, approval → `commit_file`, security allowlist on all read/write tools. Replace stub with real `sessionTouchedPaths` population.
9. Session persistence — full `AgentSession` serialisation, crash recovery prompt, gate state restoration.
10. Token budget — `TOKEN_BUDGET_SESSION`, 80% warning to Trace Panel + Project Overview banner, hard stop → HITL + extend mechanic.
11. Context window strategy — summarise completed tasks, pin graph + rules + active task + last 3 tool results.
12. `write_context_summary` — typed schema, validation, allowlist enforcement.

**Deliverable:** Agent loop that safely writes code, recovers from crashes, and manages resource bounds.

---

### Phase 3 — Depth (Weeks 5–6)

**Prerequisite:** Human-authored Playwright specs for critical paths (login, core UI flows, API integration) must exist in `e2e/` before this phase starts. The agent does not write Playwright specs — that is circular. Configure with `archVisualizer.playwrightSpecs`.

13. Semantic scanner — `ModuleSignals` (§7), AST fingerprints, fan-in/fan-out computation, circular dependency detection, health scoring per §0b thresholds.
14. `diff_graph` — auto-invoke after `commit_file`, feed delta into error classifier, implement scanner failure mode.
15. `run_playwright_trace` — wire to existing specs, `PlaywrightOutput` schema with path-referenced screenshots.
16. Stale Jira detection — fingerprint comparison on every scan, Jira Sync panel, batched HITL resolve prompt.

**Deliverable:** Scanner produces rich structural signals. Agent can verify behaviour-level correctness. Jira stays in sync.

---

### Phase 4 — Polish (Weeks 7–8)

17. Retry limit enforcement — `RETRY_LIMIT_CODE`, `RETRY_LIMIT_ARCH`, `RETRY_LIMIT_SESSION`; on exhaustion create Jira, stop, HITL.
18. `propose_rule_change` — Arch Planner output, HITL UI for accept/reject/edit, write to `.arch-rules.json` on accept.
19. Trace export — trace as JSON, attach `traceId` to Jira issues.
20. Observability replay — step-through past runs in Trace Panel.
21. Webapp session persistence — server-side session storage keyed by `{repoUrl}:{sessionId}`.

**Deliverable:** Full autonomous agent loop with human-controlled governance, cost bounds, and audit trail.

---

## 12. Success Criteria

| Criterion | Verification |
|-----------|-------------|
| Plan-before-act | No tool invocation without approved plan in session log |
| Session recoverable | Crash and restore test: gate re-surfaces correctly |
| HITL triggers are explicit | All gates in §3 have corresponding `GateChecker` conditions |
| Errors route correctly | TypeScript → Code Writer; layer → Arch Planner; untouched/exhausted → HITL |
| No blind writes | Every `commit_file` preceded by approved Diff Preview in trace |
| Security boundary holds | `read_file` on `.env` rejected; logged path and reason in trace |
| Jira stays in sync | Fingerprint match rate > 90% after one full scan cycle |
| Quality signals drive evaluation | Scanner produces `ModuleSignals` with health scores; Arch Planner uses §0e question order |
| Engineer can observe | Live trace streams; past runs replayable |
| Resource bounds enforced | Session terminates or prompts at `RETRY_LIMIT_SESSION` and `TOKEN_BUDGET_SESSION` |
| Rules can evolve | Arch Planner proposes; engineer accepts/rejects; `.arch-rules.json` updated |
| Playwright is non-circular | Specs are human-authored; agent only invokes them |

---

*Agent Roadmap v4.1 — reasoning trace additions: `llm_reasoning` step type, `reasoning?: string` field on `TraceEntry`, extended thinking for Arch Planner, chain-of-thought rejection rationale, replay storage policy. Previous v4: architectural quality signal taxonomy (§0), four evaluation dimensions, structural thresholds, `.arch-rules.json` rule categories, Arch Planner evaluation order, `LintOutput`/`VitestOutput` schemas, `PlaywrightOutput` screenshot handling, webapp session persistence, full `AgentSession` serialisation, `TraceEntry` schema, `ModuleSignals` schema, unknown LLM output handling.*
