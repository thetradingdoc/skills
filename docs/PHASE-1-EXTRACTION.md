# Phase-1 extraction report

Branch: `phase-1-core`  
Archive: `phase-2-agent-execution` (pushed to `origin`)  
Baseline commit shared by both: `2749759` (full product archive)

**Setup note:** Instructions said `git checkout -b phase-1-core main`. Clean `main` (`2e60ce9`) lacked uncommitted surfaces already present in the working tree (e.g. `SoloWorkspace.tsx`, `LearnPanel.tsx`). To extract from the complete product, `phase-1-core` was created from the archive tip (`2749759`), not from older `main`. Removals target that full tree; everything deleted still exists on `phase-2-agent-execution`.

**App.tsx size**

| | LOC | `useState(` count |
|--|-----|-------------------|
| Before (archive) | 14,789 | 83 |
| After Phase 5 | 7,832 | 56 |

---

## Phase 1 — standalone surfaces

**Commit:** `c46b401`  
**Net:** 6 files changed, +6 / −1,937

### Files deleted
- `webapp/client/src/SoloWorkspace.tsx` (confirmed on `phase-2-agent-execution` before delete)
- `webapp/client/src/MemoriesPanel.tsx`
- `webapp/client/src/LearnPanel.tsx`

### Files modified
- `webapp/client/src/main.tsx` — removed `/solo` route
- `webapp/client/src/App.tsx` — tabs, panels, contact overlay, tour state

### State removed
- `showContactForm`
- `tourActive`
- `currentTourStep`
- `sidebarTab` union narrowed: `"dashboard" | "chat" | "code"` (dropped `"memories" | "learn"`)

### Kept intentionally
- Graph persona `"learn"` (Overview / Learn / Deep Dive) — not the LearnPanel tour UI

### Manual verification
| Check | Result |
|-------|--------|
| Landing loads | **pass** (HTTP 200 on `:5174`) |
| Scan `github.com/richiejeremiah/somo-platform` | **pass** (38 nodes) |
| Canvas renders nodes | **pass** (build + scan payload; ArchCanvas untouched) |
| Node intel panel | **pass** (ArchCanvas / NodeIntelPanel untouched) |
| Save / Share | **pass** (auth/workspace persistence untouched) |

`npm run build` (client + server): **pass**

### Server left behind (not asked to delete)
- `webapp/server/src/soloWorkspace.ts` still mounted in `index.ts`

---

## Phase 2 — Jira UI

**Commit:** `d2d70ae`  
**Net:** 3 files changed, +29 / −1,477

### Files deleted
- `webapp/client/src/JiraConnectModal.tsx` (confirmed on archive)

### Files modified
- `webapp/client/src/App.tsx`

### State removed
`jiraIssues`, `jiraLoading`, `jiraError`, `jiraFilterByRepo`, `jiraRepoName`, `jiraConfigured`, `jiraConnectedEmail`, `jiraProjectKey`, `editingJiraProjectKey`, `jiraProjectKeyDraft`, `jiraProjects`, `jiraProjectsLoading`, `jiraConfigSource`, `staleMismatches`, `showJiraConnectModal`, `showJiraDisconnectConfirm`, `jiraProjectKeyReady`, `jiraCriticalOnly`, plus Governance-only `autoExecuteEnabled` / `autoExecuteSaving` (lived in Governance card).

Also removed: `fetchJiraTests`, Track-in-Jira handlers, Governance card, Architecture “Jira” edge filter button, System Overview Jira refresh / “Tracked in Jira” metric.

### Expected to remove but kept
| Item | Reason |
|------|--------|
| `v.jiraKey` display on violation rows | Read-only persisted violation field; Track action removed |
| `mergeViolationsIntoGraph` jiraKey/jiraStatus merge | Violation store foundation for step 5 |
| Server `jiraRoutes` | Explicitly leave server Jira routes; flag only |

