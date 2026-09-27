# Blanko E2E Implementation Report

## Summary
Steps 0–12 were executed against `blanko-workspace-redesign-v2.md`. Most product code for Epics 1–7 and U1–U4 is in place and unit/Playwright gates for severity, D1 auto-enqueue exclusion, n8n/greenfield guards, and enqueue dedupe are green. The schema migration file exists but was **not applied** to the remote Supabase DB (no `SUPABASE_DB_PASSWORD` / `DATABASE_URL` in env — blocker). Epic 4/7 badge↔Rollup close-the-loop is **partial** (client refresh + `finding.cleared` API stub; no live async rescan verification). Live Approve/D5 path and GitHub webhook delivery were not end-to-end proven in this run.

## Step-by-step results

### Step 0 — Decisions D1-D6
- D1: **confirmed compatible** — `missing_trading_spine` is remediation `spine` in `designRules.ts`; auto-enqueue filters to `sharedSeverity === "blocker"` + `remediation === "code"` and explicitly excludes that rule. Apply spine remains the graph remediation.
- D2: **confirmed compatible** — `POST /todos/:id/approve` still calls `completeTodosForRail` immediately; badge/finding clear is a separate client/API path and does not reopen todos.
- D3: **confirmed compatible** — shared `Severity` lives in `webapp/client/src/severity.ts`; imported by `designRules.ts` / `insightsBriefing.ts` with mapping helpers.
- D4: **confirmed compatible** — `evaluateDesign` remains client-only (`designRules.ts`); auto-enqueue posts to existing `/todos` from `App.tsx` after graph load. `designReconcile.ts` already documented this split.
- D5: **compatible with caveat** — prior `ensureProjectRoot` could return a live (non-clone) directory when `projectRoot` pointed outside `~/.arch-viz/repos`. Approve now uses `resolveWorkspaceRoot(..., { approveOnly: true })` and refuses/re-clones to scan-clone only. **Not live-verified** against trading-agent `.blanko-target`.
- D6: **confirmed compatible** — auto-enqueue and Insights payloads use `kind: "task"` (`insightsTodo.ts`, `autoEnqueueFindings.ts`).

### Step 1 — Schema migration
- Migration file: `supabase/migrations/20260812180000_todos_source_resolved_by.sql`
- Apply helper: `scripts/apply-todos-source-resolved-by-migration.ts`
- Applied: **no** — probe via service role showed `column todos.resolved_by does not exist`; no `DATABASE_URL` / `SUPABASE_DB_PASSWORD` available to run DDL.
- Verified constraints exist: **not verified on DB**. SQL defines `resolved_by` check, `source` check (with legacy allowlist), and unique index `todos_open_source_path_uniq`.
- **Blocker to unblock:** set `SUPABASE_DB_PASSWORD` (or `DATABASE_URL`) and run `npx tsx scripts/apply-todos-source-resolved-by-migration.ts`, then re-probe.

### Step 2 — Epic 1 (severity + badge hygiene)
- Files touched: `webapp/client/src/severity.ts`, `designRules.ts`, `insightsBriefing.ts`, `blanko/InsightsPanel.tsx`, `scripts/test-insights-briefing.ts`
- Gate verification: `npx tsx scripts/test-insights-briefing.ts` (soft-only → `badge_count === 0`); `scripts/test-blanko-severity-enqueue.ts`
- Gate result: **PASS** (unit). Manual trading-agent rescan badge eyeball not run in this session.

### Step 3 — Epic U1 (Tasks card/board redesign)
- Files touched: `webapp/client/src/FlowTasksBoard.tsx` (primary)
- Gate verification: code inspection — Needs review shows Approve + `⋯` only; Actions ▾; Up next / In progress / Review; Completed/Issues behind lane toggle; filters All/Mine/Blockers. Playwright UI assertion soft-skips when signed out (no Actions chrome).
- Gate result: **PASS** (implementation). Authenticated UI snapshot of ≤2 controls not captured live.

### Step 4 — Epic 3 (source tagging + noise)
- Files touched: `FlowTasksBoard.tsx` (`seed_spine`, `import_from_path`), `webapp/server/src/todos.ts` (`normalizeTodoSource`), insights already `insights`
- Gate verification: unit assert on `normalizeTodoSource`; create sites updated. DB backfill runs only when migration is applied.
- Gate result: **PARTIAL** — app writes correct sources; existing rows not backfilled until migration applies.

