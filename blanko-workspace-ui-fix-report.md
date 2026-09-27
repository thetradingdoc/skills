# Workspace Shell UI Fix Report

## Summary
Groups 1–6 are implemented against the audit + Group 0 decisions (E1–E7). Structural System / Tasks / Ops separation, chrome Rollup removal, ChromeBar overflow handling, Work→Tasks label rename, Flow copy cleanup, and Agents light-theme restyles are in place. Unit + Playwright non-live suites pass. **Partial:** full deletion of the large `!blankoShell` legacy App.tsx tree was **not** done (E5) — `blankoShell` is hardcoded `true`, so those branches are unreachable, but removing ~1k+ lines mid-shell was deferred as high-regression risk; flagged below.

## Group 0 — Decisions applied
- **E1:** System = Platforms + Path only (`WorkspaceDock.tsx`). Implemented.
- **E2:** Ops = own `DockMode: "ops"` + `OpsDock.tsx`; rail visibility gated by `showOps` / `rollupHasData` heuristic. Implemented.
- **E3:** Chrome Rollup removed from `ChromeBar.tsx` and blanko `App.tsx` wiring. Implemented.
- **E4:** Rail/display label `View` → `Canvas` (`types.ts` DOCK_MODES, `ViewDock.tsx`). DockMode id remains `"view"`. Implemented.
- **E5:** Confirmed `const blankoShell = true` with no runtime toggle. Blanko chrome Rollup path removed. **Deviation:** did not delete the entire `!blankoShell` legacy toolbar / `graphViewMode` full-page tree in `App.tsx` (including ~8665 `chrome-tab-rollup`) — still dead code, isolated behind `!blankoShell`. See “Anything skipped.”
- **E6:** Display “Work” → “Tasks”; ids/testids `work` / `blanko-rail-work` preserved. Implemented.
- **E7:** `TasksPanel.tsx` had no live blankoShell call sites (only re-export). **Deleted** file + export.

## Group 1 — Structural dock fix
- Gate result: **PASS**
- System, Tasks (`work`), and Ops are separate `DockMode` destinations with separate components (`WorkspaceDock`, `TasksDock`, `OpsDock`).
- DockFrame H1 comes from `DOCK_MODES` for the active mode; each dock’s breadcrumb matches that destination (System · Platforms|Path, Tasks…, Ops · Rollup|Changes). No shared last-tab leak between System and Tasks/Ops.
- Identifier choice: kept `workspace` = System, `work` = Tasks (E6), added `ops` for Ops.

## Group 2 — Duplicate entry points
- Gate result: **PASS** (with E5 note)
- Chrome Rollup removed; Ops rail is the sole Rollup entry when `showOps` is true.
- `rollupRefreshKey` retained and passed into `OpsDock` only.
- Ops rail respects the same heuristic previously used for the Ops tab (`findings` or open todo source paths).
- View → Canvas display rename done.
- `TasksPanel.tsx` deleted.
- Legacy `!blankoShell` Rollup button / graphViewMode routes: unreachable, not deleted wholesale (PARTIAL vs full E5 delete).

## Group 3 — Chrome bar overflow
- Gate result: **PASS** (code + layout rules; visual spot-check recommended in running app)
- Removed 720px cap; `maxWidth: calc(100% - 160px)`, `overflow-x: auto`, trailing controls `flexShrink: 0`.
- Search collapses to icon-only until focused/expanded (priority collapse).
- Removing Rollup alone would have helped but chips + Save/Share/Export still needed the overflow/cap fix with Money path / Code map present.
- Raw module scans show muted **Module map** chip (`chrome-code-map-hint`) explaining spine toggle absence.

## Group 4 — Work → Tasks rename
- Gate result: **PASS**
- User-facing task-board “Work” strings updated (types label, FlowTasksBoard H1/copy/tooltip, App notice, FlowView empty, insightsBriefing, comments).
- Remaining occurrences: **none** for task-board “Work” in `webapp/client/src` (grep). Testids/enum `work` unchanged.
- `OVERFLOW_VIEWS` deprecated `flow` label set to “Path” for consistency.

