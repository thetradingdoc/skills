# Architecture Diagnosis & Fix Plan

## Review of Original Diagnosis

### Problem 1: `deriveProjectKey` produces invalid keys — **CONFIRMED**

**Bug:** `doclittle-platform` → `DOCLITTLE-` (trailing hyphen). The regex `[^A-Z0-9_-]` allows hyphens; `.slice(0,10)` cuts at the hyphen. Jira project keys don't allow trailing hyphens; many repos have hyphens in the name.

**Locations:** 
- `webapp/server/src/utils/deriveProjectKey.ts`
- `webapp/client/src/App.tsx` (duplicate implementation)

**Fix:** Change to `[^A-Z0-9]` (strip hyphens/underscores) so `doclittle-platform` → `DOCLITTLEPLATFORM` → `DOCLITTLEP` (slice 0,10). Alternatively: strip trailing `-`/`_` after slice.

---

### Problem 2: `staleJiraDetector` is partially inert — **CONFIRMED (refined)**

**Built:** 
- `detectStaleJira()` — compares fingerprints
- `extractFingerprintFromDescription()` — parses fingerprints from Jira ADF/plain text
- `computeModuleFingerprint()` — hashes path + file list

**Actually called:** Yes — in `extension.ts` when handling Jira fetch (`searchIssues` with `includeDescription: true`). The extension maps issues to `issuesWithFp` and calls `detectStaleJira(graph, issuesWithFp)`.

**Why it returns no useful results:**
1. **No fingerprints in Jira descriptions:** `jiraViolation.ts` creates issues with a markdown description but never writes `arch-fingerprint:` or `arch-module:` lines. So `extractFingerprintFromDescription()` always returns `null`, and `detectStaleJira()` skips all issues (`if (!issue.storedFingerprint) continue`).
2. **Gate check ignores results:** `runGateCheck()` hardcodes `hasStaleJiraMismatch: false` in the context passed to `checkGates()`. Even if `detectStaleJira` found mismatches, they’re sent to the webview only — never used for the gate. The `stale_jira_mismatch` gate can never fire.

---

### Problem 3: `executeJiraCreateTicket` / `executeJiraSearchByArchNodeId` use env, not DB — **CONFIRMED**

```ts
const config = getJiraConfig();  // JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
const projectKey = process.env.JIRA_PROJECT?.trim();
```

The system uses per-user credentials in `integrations` and per-workspace `jira_project_key`, but these agent tools still use env vars. They fail for per-user setup or use one shared account for everyone.

---

### Problem 4: Violation pipeline is one-way and manual — **CONFIRMED**

- `markAbsent` is always `false` in `chat.ts` → old violations never marked absent when code changes.
- `recordScanSnapshot()` is called from chat — that part works.
- Violations are only written during chat/critic runs, not on a schedule.
- `bump_violation` RPC with escalation exists, but recurrence rarely bumps in practice.
- Auto-create for critical violations only fires mid-chat when Jira is fully configured.

---

### Problem 5: Gate checker has no loop to gate — **CONFIRMED**

`gateChecker.ts` evaluates conditions, but there is no orchestrator that:
1. Runs on a schedule or trigger
2. Calls the critic
3. Calls `checkGates()`
4. Acts on the gate result

`agent/index.ts` re-exports; no loop.

---

### Problem 6: `claudeEnricher.ts` vs enricher — **CORRECTION**

**Original claim:** "claudeEnricher.ts uses OpenAI, not Claude."

**Actual:** `claudeEnricher.ts` uses **Anthropic** (Claude) for chat/Q&A. The confusion is with other enrichers:
- `enricher.ts` — OpenAI gpt-4o-mini for node enrichment
- `enricher-v2.ts` — heuristic + optional OpenAI for node layer/labels
- `nodeEmbeddings.ts` — OpenAI text-embedding-ada-002

**"13 No context":** This comes from `missingContextNodes = graph?.nodes.filter(n => !n.health?.hasContext)`. The `health.hasContext` flag is set by the critic/scan, not the enricher. The webapp scan uses `embedAndPersistNodes` (OpenAI embeddings) and `scan-repo.ts`; it does not use `enricher-v2` or `enricher` for the webapp graph. So "No context" = nodes without `health.hasContext`, which may come from critic logic or from graphs that never get that field set.

---

### UI Problems — **CONFIRMED**

1. Project label too long; wraps badly
2. Dropdown + text input shown together; confusing
3. No inline validation for invalid keys; error far from input
4. "Track in Jira" disabled with no tooltip
5. Violations not sorted by severity
6. Jira list `maxHeight: 100` too small
7. No severity badges in Jira issues list

---

## Additions

### Problem 8: Duplicate `deriveProjectKey` and validation

`deriveProjectKey` exists in both:
- `webapp/server/src/utils/deriveProjectKey.ts`
- `webapp/client/src/App.tsx` (inline)

Project key validation regex `^[A-Z][A-Z0-9_-]{0,9}$` is in:
- `App.tsx`
- `integrationRoutes.ts`
- `workspaces.ts`

Any fix must be applied consistently. Consider a shared utility or ensuring both implementations stay in sync.

---

## Missing Items (Additions)

### Data integrity gaps

- **p9** — `bump_violation` RPC is called in `violationStore.ts` but never defined in migrations. If it doesn't exist in Supabase, every violation upsert silently fails. Confirm the RPC exists or write it.

- **p10** — `violation_policy_events` table is inserted into in `violationStore.ts` and `violations.ts` but no migration is listed. Same risk as above.

