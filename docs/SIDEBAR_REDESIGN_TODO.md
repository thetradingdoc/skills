# Sidebar Redesign — Attention Hierarchy (Command Center)

> **Principle:** Attention hierarchy over information density. Answer one question at a time: (1) Does anything need me? (2) What is the agent doing? (3) What does the project look like? (4) Let me talk to the agent.

**Target:** `webview-ui/src/App.tsx` (VS Code extension sidebar). Same zone model can be applied to the webapp later.

---

## Dependency order

- **Phase A:** Zones 1, 6 (command strip + chat) — establishes layout and persistence.
- **Phase B:** Zone 2 (attention required) — needs existing HITL/playwrightHitl/failedRailHitl/visual data; Z2.11 depends on p7 (collision UI).
- **Phase C:** Zone 3 (active rail) — needs tasksSnapshot/rail data already wired; Z3.8 depends on p2 (logic path breadcrumb).
- **Phase D:** Zones 4 & 5 (project health, governance) — refactor existing blocks into collapsible zones.
- **Phase E:** Collapse rules, responsive, accessibility.

**Build-order deps:** Z2.11 ↔ p7 (checkRailCollisions UI); Z3.8 ↔ p2 (logic path breadcrumb); Z6.8 ↔ p3 (rail-scoped trace filter).

---

## Zone 1 — Command strip (always visible, ~60px)

| ID | Task | Details |
|----|------|--------|
| **Z1.1** | Reserve fixed top strip | One row, ~48–60px height, `flexShrink: 0`, never scrolls away. |
| **Z1.2** | Agent ON/OFF toggle | Show current `archVisualizer.agentActive`; click posts message to extension to flip. Label: "● Agent ON" / "○ Agent OFF". |
| **Z1.3** | Token usage display | Show `session.tokenUsage` (or telemetry total) e.g. "12k tokens"; abbreviate to "12k" when width &lt; 300px. |
| **Z1.4** | Project / Jira context | Show project key (e.g. "DOCLITTLE") when available; optional "Jira" icon or label. |
| **Z1.5** | Sign out / workspace | If webapp: Sign out. If webview: optional "Refresh" or leave to extension chrome. |
| **Z1.6** | Layout and spacing | Single line flex; wrap to two lines only when width &lt; 240px; consistent 8px gaps. |

---

## Zone 2 — Attention required (only when there is something)

| ID | Task | Details |
|----|------|--------|
| **Z2.0** | **Priority ordering rule (canonical)** | When multiple attention items exist, render in this order only: **FAILED rail** > **HITL gate** > **cost gate** > **Playwright HITL** > **visual critique** > **collaborator overlap warning**. Implementation must use this ordering; no arbitrary choice. |
| **Z2.1** | Container and visibility | Section exists only when `attentionItems.length > 0`. Collapse to 0 height when empty. |
| **Z2.2** | Define attention item types | Union: `hitl_gate` \| `playwright_hitl` \| `visual_critique` \| `failed_rail` \| `cost_gate` \| `collaborator_overlap`. Each has title, short description, actions. |
| **Z2.3** | Apply priority order | Use Z2.0 when building `attentionItems`; sort before render. |
| **Z2.4** | HITL gate card | Title "HITL Gate — Rail: {outcome snippet}"; body from gate (e.g. "Executor finished T3. Verify data shape."); actions: Approve, Reject, View rail. |
| **Z2.5** | Playwright HITL card | Title "Playwright failed"; list failing tests; actions: Retry, Suspend, Create Jira, Investigate. If any failure is `[VISUAL]`, show sub-label "Visual constraint failure — layout/overlap/visibility". |
| **Z2.6** | Visual critique card | Title "Visual Critique — {element}"; body: violation text (e.g. "Text overlap: Design + your architecture"); actions: Create Jira, Investigate, **Dismiss**. |
| **Z2.7** | Dismiss semantics for visual | Decide and implement: (A) Dismiss = remove from list only this session, or (B) Dismiss = mark acknowledged so it doesn’t reappear for this rail. Document in UI (tooltip or label). |
| **Z2.8** | Failed rail card | Title "Rail failed"; body: reason; actions: Investigate, Create Jira, Abandon. |
| **Z2.9** | Cost gate card | Title "Token budget exceeded"; actions: Extend budget, Create Jira, Abort. |
| **Z2.10** | Section header | "⚠ NEEDS YOUR ATTENTION" with count badge (e.g. "2 items"). |
| **Z2.11** | **Collaborator overlap card** | When `checkRailCollisions` reports overlaps for the active (or any) rail: show as lowest-priority attention item. Title: "N other rail(s) on same modules"; body: list shared nodes / shared Jira keys; expand to show per-rail overlap with "Jump to rail" action. Depends on p7 (collision UI). Data: `RailOverlap` / `RailCollaboratorBadge` from spec. |