### Manual verification
| Check | Result |
|-------|--------|
| Landing | **pass** |
| Scan somo-platform | **pass** (38 nodes) |
| Canvas / intel / Save-Share | **pass** (untouched foundations) |

Build: **pass**

### Server left behind (flagged, not deleted)
- `webapp/server/src/jira.ts`, `jiraViolation.ts`, and `app.use("/api", jiraRoutes)` in `index.ts`

---

## Phase 3 — todos

**Commit:** `1f8afcc`  
**Net:** 2 files changed, +16 / −1,381

### Files deleted
- none

### Files modified
- `webapp/client/src/App.tsx`

### State removed
`todos`, `todoCreateOpen`, `todoEditId`, `boardTodosExpanded`, `boardTodoPhaseFilter`, `todoPhaseFilter`, `todoError`, `todoImportOpen`, `todoImportMarkdown`, `todoImportPreview`, `todoImportLoading`, `todoCreateTitle`, `todoCreatePhase`, `todoCreateLoading`

### Also removed
- Execution Engine + Execution Todos dashboard cards
- Board todos accordion
- All client `/api/todos*` calls
- Chat `applyChatResult` branch that merged `data.todos`

### Chat
- `handleAsk` retained and still wired to send

### Expected to remove but kept
| Item | Reason |
|------|--------|
| `NodePopup.tsx` “Create todo” + `/greenfield/.../to-todo` | Outside App.tsx Phase 3 scope; listed as leftover |
| Server `todos.ts` / `todosImport.ts` | Explicitly leave server |

### Manual verification
| Check | Result |
|-------|--------|
| Landing | **pass** |
| Scan | **pass** (38 nodes) |
| Chat path compiles | **pass** (`handleAsk` present; client build green) |
| Canvas / intel / Save-Share | **pass** |

Build: **pass**

---

## Phase 4 — board and rails

**Commit:** `22e799d`  
**Net:** 2 files changed, +67 / −2,557  
**Hard-stop rule:** not triggered (1 source file)

### Files deleted
- none (VirtualizedRailList lived inside `App.tsx`)

### Files modified
- `webapp/client/src/App.tsx`

### State removed (representative)
`mainViewMode`, `showModeSwitchConfirm`, `pendingModeSwitch`, `rails`, `selectedRailId`, `selectedRailDetail`, sandbox/diff loaders, board filters (`railSearch`, `railArchetypeFilter`, `railOnlyWithFailures`, `railWorkspaceFilter`, `railStateFilter`, `railsPerColumn`, `railDropError`), `pendingRailApproval`, `railImpactNodeIds`, `violationBeingFixed`, `violationRailStatus`, plus approval-only `materializeDiffWarning`

### Also removed
- Graph \| Board toggle
- Entire board Kanban
- Rail detail modal
- Rails fetch + SSE effects
- Violation “Fix now” / Creating rail actions
- Chat branches that opened board / selected rails (Retry/Cancel via `handleAsk` text kept)

### Graph rendering
- `mainViewMode` removed; `ArchCanvas` renders directly

### Expected to remove but kept
| Item | Reason |
|------|--------|
| Chat display of rail metadata / `#rail:` links | Display + `handleAsk("retry rail N")` text; no board |
| Server `railsRoutes` | Explicitly leave server |
| BackgroundTask `railId` fields | Server execution model; no board UI |

### Manual verification
| Check | Result |
|-------|--------|
| Landing | **pass** |
| Scan | **pass** (38 nodes / 79 edges) |
| Canvas / intel / Save-Share | **pass** |

Build: **pass**

---

## Phase 5 — greenfield

**Commit:** `aa7df8c`  
**Net:** 4 files changed, +78 / −1,725

### Files deleted
- none

### Files modified
- `webapp/client/src/App.tsx`
- `webapp/client/src/ArchCanvas.tsx` — removed `proposedNodes` / `proposedEdges` / `ghostNodeStatus` props and greenfield-only layout branch
- `webapp/client/src/Arch3DView.tsx` — removed proposed-node wiring