### Step 5 — Epic 2 (auto-enqueue)
- Files touched: `webapp/client/src/autoEnqueueFindings.ts`, `App.tsx` (scan-complete effect)
- Gate verification: `scripts/test-blanko-severity-enqueue.ts` + Playwright unit cases in `blanko-e2e-pipeline.spec.ts` (D1 + n8n/greenfield)
- Gate result: **PASS** (guards + dedupe logic). Live “code blocker appears without Add task” not dogfooded on trading-agent in this run.

### Step 6 — Epic 5 (project_root / target)
- Files touched: `webapp/server/src/todos.ts` (Approve scan-clone only, structured codes), `webapp/server/src/workspaces.ts` (`no_project_root` on load, `GET /workspaces/:id/target`)
- Gate verification: code review of Approve path + target endpoint. Live Approve failure UX not exercised.
- Gate result: **PARTIAL** — API surface present; Sync-to-live intentionally stubbed (`sync_to_live_available: false` per D5/out of scope).

### Step 7 — Epic 4 (badge clear on rescan)
- Files touched: `FlowTasksBoard.tsx` (`onApproved`), `FlowView.tsx`, `WorkspaceDock.tsx`, `App.tsx` (refresh keys + `finding.cleared` POST), `findingsRoutes.ts`
- Gate verification: Approve still completes todos immediately (D2). Badge refresh relies on todo-status map + rollup/task refresh; **no dedicated async file rescan** of the node after Approve.
- Gate result: **PARTIAL** — decoupled from todo reopen; full “badge clears within one rescan cycle” not proven; “still failing” annotation on done cards not fully UI-wired.

### Step 8 — Epic U3 (Insights → Work handoff)
- Files touched: `InsightsPanel.tsx` (soft collapse, no Fix on soft, Apply spine filled CTA vs Fix outline), `App.tsx` notice `Added to Work — Open`
- Gate verification: code + soft suggestions testids
- Gate result: **PASS** (implementation). Toast is dock notice, not a separate toast component.

### Step 9 — Epic U2 (Workspace shell / IA)
- Files touched: `blanko/types.ts`, `DockRail.tsx`, `dockLayout.ts`, `WorkspaceDock.tsx`, `FlowView.tsx`, `App.tsx`
- Gate verification: Flow label retired; System (`workspace`) + Work rail; Path/Work split; Ops hidden until `rollupHasData`; breadcrumb; Path empty copy when no agents; Work uses wide sheet width.
- Gate result: **PASS** with UX caveats — Platforms still under System; legacy `flow` tab ids normalized.

### Step 10 — Epic U4 (Rollup honesty)
- Files touched: `ManagementRollupView.tsx` (top `rollup-sync-status`; removed per-row “waiting for webhook/scan activity”)
- Gate verification: Playwright idle rollup test (sync status optional if Ops hidden)
- Gate result: **PASS** (UI). Ops still gated by client `rollupHasData` heuristic (findings/todos), not a server capability flag named exactly `rollup_has_data`.

### Step 11 — Epic 7 (Rollup wiring)
- Files touched: `findingsRoutes.ts` (`POST /findings/:id/cleared`), `App.tsx` best-effort call after Approve; Own/Release already in `ManagementRollupView` / `sectionClaims.ts`
- Gate verification: endpoint added; GitHub webhook registration **not** verified.
- Gate result: **PARTIAL** — event path stubbed; Rollup numbers will not reliably move until findings sync + migration + webhook activity are confirmed.

### Step 12 — E2E suite
- New/extended: `scripts/blanko-e2e-pipeline.spec.ts`, `scripts/test-blanko-severity-enqueue.ts`, updated `scripts/blanko-flow-tasks-audit.spec.ts` Work-rail opener, soft badge assert in `test-insights-briefing.ts`
- Ran: unit suites green; Playwright `blanko-e2e-pipeline.spec.ts` → **4 passed, 2 skipped** (live D2/D5 require `BLANKO_E2E_LIVE=1`)
- Gate result: **PASS** for automated non-live suite; live Approve/clone path **not** run