---

## Zone 3 — Active rail (collapsible, one rail at a time)

| ID | Task | Details |
|----|------|--------|
| **Z3.1** | Container and collapse | Collapsible section "▼ ACTIVE RAIL" / "▶ ACTIVE RAIL". When expanded, show one rail. |
| **Z3.2** | Which rail is "active" | If any rail is AWAITING_HITL or FAILED, show that one first. Else most recently updated. Else EXECUTING. If multiple, show rail switcher (tabs or dropdown): "Rail A | Rail B". |
| **Z3.3** | Rail header line | State badge (e.g. EXECUTING 3/6) + outcome snippet (e.g. "Design your architecture."). |
| **Z3.4** | Logic path (reference) | See Z3.8 for full breadcrumb behaviour. |
| **Z3.8** | **Logic path breadcrumb (required, p2)** | Render `rail.logicPath` as a visual step sequence (e.g. `UI → API → Jira`). **Active step:** highlight the step matching the current task's `logicPath` index. **Drift indicator:** when `rail.hallucinationIndex > 0.5`, show an indicator on the breadcrumb (e.g. warning icon or tint) meaning "Executor touched nodes outside the intended path." Required for build order p2; non-negotiable. |
| **Z3.5** | Task list | One row per task: ✓ T1 description, ⟳ T2 (executing), ○ T3 (pending). Show agent role for current (e.g. "executor", "reviewer"). |
| **Z3.6** | Telemetry line | One line: "Tokens: 4.2k | Critique loops: 1 | Visual: 0 | Retry: 0/3". Use distinct labels: "Critique loops" = diff-reject count; "Visual" = visual findings count. |
| **Z3.7** | Expand to all rails | When multiple rails, "▼ All rails" expands to list of rails with same card structure (compact) or links. |

---

## Zone 4 — Project health (collapsible, default collapsed when Zone 2/3 have content)

| ID | Task | Details |
|----|------|--------|
| **Z4.1** | Collapsible header | "▶ PROJECT HEALTH" with summary: "13 modules | ⚠ 13 no-context | 0 violations". Single line. |
| **Z4.2** | Expand content | Current 2×2 grid (Modules, Connections, Drift, No context) + Refresh. |
| **Z4.3** | Violations list | When expanded, show active violations list (current behavior); optional "No context" drill-down list (which modules). |
| **Z4.4** | Default collapsed when busy | If Zone 2 or Zone 3 has content, Zone 4 starts collapsed. |
| **Z4.5** | Persist expansion | If user expands Zone 4, keep it expanded for the session until Zone 2 gets a new item (or user collapses). |

---

## Zone 5 — Governance (collapsible, default collapsed when Zone 2/3 have content)

| ID | Task | Details |
|----|------|--------|
| **Z5.1** | Collapsible header | "▶ GOVERNANCE" with summary: "● Connected | DOCLITTLE | 1 issue". |
| **Z5.2** | Expand content | Current Jira block: project key, This repo / Disconnect, issues list, Connect Jira. |
| **Z5.3** | Default collapsed when busy | Same rule as Zone 4 when attention/rail content exists. |
| **Z5.4** | Persist expansion | Same as Z4.5 for Zone 5. |

---

## Zone 6 — Chat (persistent, fixed at bottom)