- **p11** — `violation_scans` table referenced in `recordScanSnapshot()` — no migration confirmed. RPC/table may be missing.

### Security gap

- **p12** — `jira-violation` route has no ownership check on `workspaceId`. Any authenticated user can pass any `workspaceId` and read its project key via `getWorkspaceProjectKey()`. There's an ownership check for violations by `violationId`, but not for the workspace itself.

### Data flow gaps

- **p13** — When `handleTrackViolation` succeeds and sets `jiraKey` on the frontend violation, it never updates the DB *unless* a `violationId` was passed. For chat-origin violations (no `violationId`), the Jira link is frontend-only and lost on refresh.

- **p14** — `fetchPersistedViolations` returns violations from DB on workspace load, but these violations' `jiraKey`/`jiraStatus` are not merged into the graph's node `violationState`. Badge indicators on the canvas won't show Jira-tracked state after reload.

### Agent tool gap

- **p15** — `executeJiraSearchByArchNodeId` uses `JIRA_PROJECT` env var. Same fix as p3: use per-user/workspace config. Both `executeJiraCreateTicket` and `executeJiraSearchByArchNodeId` need updating.

### UX / race conditions

- **p16** — No loading state between Jira connected and `jiraProjectKey` populated. The `useEffect` for `fetchJiraTests` fires before the key is ready → spurious `project_key_required` error flash on every workspace load.

- **p17** — `saveProjectKey` calls `fetchJiraTests()` immediately after save, but `jiraProjectKey` state updates inside the `.then()` callback. Fetch runs with the old key — race condition.

- **p18** — No UI to clear/reset the project key once set. PATCH supports it; UI has no "clear" affordance. Only option is disconnect + reconnect.

### Missing functionality

- **p19** — `addLabelToIssue` does optimistic update on `jiraIssues`. If the API fails, the label stays in the UI; no rollback. `catch` sets `jiraError` only.

- **p20** — `jiraFilterByRepo` toggle state is not persisted. Resets to `true` on refresh. Users who prefer "Show all" must toggle every session.

**Priority:** p9 (RPC), p12 (ownership), p13 (Jira link lost), and p17 (race) are most critical for correctness. Others block good UX but won't silently corrupt data.

---

## TODO List (Implementation Order)

| ID   | Task | Notes |
|------|------|-------|
| **p1** | Fix `deriveProjectKey` | Use `[^A-Z0-9]` or strip trailing `-_`; fix both client and server |
| **p8** | Unify deriveProjectKey & validation | Single source of truth; align regex with Jira rules |
| **p2a** | Write `arch-fingerprint` + `arch-module` in Jira descriptions | In `jiraViolation.ts` when creating issues |
| **p2b** | Wire `staleMismatches` into `runGateCheck` | Fetch issues + run detector; set `hasStaleJiraMismatch` from result |
| **p3** | Per-user Jira in `tools.ts` create ticket | Pass userId/workspaceId; use `getUserJiraConfig`, workspace `jira_project_key` |
| **p4a** | Pass `markAbsent: true` when appropriate | In chat.ts or scan flow when violations not in current set |
| **p4b** | Scheduled/triggered violation re-scan | Beyond chat; e.g. on scan, webhook, or cron |
| **p5** | Agent orchestrator loop | Schedule/trigger → critic → checkGates → act on gate |
| **p6** | Trace "No context" source | Verify where `health.hasContext` is set; add Anthropic fallback if needed |
| **p7a** | Project key UI | Shorten label; dropdown primary, text fallback; inline validation |
| **p7b** | Violation UI | Tooltip on disabled Track; sort by severity |
| **p7c** | Jira list UI | Increase maxHeight; severity badges |
| **p9** | `bump_violation` RPC | Confirm/create in Supabase migrations |
| **p10** | `violation_policy_events` table | Confirm/create migration |
| **p11** | `violation_scans` table | Confirm/create migration; recordScanSnapshot |
| **p12** | Workspace ownership on jira-violation | Reject if user doesn't own workspace |
| **p13** | Persist Jira link for chat-origin violations | Upsert violation row or link when tracking |
| **p14** | Merge jiraKey/jiraStatus into graph violationState | From persisted violations on load |
| **p15** | Per-user config in `executeJiraSearchByArchNodeId` | Same as p3; both agent Jira tools |
| **p16** | Loading state before jiraProjectKey ready | Prevent spurious error flash |
| **p17** | Fix saveProjectKey race | Fetch after state update; don't use stale key |
| **p18** | UI to clear project key | PATCH supports; add clear affordance |
| **p19** | Rollback optimistic addLabelToIssue on failure | Revert jiraIssues on API error |
| **p20** | Persist jiraFilterByRepo | localStorage or user preference |

---

## Suggested Execution Order

1. **Critical correctness (p9–p12, p17):** DB migrations, workspace ownership, saveProjectKey race.
2. **Data flow (p13, p14):** Persist Jira link for chat violations; merge persisted state into graph.
3. **Quick wins (p1, p8, p7a–c):** Fix deriveProjectKey, unify validation, improve Jira UI.
4. **Stale detection (p2a, p2b):** Fingerprints in Jira; wire into gate.
5. **Auth/config (p3, p15):** Per-user Jira in both agent tools.
6. **Pipeline (p4a, p4b):** markAbsent and re-scan triggers.
7. **UX (p16, p18–p20):** Loading state, clear project key, addLabel rollback, persist filter.
8. **Orchestration (p5, p6):** Agent loop and enricher/context handling.
