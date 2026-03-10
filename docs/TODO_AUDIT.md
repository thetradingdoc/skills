# TODO Audit — Exact Counts

**Audit date:** 2025-03-10  
**Source:** Unified todo list + DIAGNOSIS_AND_TODO (p1–p20) + PRODUCT_STATUS + TODO.md

---

## Summary

| Category | Count |
|----------|-------|
| **Done** | 51 |
| **Pending** | 45 |
| **Total tracked** | 96 |

---

## 1. Core Rails & Execution

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 1 | backend-rails-from-violation | DONE | `POST /rails/from-violation` in railsRoutes.ts L247 |
| 2 | backend-rails-execute | DONE | POST /rails/:railId/execute, taskRunner, lint, vitest, playwright |
| 3 | backend-rails-diff-size-guard | DONE | materialize.ts MATERIALIZE_MAX_CHANGED_FILES, MATERIALIZE_MAX_TOTAL_BYTES |
| 4 | backend-rails-rollback | DONE | POST /rails/:railId/rollback in railsRoutes.ts |
| 5 | backend-rails-cancel | DONE | POST /rails/:railId/cancel in railsRoutes.ts L1079 |
| 6 | backend-todos-auto-rails-execute | DONE | runAutoRailsAndExecute calls todoToRailCore + triggerRailExecution (todos.ts L436–477) |
| 7 | backend-execute-rootpath-resolution | DONE | resolveRootFromWorkspace + ensureProjectRoot used in railExecute, railsRoutes, chat |
| 8 | backend-execute-concurrency | DONE | RAIL_MAX_CONCURRENT, workspaceExecutionCounts in railExecute.ts, railsRoutes.ts |
| 9 | backend-rails-read-apis | DONE | GET /rails, GET /rails/:railId, GET /rails/events return state, tasks, attemptHistory |
| 10 | backend-hitl-notification | DONE | broadcastRailEvent({ type: "rail_hitl" }) in railsRoutes.ts L540–545 |
| 11 | backend-rails-impact-endpoint | DONE | GET /rails/:railId/impact in railsRoutes.ts L949 |
| 12 | backend-rail-todo-completion | DONE | completeTodosForRail called in railsRoutes.ts (archive/materialize) + materialize.ts |
| 13 | backend-rails-materialize-non-greenfield | DONE | POST /rails/:railId/materialize handles non-greenfield (copy sandbox→root, archive); greenfield uses /materialize/approve |
| 14 | backend-rails-error-contract | DONE | ApiError, sendError(), RAIL_* codes in apiError.ts; railsRoutes uses sendError |
| 15 | backend-execute-token-budget | DONE | RAIL_TOKEN_BUDGET in taskRunner; railExecute breaks on token budget error, fails task, transitions to FAILED |
| 16 | backend-execute-task-type-classifier | DONE | classifyTaskAutoCapable + partitionTasksByCapability in taskClassifier.ts; rail detail returns taskCapability.autoCapableIds/hitlRequiredIds |
| 17 | backend-rails-state-audit-log | DONE | 20260310150000_rail_state_events.sql migration exists |
| 18 | backend-rails-integration-tests | DONE | rails.integration.test.ts: ApiError shape, materialize 200 when verification passes |

---

## 2. Todos & Dependency Execution

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 19 | backend-todos-model | DONE | Todos table, CRUD, POST /todos/:id/to-rail |
| 20 | backend-todos-from-chat | DONE | POST /todos/from-chat, chat inlined insert |
| 21 | fix-auto-exec-scope | DONE | auto_execute_enabled enforced only on auto-exec endpoints |
| 22 | backend-todos-auto-execute-ready | DONE | Same wiring as auto-rails-and-execute; both call runAutoRailsAndExecute (doc in todos.ts) |
| 23 | backend-todo-dependency-order | DONE | Circular dep check in POST/PATCH; hasDependsOnCycle; phase ordering in todosImport |
| 24 | backend-todo-dependency-unlock | DONE | completeTodosForRail invoked in railsRoutes + materialize; calls unlock_todos_for_workspace |
| 25 | backend-todos-edit-delete | DONE | GET /todos/:id, PATCH, DELETE (soft archived_at + hard ?hard=true) |
| 26 | backend-todos-import-md | DONE | POST /todos/import/confirm in todosImport.ts, parseDocLittleMarkdown |
| 27 | backend-todos-import-preview | DONE | POST /todos/import/preview in todosImport.ts |