## Deviations from the plan
1. Migration written + apply script added, but **not applied** to remote DB (missing credentials).
2. Epic 4 uses client refresh + finding.cleared POST rather than a true async rescan worker.
3. Greenfield auto-enqueue guard inferred as `architectureBoard && no scanned files` (ArchGraph has no `mode: "greenfield"` field).
4. U3 handoff uses existing Flow/Work notice banner, not a separate toast library.
5. `rollup_has_data` implemented as client heuristic prop, not a persisted capability flag.
6. Legacy source values (`greenfield`, `violation`, `trading-spine`) remain allowed in DB check so migration does not brick existing rows.

## Blockers hit
1. **Schema apply:** no `SUPABASE_DB_PASSWORD` / `DATABASE_URL` — cannot create `resolved_by` / unique index on live Supabase. Run `scripts/apply-todos-source-resolved-by-migration.ts` with DB password.
2. **Live D5/D2 dogfood:** not run (needs signed-in workspace + Needs review rail + scan-clone). Optional Playwright tests skipped without `BLANKO_E2E_LIVE`.
3. **GitHub webhook delivery** for Rollup: not inspected; may still show idle sync status until configured.

## Gaps for human review
1. Confirm Approve never writes to live `.blanko-target` on a real trading-agent workspace (D5).
2. After migration: spot-check unique open `(workspace_id, source_path)` under concurrent rescans.
3. Auto-enqueue may create many tasks on design-mode graphs with `projectRoot` + files — confirm product volume on trading scans.
4. Epic 4 “approved but still failing” card annotation is API-capable (`finding.still_failing`) but not fully surfaced on the kanban card.
5. U1 Playwright ≤2-controls assertion needs an authenticated session with a Needs review card to be falsifiable.
6. Server/client `tsc` still reports many pre-existing errors; only new issues we introduced were cleaned where found.

## Test suite status
| Test | Result |
|------|--------|
| `scripts/test-blanko-severity-enqueue.ts` | PASS |
| `scripts/test-insights-briefing.ts` | PASS |
| `scripts/test-design-rules.ts` | PASS (28) |
| `scripts/blanko-e2e-pipeline.spec.ts` (unit D1/n8n, UI soft gates) | PASS (4) |
| `scripts/blanko-e2e-pipeline.spec.ts` live D2/D5 | SKIPPED (`BLANKO_E2E_LIVE` unset) |
| `scripts/blanko-flow-tasks-audit.spec.ts` | not fully re-run (opener updated for Work rail) |

## Files changed (full list)

### Step 0–1
- `supabase/migrations/20260812180000_todos_source_resolved_by.sql`
- `scripts/apply-todos-source-resolved-by-migration.ts`

### Step 2 (Epic 1)
- `webapp/client/src/severity.ts`
- `webapp/client/src/designRules.ts`
- `webapp/client/src/insightsBriefing.ts`
- `webapp/client/src/blanko/InsightsPanel.tsx`
- `scripts/test-insights-briefing.ts`

### Step 3 (Epic U1)
- `webapp/client/src/FlowTasksBoard.tsx`

### Step 4–5 (Epic 3 + 2)
- `webapp/client/src/autoEnqueueFindings.ts`
- `webapp/client/src/App.tsx`
- `webapp/server/src/todos.ts` (also Step 6)

### Step 6 (Epic 5)
- `webapp/server/src/workspaces.ts`

### Step 7–8 (Epic 4 + U3)
- `webapp/client/src/FlowView.tsx`
- `webapp/client/src/blanko/WorkspaceDock.tsx`
- `webapp/server/src/findingsRoutes.ts`
- `webapp/client/src/blanko/InsightsPanel.tsx` (Apply spine / Fix / soft)

### Step 9–10 (U2 + U4)
- `webapp/client/src/blanko/types.ts`
- `webapp/client/src/blanko/DockRail.tsx`
- `webapp/client/src/blanko/dockLayout.ts`
- `webapp/client/src/ManagementRollupView.tsx`

### Step 11–12
- `scripts/blanko-e2e-pipeline.spec.ts`
- `scripts/test-blanko-severity-enqueue.ts`
- `scripts/blanko-flow-tasks-audit.spec.ts`
- `blanko-e2e-implementation-report.md` (this file)