## Group 5 — Copy consistency
- Gate result: **PASS**
- Insights “Go to Flow” / Flow notices / “Workspace · Flow” / button “Flow” → Path / Tasks / System · Path.
- App Fix notices no longer say “Flow → Tasks”.
- `flowTradingSeed` / `designBlueprints` comments/copy updated.
- No remaining product-destination “Flow” strings in blanko panels (deprecated OverflowView id `flow` remains as an identifier only).

## Group 6 — Agents theme fix
- Gate result: **PASS** (tokenized light surfaces)
- Layers / Agents / Reach / Guard / Usage dark roots and `#0b1220` / `#161b22` / `#7d8590` panels moved to `PAPER` / `CANVAS` / `SLATE` / `INK`.
- Layers select and status bands use light washes; no dark-on-dark.
- AssessmentView left as spot-check (already light).
- DockFrame footer should read cleanly against light Agents content; confirm visually in the running app.

## Final verification pass
- Playwright `scripts/blanko-e2e-pipeline.spec.ts`: **4 passed, 2 skipped** (live guards).
- `test-blanko-severity-enqueue.ts` / `test-insights-briefing.ts`: **PASS**.
- `blanko-rail-work` testid preserved (E6).
- Manual sequence of all rail destinations: recommend operator confirmation in the running `npm run webapp` session (layout/contrast).

## Anything skipped or left incomplete (be explicit, do not omit)
1. **E5 wholesale delete** of `!blankoShell` App.tsx branches (legacy toolbar including `chrome-tab-rollup` at ~8665, full-page `graphViewMode` agents/layers/rollup/…). Confirmed unreachable (`blankoShell === true` always) but not deleted to avoid a massive unrelated diff; still dead code debt.
2. **Visual gate confirmation** for Chrome overflow and Agents contrast was validated by code/layout rules + unit/e2e; pixel-perfect screenshot confirmation in the user’s viewport should still be done once.
3. Some Agents views may still use non-token accent hex for severity/dispute chips (e.g. pink/yellow borders) — intentional emphasis, not dark-theme surfaces.
4. `FlowView` still supports dual Path|Tasks tabs when not opened in dedicated mode; System only passes `initialPane="path"`, Tasks uses `TasksDock` → board directly.

## Files changed (full list, grouped by group number)

### Group 1
- `webapp/client/src/blanko/types.ts`
- `webapp/client/src/blanko/WorkspaceDock.tsx`
- `webapp/client/src/blanko/TasksDock.tsx` (new)
- `webapp/client/src/blanko/OpsDock.tsx` (new)
- `webapp/client/src/blanko/DockRail.tsx`
- `webapp/client/src/blanko/dockLayout.ts`
- `webapp/client/src/blanko/index.ts`
- `webapp/client/src/App.tsx` (dock routing / render)

### Group 2
- `webapp/client/src/blanko/ChromeBar.tsx` (Rollup removed; also Group 3)
- `webapp/client/src/blanko/ViewDock.tsx`
- `webapp/client/src/blanko/TasksPanel.tsx` (**deleted**)
- `webapp/client/src/App.tsx` (onOpenRollup removed; showOps)

### Group 3
- `webapp/client/src/blanko/ChromeBar.tsx` (overflow, search collapse, Module map hint)
- `webapp/client/src/App.tsx` (`showCodeMapHint`)

### Group 4
- `webapp/client/src/FlowTasksBoard.tsx`
- `webapp/client/src/FlowView.tsx`
- `webapp/client/src/insightsBriefing.ts`
- `webapp/client/src/autoEnqueueFindings.ts`
- `webapp/client/src/App.tsx` (notice copy)
- `webapp/client/src/blanko/types.ts` (Tasks label)

### Group 5
- `webapp/client/src/blanko/InsightsPanel.tsx`
- `webapp/client/src/App.tsx` (Fix notices)
- `webapp/client/src/flowTradingSeed.ts`
- `webapp/client/src/designBlueprints.ts`
- `webapp/client/src/blanko/types.ts` (OVERFLOW_VIEWS flow → Path)

### Group 6
- `webapp/client/src/LayersView.tsx`
- `webapp/client/src/AgentsView.tsx`
- `webapp/client/src/ReachView.tsx`
- `webapp/client/src/GuardView.tsx`
- `webapp/client/src/UsageView.tsx`

### Report
- `blanko-workspace-ui-fix-report.md` (this file)