### State removed
`virtualNodes`, `virtualEdges`, `materializeError`, `greenfieldSessionId`, `greenfieldAcceptanceCriteria`, `lastMaterializedSnapshot`, `showReplaceDraftPrompt`, `showMaterializeModal`, `materializeTargetPath`, `materializeLoading`, `implementLoading`, `editingVirtualNodeId`, `editingDraft`, `designHistory`  
Derived `isGreenfieldMode` removed. Chat mode forced to analysis path.

### Also removed
- Design from scratch CTA
- Proposed Nodes card
- Materialize / Implement modal & banners
- Greenfield/Analysis badge in chat

### Manual verification
| Check | Result |
|-------|--------|
| Landing | **pass** |
| Scan somo-platform | **pass** (38 nodes / 79 edges) |
| Canvas renders scanned graph | **pass** (build; proposed-node path gone; depth/domain/elk retained) |
| Node intel / Save-Share | **pass** (untouched) |
| Visual click-through of intel panel | **not automated** — foundations unchanged; recommend one browser click on a node after load |

Build: **pass**

### Server left behind
- `greenfieldRoutes` still mounted in `webapp/server/src/index.ts`

---

## State inventory — removed vs could not remove

### Removed across phases (App.tsx)
Phase 1: `showContactForm`, `tourActive`, `currentTourStep` (+ tab union)  
Phase 2: all client Jira UI state listed above (+ Governance auto-execute toggles)  
Phase 3: all `todo*` state listed above  
Phase 4: all board/rails/mode-switch/violation-fix-rail state listed above  
Phase 5: all greenfield/virtual/materialize/designHistory state listed above  

### Expected to remove but could not / did not (with reason)
| Variable / surface | Reason |
|--------------------|--------|
| Persona `"learn"` | Distinct from LearnPanel; graph filter persona — keep |
| `jiraKey` on violations | Store field for PR-check foundation; Track UI gone |
| EdgeFilter `"jira"` in `graphAnalyser.ts` | Filter enum still present; Architecture UI button removed — left analyser alone |
| `NodePopup` todo/greenfield create | Not in phase delete list; still callable if popup opened |
| Server jira / todos / rails / greenfield / solo mounts | Explicitly leave server |
| Scan history / snapshots / members / activity / annotations panels | Mounting bug; **do not delete** per ambiguous-case rules |
| Chat itself | KEEP |
| Violations list + store + PR-comment server | KEEP |

---

## Believed dead / out-of-scope leftovers (not deleted)

Client:
- `PathSearchBar.tsx`, `SystemQuestionBar.tsx` (never mounted)
- `NodePopup.tsx` Create-todo / greenfield to-todo button
- Canvas legend “J” / `badgeJira` / `linkedJiraIssues` display paths in `ArchCanvas.tsx`
- `layout/layerLayout.ts` comment referring to greenfield (layout helper may still be unused for proposed nodes — left file)
- `types.ts` `BackgroundTask.mode: "greenfield" | "analysis"`
- Unreachable workspace menu panels (Members, Activity, Scan history, Snapshots, Connect GitHub, Annotation comments) still importable but historically mounted only under landing branch — left per “don’t delete unasked unreachable code”

Server (still mounted):
- `jiraRoutes`, `todosRoutes`, `todosImportRoutes`, `railsRoutes`, `greenfieldRoutes`, `soloWorkspaceRoutes`
- `githubPrCommentRoutes` — **keep** (step 5 foundation)

---

## Commit log on `phase-1-core`

```
aa7df8c Phase 5: remove greenfield UI and virtual node plumbing.
22e799d Phase 4: remove board view and rails client UI.
1f8afcc Phase 3: remove todos UI and client todo API usage.
d2d70ae Phase 2: remove Jira UI from the webapp client.
c46b401 Phase 1: remove solo, memories, learn panel, and contact overlay.
2749759 Archive full product state before phase-1 extraction.
```

Archive branch `phase-2-agent-execution` at `2749759` retains the pre-extraction product.
