# Arch Visualizer – Product Status

**Last updated:** 2025-03-10

This document captures the current product state, recent work, and remaining backlog. Use it for product planning and handoffs.

---

## 1. Recent Work (Completed This Sprint)

### Batch 4 – Controls & Safety ✅

| Item | Status | Location |
|------|--------|----------|
| **backend-workspace-auto-exec-flag** | ✅ Done | `workspaces.auto_execute_enabled` column; enforced on `POST /todos/auto-rails-and-execute` and `POST /todos/auto-execute-ready` only |
| **frontend-workspace-auto-exec-toggle** | ✅ Done | Settings panel (Governance) in `App.tsx`; `PATCH /workspaces/:id/auto-execute`; `GET /workspaces/:id/load` returns `autoExecuteEnabled` |
| **backend-rails-diff-size-guard** | ✅ Done | `materialize.ts`: `MATERIALIZE_MAX_CHANGED_FILES` (200), `MATERIALIZE_MAX_TOTAL_BYTES` (500k); env-overridable; `POST /materialize/approve` returns `409` with `code: "MATERIALIZE_DIFF_TOO_LARGE"` when exceeded |
| **frontend-rails-large-change-warning** | ✅ Done | Pending-rail approval modal shows warning block; second confirm with `force: true` bypasses guard |

### Todo → Rail Pipeline ✅ (partial)

| Item | Status | Location |
|------|--------|----------|
| **POST /todos/:id/to-rail** | ✅ Done | `todos.ts` – creates rail from todo, links `todos.rail_id`, returns `{ railId, todoId }` |
| **auto-rails-and-execute logic** | ⚠️ Incomplete | Still returns `startedRails: []`; does not yet call to-rail or execute |
| **auto-execute-ready** | ⚠️ Same | Same pattern; no rail creation or execution |

### Bug Fix This Session

- **auto_execute_enabled scope**: Was incorrectly enforced on `GET /todos` and `POST /todos`, blocking list/create when auto-exec was off. Fixed: flag now enforced **only** on `POST /todos/auto-rails-and-execute` and `POST /todos/auto-execute-ready`.

---

## 2. Current Codebase Snapshot

### Implemented APIs

**Todos** (`/api/todos`)

- `GET /todos?workspaceId=` – list todos
- `POST /todos` – create todo
- `GET /todos/dependencies/ready?workspaceId=` – list ready todo ids
- `PATCH /todos/:id` – update todo
- `DELETE /todos/:id` – delete todo
- `POST /todos/:id/to-rail` – create rail from todo
- `POST /todos/auto-rails-and-execute` – pick ready todos; returns `pickedTodoIds`; no rail creation yet
- `POST /todos/auto-execute-ready` – same; rate-limited; requires `auto_execute_enabled`
- `POST /todos/from-chat` – create todos from chat items (deduped)

**Rails** (`/api/rails`)

- `GET /rails?workspaceId=|rootPath=` – list rails
- `GET /rails/:railId` – get rail detail
- `POST /rails/:railId/state` – transition state
- `POST /rails/:railId/execute` – run analysis rail (taskRunner, lint, vitest, playwright)
- `GET /rails/:railId/sandbox/files`
- `GET /rails/:railId/diff`
- `GET /rails/:railId/impact`
- `GET /rails/:railId/trace`
- `POST /rails/:railId/rollback`

**Missing Rails Route**

- `POST /rails/from-violation` – **not implemented**. Frontend calls it from Fix Now; backend has no handler. Returns 404.

**Workspaces**

- `PATCH /workspaces/:id/auto-execute` – set `auto_execute_enabled`
- `GET /workspaces/:id/load` – returns `autoExecuteEnabled` (and graph, repoUrl, jiraProjectKey)

**Materialize**

- `POST /materialize` – create boilerplate from nodes
- `POST /materialize/approve` – approve rail; diff-size guard; optional `force: true` to bypass
- `POST /materialize/undo`

### Database Migrations

- `20260310130000_workspaces_auto_execute_enabled.sql` – adds `workspaces.auto_execute_enabled BOOLEAN NOT NULL DEFAULT FALSE`

---

## 3. Still Pending (Prioritized)

### High – Blocking End-to-End Flow

| ID | Task | Notes |
|----|------|-------|
| backend-rails-from-violation | Implement `POST /api/rails/from-violation` | Frontend calls it; no route. Create rail from violation, return `railId`. |
| backend-todos-auto-rails-execute | Wire auto-rails-and-execute to call to-rail + execute | Create rails from picked todos; trigger `/rails/:id/execute` (or equivalent). |
| backend-chat-todos-flow-fix | Chat todo intent → call `POST /todos/from-chat` | Currently uses `supabaseAdmin.rpc("chat_create_todos")` which may not exist. Replace with HTTP call or inlined logic. |
| backend-chat-execute-orchestration | When `isExecutionIntent` → call auto-rails-and-execute | Chat detects intent but does not call the endpoint or return `startedRails` in response. |

### Medium – UX & Correctness

| ID | Task | Notes |
|----|------|-------|
| frontend-fix-now-wire | Fix Now → from-violation + show rail status | Currently opens chat; should create rail and show inline status. |
| frontend-board-wire | Board UI → rails APIs | Poll/subscribe rails; render cards in columns. |
| frontend-rail-detail | Rail detail drawer | Timeline, diffs, test results, Apply/Discard/Retry. |
| backend-rail-todo-completion | On materialize → mark todo completed | Link rail→todo completion. |
| bug-scan-repo-double-clone | Fix double git.clone in scan-repo.ts | Causes crashes. |
| bug-jiraConfig-decrypt | Surface jiraConfig decrypt failures | Avoid masking as rail/violation issues. |
| bug-fixnow-race | Fix handleFixViolation race | aiQuestion overwritten; use stable fixPromptRef. |

### Lower – Enhancements

- SSE board updates, rollback UI, todo dependency viz, DocLittle import UI, etc.
- See `docs/DIAGNOSIS_AND_TODO.md` and `TODO.md` for full lists.

---

## 4. Todo Sources (Where Backlogs Live)

| File | Scope |
|------|-------|
| `docs/DIAGNOSIS_AND_TODO.md` | Jira, violations, deriveProjectKey, gate checker, UI (p1–p20) |
| `TODO.md` | Phases 0–6: archNodeId, GraphCommand, Ghost Nodes, Scaffold Skill, Jira Skills, Greenfield |
| In-session tracker | ~75 items: rails, todos, board, verification, rollback, SSE, etc. |

---

## 5. Environment

- `APP_URL` – base URL for Playwright/verification (e.g. `http://localhost:4173`)
- `MATERIALIZE_MAX_CHANGED_FILES` – override diff guard (default 200)
- `MATERIALIZE_MAX_TOTAL_BYTES` – override diff guard (default 500_000)
- `RAIL_MAX_CONCURRENT` – per-workspace execute concurrency (default 1)
- `RAIL_STALE_MAX_AGE_MS` – stale rail recovery (default 1h)