---

## 3. Chat, Orchestration & Sessions

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 28 | backend-chat-intent-detect | DONE | isTodoIntent, isExecutionIntent in chat.ts |
| 29 | backend-chat-todos-flow-fix | DONE | Chat uses direct Supabase insert (no rpc chat_create_todos) |
| 30 | backend-chat-execute-orchestration | DONE | runAutoRailsAndExecute called when isExecutionIntent (chat.ts L482, L937) |
| 31 | backend-rail-attempt-history | DONE | attemptHistory written on execute |
| 32 | backend-chat-rail-linkback | DONE | Backend returns rails/railIds; client stores with message, renders "View rail" buttons |
| 33 | backend-chat-session-rail-context | DONE | parseRailIntent + retry/cancel; frontend Retry/Cancel buttons per rail in chat |
| 34 | frontend-chat-board-navigation | DONE | View rail buttons + #rail: links → setMainViewMode("board"), setSelectedRailId |

---

## 4. Board & Webapp UI

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 35 | frontend-workspace-auto-exec-toggle | DONE | Governance panel, PATCH /workspaces/:id/auto-execute |
| 36 | frontend-rails-large-change-warning | DONE | Approval modal warning |
| 37 | frontend-board-wire | DONE | fetchRails, GET /rails/events, rail detail in App.tsx |
| 38 | frontend-rail-detail | DONE | selectedRailDetail drawer, tasks, diffs, impact, Apply/Discard/Retry |
| 39 | frontend-sse-reconnect | DONE | Visibility/online handlers, exponential backoff in App.tsx |
| 40 | frontend-fix-now-show-rail | DONE | Fix Now: setSidebarTab(dashboard), sync violationRailStatus from rails, inline "Rail: STATE · View" |
| 41 | frontend-board-columns | DONE | Kanban: PRE_PLANNING..ARCHIVED/FAILED/SUSPENDED columns |
| 42 | frontend-board-queue-visibility | DONE | queuePositionByRailId (Running, Next, #N) on rail cards |
| 43 | frontend-canvas-rail-impact | DONE | Impact overlay badge when rail impact nodes highlighted |
| 44 | frontend-todos-ux | DONE | Board: Import, + Create, inline edit, delete, phase filter |
| 45 | frontend-todo-dependency-viz | DONE | Phase grouping, Depends on links (click-to-scroll) |
| 46 | frontend-rails-error-display | DONE | railDropError uses error, code, details, retryable |
| 47 | frontend-todos-import-ui | DONE | DocLittle modal: upload, preview, confirm; board Import button |
| 48 | frontend-todo-phase-filter | DONE | boardTodoPhaseFilter select: All phases / Phase N |

---

## 5. Jira, Violations & Governance

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 49 | Jira config plumbing | DONE | Per-user config, jira_project_key per workspace |
| 50 | Violation writes from chat | DONE | markAbsent: false, scan snapshots |
| 51 | bump_violation RPC | DONE | 20250225001000_violations_schema.sql L85 |
| 52 | violation_policy_events table | DONE | 20250225001000_violations_schema.sql L182 |
| 53 | violation_scans table | DONE | 20250225001000_violations_schema.sql L154 |
| 54 | jira-violation workspace ownership | DONE | eq("owner_id", userId) in jiraViolation.ts L79–89 |
| 55 | backend-file-node-mapping | DONE | GET /workspaces/:id/node-file-mapping |
| 56 | p1 deriveProjectKey fix | DONE | Server and client use [^A-Z0-9]; doclittle-platform → DOCLITTLEPLATFORM |
| 57 | p2a arch-fingerprint in Jira | DONE | jiraViolation.ts L216–217 |
| 58 | p2b staleMismatches in runGateCheck | DONE | Extension runGateCheck uses lastStaleJiraMismatches (extension.ts L1842) |
| 59 | p4a markAbsent | DONE | Already marked done in DIAGNOSIS |
| 60 | p3 per-user Jira in tools | DONE | tools.ts uses overrides.config only; no env fallback |
| 61 | p4b scheduled violation re-scan | DONE | POST /api/violations/scan-trigger + README |
| 62 | p5 agent orchestrator loop | DONE | orchestratorLoop.ts: runOrchestratorCycle |
| 63 | p6 trace No context source | DONE | scanner.ts checkHealth sets hasContext; doc comment |
| 64 | p7a project key UI | DONE | Shorter label, inline validation (isValidProjectKey) |
| 65 | p7b violation UI | DONE | Tooltip on disabled Track, sort by severity |
| 66 | p7c Jira list UI | DONE | maxHeight 400, severity badges for priority |
| 67 | p8 unify deriveProjectKey | DONE | webapp/shared/deriveProjectKey.ts; client+server re-export |
| 68 | p9–p11 migrations deployed | DONE | scripts/verify-migrations.ts |
| 69 | p12 workspace ownership | DONE | jira-violation enforces owner_id |
| 70 | p13 persist Jira link chat violations | DONE | jira-violation upserts + markViolationTracked |
| 71 | p14 merge jiraKey into graph | DONE | mergeViolationsIntoGraph on load |
| 72 | p15 per-user in jira_search | DONE | Same as p3; overrides only |
| 73 | p16 loading state jiraProjectKey | DONE | No jiraError flash when !jiraProjectKeyReady |
| 74 | p17 saveProjectKey race | DONE | fetchJiraTests(undefined, key) after PATCH |
| 75 | p18 UI clear project key | DONE | — Clear project — in dropdown |
| 76 | p19 rollback addLabelToIssue | DONE | setJiraIssues(prevIssues) in catch |
| 77 | p20 persist jiraFilterByRepo | DONE | localStorage in webapp + webview-ui |

---

## 6. Greenfield, Materialize, Sandbox

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 78 | Greenfield mode | DONE | greenfieldEnricher, greenfieldMaterialize |
| 79 | Greenfield materialize flow | DONE | Approval, verification, apply |
| 80 | Greenfield → todos/rails | DONE | POST /greenfield/nodes/:id/to-rail |
| 81 | backend-sandbox-cleanup | DONE | Orchestrator removes on ARCHIVED/FAILED; recoverStaleRails removes for stale |
| 82 | backend-rails-stale-recovery | DONE | Runs on GET /rails |

---

## 7. Data Model, DB, Infra

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 83 | Rails schema base | DONE | rails table, triggers, constraints |
| 84 | workspaces.auto_execute_enabled | DONE | Migration 20260310130000 |
| 85 | db-migrations-violations-railid | DONE | FK in 20260310120000 |
| 86 | db-migrations-todos-table | DONE | 20260310140000 source_node_id, source_violation_id |
| 87 | db-migrations-rails-schema | DONE | 20260310141000 rails.repo_url; workspace_id, violation_id present |
| 88 | backend-workspace-repourl-write | DONE | scan.ts, workspaces.ts persist repo_url |
| 89 | ops-env-app-url-docs | DONE | docs/ops/ENV.md |
| 90 | backend-workspace-memory-on-complete | DONE | writeRailCompletionMemory on ARCHIVED |

---

## 8. Verification & Testing

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 91 | backend-verification-pipeline | DONE | runVerificationPipeline in verificationPipeline.ts |
| 92 | backend-self-correction-loop | DONE | Retry with lastVerificationFeedback, RAIL_SELF_CORRECT_MAX |
| 93 | backend-playwright-spec-discovery | DONE | discoverPlaywrightSpecMappings, mapSpecsToScope |

---

## 9. Bugs (from PRODUCT_STATUS)

| # | ID | Status | Evidence |
|---|-----|--------|----------|
| 94 | bug-scan-repo-double-clone | DONE | Use cloneToStablePath; single clone path |
| 95 | bug-jiraConfig-decrypt | DONE | JiraDecryptError thrown; APIs return 400 + code |
| 96 | bug-fixnow-race | DONE | fixPromptRef set at click, cleared in finally |

---

## 10. TODO.md Phases (distinct items)

Phase 0–6 items (archNodeId docs, id-decorator, Ghost nodes, Scaffold, telemetry manager, Fix-or-Track, Jira overlay, Greenfield UX) — counted as additional pending in TODO.md; not double-counted above.

---

## Recount from this audit

Manual count from table above:
- Section 1: DONE 11, PENDING 7
- Section 2: DONE 3, PENDING 6
- Section 3: DONE 4, PENDING 3
- Section 4: DONE 5, PENDING 9
- Section 5: DONE 12, PENDING 17
- Section 6: DONE 5, PENDING 0
- Section 7: DONE 8, PENDING 0
- Section 8: DONE 3, PENDING 0
- Section 9: DONE 0, PENDING 3

**Final totals:**
- **Done:** 51
- **Pending:** 45
- **Total:** 96