| ID | Task | Details |
|----|------|--------|
| **Z6.1** | Fixed height container | Chat area fixed to bottom ~40% of sidebar (e.g. min 240px, max 50%). Use flex: main content area `flex: 1; minHeight: 0`; chat section `flexShrink: 0; height: 40%` or min height. |
| **Z6.2** | Header | "AGENT" + chat tabs [ Chat 1 ] [ Chat 2 ] [ + ]. |
| **Z6.3** | Message list | Scrollable; existing ChatPanel or equivalent. |
| **Z6.4** | Critic message styling | Keep yellow/amber background; add **inline action buttons** on Critic messages. |
| **Z6.5** | "Create Jira from critique" button | On each Critic message, primary action: create one Jira issue with body = critique text. Calls extension or API to create issue. |
| **Z6.6** | "Create tasks from critique" (optional phase 2) | Secondary button: open modal to split/confirm tasks from critique text, then create (or create one Jira and optional sub-tasks). Can ship after Z6.5. |
| **Z6.7** | Input bar | Fixed at bottom of Zone 6; "Ask about your architecture..." + Send. Never hidden by scroll. |
| **Z6.8** | **Rail-scoped trace filter (required, p3)** | Chat/trace feed shows entries for the **active rail only** (`railId` first). When multiple rails exist, the feed must not mix entries from all rails. Filter controls: within that rail, optional filter by role/type (e.g. planner, executor, reviewer). Required for build order p3; non-negotiable. |

---

## Cross-cutting

| ID | Task | Details |
|----|------|--------|
| **CX.1** | Collapse rule implementation | When `attentionItems.length > 0` or `activeRail != null`, set Zones 4 & 5 default to collapsed. When user manually expands 4 or 5, store in state and do not auto-collapse until Zone 2 gets a new item (or explicit collapse). |
| **CX.2** | Narrow sidebar (responsive) | When sidebar width &lt; 280px: allow Zone 1 to shorten labels ("12k", "DOC"); allow Zone 1 to wrap to two lines. Ensure Zone 2 cards and Zone 3 task list remain readable (truncate long text with tooltip). |
| **CX.3** | Keyboard / focus | Zone 2 action buttons (Approve, Reject, Create Jira, etc.) are focusable; focus first action when attention card appears. Optional: Approve = Enter, Reject = Esc. |
| **CX.4** | Data wiring | Ensure existing message handlers (tasksSnapshot, playwrightHitl, failedRailHitl, costGate, agentSessionUpdate, etc.) feed into the new zone state (attention list, active rail, telemetry). |
| **CX.5** | Styles and constants | Centralize zone heights/min-heights and breakpoints (e.g. SIDEBAR_NARROW = 280) in `webview-ui/src/styles.ts` or App. |

---

## File and component checklist

| Item | Location / note |
|------|------------------|
| Command strip component | New `CommandStrip.tsx` or inline in App.tsx Zone 1. |
| Attention list component | New `AttentionRequiredZone.tsx` consuming attention items array. |
| Active rail component | New `ActiveRailZone.tsx` or refactor existing rail/task blocks. |
| Project health collapsible | Refactor existing project overview + violations into `ProjectHealthZone.tsx`. |
| Governance collapsible | Refactor existing Jira block into `GovernanceZone.tsx`. |
| Chat panel | Existing `ChatPanel`; extend to support Critic action buttons and fixed height container. |
| App layout | `App.tsx`: single column flex; Zone 1 fixed top; scrollable middle (Z2, Z3, Z4, Z5); Zone 6 fixed bottom. |

---

## Acceptance criteria (summary)

1. **Command strip** always visible; agent toggle, tokens, project key, sign out (or refresh) on one line.
2. **Attention zone** shows only when there is at least one item; **Z2.0 ordering** (FAILED > HITL > cost gate > visual > overlap); each card type has correct actions; collaborator overlap card when collisions exist.
3. **Active rail** shows one rail at a time with task list and telemetry; **logic path breadcrumb** (Z3.8) with active step and drift indicator when `hallucinationIndex > 0.5`; rail switcher when multiple.
4. **Project health** and **Governance** collapsible; collapsed by default when attention or rail is active; expansion persists per session.
5. **Chat** uses ~40% of sidebar height, fixed at bottom; Critic messages have "Create Jira from critique" (and optionally "Create tasks from critique"); **trace feed rail-scoped** (Z6.8) by active `railId` with role/type filter.
6. **Narrow sidebar** does not break layout; labels shorten where needed.
7. **Keyboard**: Zone 2 actions focusable; optional shortcuts.
