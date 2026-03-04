# Greenfield Mode — Task Plan

> **Goal:** Introduce a first-class Greenfield execution mode so the agent can design architectures from scratch (empty workspace), not just review or incrementally extend existing ones.

**The "Heart" of the system:**
- **Manager/Critic** = Brain (logic)
- **Canvas** = Eyes (visual)
- **Materialize Button** = Hands (action) — user-approved, same UX as chat approval
- **Skill Library** = Memory (evolution)
- Together: **Imagine** (greenfield) → **Validate** (critic) → **Act** (materialize, with consent) → **Learn** (self-evolving)

---

## Phase 1 — Gate & Mode

### Task 1.1 — Add `AgentMode` type
**File:** `src/types.ts`  
**Action:**
- Add `export type AgentMode = "analysis" | "greenfield";`

### Task 1.2 — Relax chat validation, introduce mode
**File:** `webapp/server/src/chat.ts`  
**Action:**
1. Remove the hard block: `if (graph.nodes.length === 0) { return 400; }`
2. Keep the structural check: `graph` must exist with `nodes` and `edges` arrays (even if empty)
3. Add mode detection:
   ```ts
   const isEmptyGraph = !graph || graph.nodes.length === 0;
   const mode: AgentMode = isEmptyGraph ? "greenfield" : "analysis";
   ```
4. Pass `rootPath: null` for greenfield (do not fabricate a fake path)
5. Pass `mode` into `runArchitectureTask`

### Task 1.3 — Backwards compatibility
**File:** `webapp/server/src/chat.ts`  
**Action:**
- If request body omits `mode`, default to `"analysis"` to avoid breaking older clients
- Same for chat API: if graph shape is ambiguous, treat as analysis

---

## Phase 2 — Manager Orchestration

### Task 2.1 — Add `mode` param and orchestrator switch
**File:** `src/ai/manager.ts`  
**Action:**
1. Add `mode: AgentMode` to `runArchitectureTask` params
2. Add `rootPath: string | null` (allow null for greenfield)
3. At top of `runArchitectureTask`, add mode switch:
   ```ts
   switch (mode) {
     case "analysis":
       return runAnalysisTask({ ...params, rootPath: rootPath! });
     case "greenfield":
       return runGreenfieldTask({ ...params });
   }
   ```

### Task 2.2 — Extract `runAnalysisTask`
**File:** `src/ai/manager.ts`  
**Action:**
- Move current `runArchitectureTask` body (preflight, librarian, route, Claude loop, critic, etc.) into `runAnalysisTask`
- `runAnalysisTask` receives `rootPath: string` (guaranteed non-null)
- Keep preflight, skill loading, and all existing logic inside `runAnalysisTask`
- `runArchitectureTask` becomes the thin orchestrator that delegates by mode

### Task 2.3 — Implement `runGreenfieldTask`
**File:** `src/ai/manager.ts`  
**Action:**
- New function `runGreenfieldTask(params)` where params omit `rootPath` (or accept `rootPath: null`)
- No preflight
- No librarian / skill loading
- No `routeQuestion` (or call with empty graph and ignore node-specific routing)
- Call `askGreenfield` (new) instead of `askWithClaude`
- Call `reviewGreenfieldAnswer` (new) instead of `reviewArchitectureAnswer`
- Return `{ answer, graphCommand, criticReport, criticScore, violations }` in same shape as analysis
- Optional: skip critic retry loop or use simplified single-pass logic

### Task 2.4 — Add `traceId` for observability
**Files:** `src/ai/manager.ts`, `src/types.ts`  
**Action:**
- Generate `traceId` (e.g. `crypto.randomUUID()`) at start of `runArchitectureTask`
- Include `traceId` in `ManagerResult` and in all structured logs
- Log `[manager] traceId=X mode=greenfield|analysis`

---

## Phase 3 — Greenfield AI Pipeline

### Task 3.1 — Implement `askGreenfield`
**File:** `src/ai/claudeEnricher.ts` (or new `src/ai/greenfieldEnricher.ts`)  
**Action:**
- New export: `askGreenfield(params)` — question, history, apiKeyClaude
- No `rootPath`, no `retrieve_files`, no `retrieveFileSnippets`, no graph-matching tools
- System prompt: Lead Architect persona, design from scratch, use `create_node` and `connect`
- Structured output: answer + `graphCommand` (create_node, connect)
- Tools: only `answer` (with graphCommand); no `retrieve_files`, no `scaffold_node` (or gate scaffold behind "materialize" flow)
- Parse and return `{ answer, graphCommand }`
- **Prompt limits:** Max nodes (e.g. ≤ 20), keep modules focused
- **Safety guardrails:** Forbid executable secrets, shell commands, sensitive instructions in prompts
- **Post-process:** Strict JSON validation; if parse fails, return clarification message (single pass only)
- **Few-shot examples:** Include 1–2 examples of valid `create_node` / `connect` payloads

**Prompt outline:**
```
You are the Lead Software Architect.
There is no repository yet. Design the full architecture from scratch.

You must:
- Define layers (Presentation, Business Logic, Data Access, etc.)
- Define modules (≤ 20 nodes; keep modules focused)
- Use create_node and connect to draw the initial system on the canvas
- Provide folder structure recommendations
- Justify design decisions in your answer

ALWAYS use the answer tool with a graphCommand containing create_node and/or connect.

Do NOT include secrets, shell commands, or executable code in your design.

Do not include any actual file content which includes secrets. Only suggest file names and example skeletons.
```

### Task 3.2 — Implement `reviewGreenfieldAnswer`
**File:** `src/ai/critic.ts`  
**Action:**
- New export: `reviewGreenfieldAnswer(params)` — question, answer, graphCommand (proposed nodes/edges)
- No `graph` (or pass proposed nodes/edges as synthetic graph for coherence checks)
- Validation focus: coherence, not correctness against existing code
- **Deterministic checks (run first, before LLM):**
  - **Cycle detection:** Build graph from proposed nodes/edges; run topological sort or DFS cycle detection
  - **Layering rules:** Enforce allowed cross-layer edges (e.g. Presentation → Business Logic OK; Data Access → Presentation fail)
  - **Max nodes / depth limits:** Reject or flag designs exceeding thresholds (e.g. > 30 nodes, depth > 5)
  - **Cohesion/coupling heuristics:** Simple metrics (e.g. max edges per node, coupling score)
- **LLM check:** Use for semantic coherence (responsibilities, naming) when deterministic checks pass
- Return `CriticResult` in same shape: `{ approved, score, report, violations }`
- Violations reference proposed node IDs, not filesystem paths

### Task 3.3 — GraphCommand validation
**Files:** `src/ai/claudeEnricher.ts` or `src/ai/greenfieldEnricher.ts`, optionally `schemas/graphCommand.json`  
**Action:**
- Add strict validation for parsed `graphCommand` output
- Validate `create_node`: required fields (id, label, layer), valid layer enum, id format (no path traversal)
- Validate `connect`: fromId/toId must reference existing or proposed node IDs
- If validation fails, return structured error (not raw LLM output) and ask for clarification
- Consider JSON schema in `schemas/graphCommand.json` for shared validation (client + server)

### Task 3.4 — Add JSON schema files
**Files:** `schemas/graphCommand.json`, `schemas/managerResult.json`  
**Action:**
- Add `schemas/graphCommand.json` — formal JSON schema for create_node / connect / update_node (if supported)
- Add `schemas/managerResult.json` — schema for ManagerResult (answer, graphCommand, criticReport, criticScore, violations, traceId)
- Use for shared validation (server parse + optional client validation)
- Canonical node shape: id, label, layer, description, suggestedFiles[], suggestedFolderPath[]

### Task 3.5 — `validateGraphCommand` middleware
**File:** `webapp/server/src/middleware/` (or shared)  
**Action:**
- Add middleware that runs before processing a graphCommand
- Validates against schema; rejects with structured 400 if invalid
- Prevents malformed or malicious payloads from reaching manager

---

## Phase 4 — Integration & Safety

### Task 4.1 — Handle empty graph in shared code paths
**Action:**
- Ensure `runGreenfieldTask` never calls:
  - `routeQuestion` (or call it and handle empty `relevantNodeIds` safely)
  - `retrieveFileSnippets`
  - `retrieve_files` tool
  - Any code that assumes `graph.nodes.length > 0` or `rootPath` exists
- Pipeline isolation: only the orchestrator switches mode; `runGreenfieldTask` owns its entire pipeline

### Task 4.2 — Client verification
**File:** `webapp/client/src/App.tsx`  
**Action:**
- Confirm empty workspace (`graph.nodes.length === 0`) can send chat requests (no client-side block)
- Confirm `create_node` and `connect` graphCommands render as virtual nodes/edges on `ArchCanvas`
- Confirm `proposedNodes` / `proposedEdges` (or equivalent) display when graph is empty
- Add/verify loading and error UX for greenfield responses

### Task 4.3 — Client UX (edit, approve, diff, undo)
**Files:** `webapp/client/src/App.tsx`, `NodePopup.tsx`, `ArchCanvas.tsx`  
**Action (P1, implement when core flow is stable):**
- **Inspect / edit proposed nodes:** Let users rename nodes, change folder path, remove nodes before materialize
- **Approve per node/edge:** Granular approval (approve entire design or per-node)
- **Diff & preview:** Show proposed folder structure and example files before materialization
- **Undo / history:** Keep design snapshots and compare/diff UI
- **Progressive rendering:** Stream partial graph/answer or show "thinking" states

### Task 4.4 — Error handling strategy
**Files:** `src/ai/manager.ts`, `webapp/server/src/chat.ts`, client error UX  
**Action:**
- Define structured error types (validation, critic rejection, LLM parse failure, rate limit, etc.)
- Map to user-facing messages; never surface raw LLM output or stack traces
- Retry policy: single retry for transient failures; no retry for validation/parse errors
- Log errors with traceId for debugging

### Task 4.5 — Logging and observability
**Action:**
- Log `[manager] mode=greenfield` vs `[manager] mode=analysis` at start of each task
- Include `traceId` in all logs
- Ensure greenfield path is distinguishable in logs for debugging

### Task 4.6 — Metrics and alerting
**Files:** server metrics layer, optional dashboard  
**Action (P1):**
- **Metrics:** LLM latency, token usage per call, criticScore distribution, materialize success rate, nodes created
- **Alerting:** Abnormal cost or error rates
- **Dashboard:** Greenfield sessions vs analysis sessions (optional)

### Task 4.7 — Testing with mock LLM
**Files:** `tests/greenfield_manager.test.ts` (or equivalent)  
**Action:**
- **Unit tests:** Manager orchestrator switch, `runGreenfieldTask` branches
- **Integration tests:** Mock LLM that returns well-formed and malformed `graphCommand`; verify critic behavior and result shape
- **E2E (optional):** Client → server → mock LLM → proposed graph
- **Fuzz tests:** Malformed `graphCommand` payloads to ensure parser resilience

---

## Phase 5 — Optional / Later

### Task 5.1 — Mode interface (pluggable strategy)
**Action:**
- Define `interface ArchitectureMode { execute(params): Promise<ManagerResult> }`
- Implement `AnalysisMode`, `GreenfieldMode`
- Orchestrator: `modeRegistry[mode].execute(params)`
- Enables future modes (migration, security-audit, refactor) without touching orchestrator

### Task 5.2 — Materialize Architecture (Permissioned Construction Loop)

**Concept:** Mirror the chat approval pattern. Like "Critic: APPROVED" or "Run Skill" — the agent proposes, the user consents, then the system acts. The Materialize button is the "Yes" that turns AI talk into AI action.

**Flow (The "Heart" beats here):**
1. **Blueprint:** User asks "Design a SaaS." Claude uses `create_node` and `connect` to draw Ghost Nodes (dashed) on the canvas.
2. **Review:** Critic checks the blueprint. If messy, it tells Claude to fix it.
3. **Consent:** When the design is clean, show a button **in the chat**: "🏗️ Materialize this Architecture?"
4. **Construction:** User clicks "Yes" →
   - Client sends Ghost Node List (proposed nodes/edges) to server
   - Server runs a Construction Skill (specialized `save_skill` variant) — creates folders and index files on disk
   - System triggers automatic Re-scan
   - Ghost nodes turn Solid on the canvas
5. **Pulse:** The agent has "breathed life into an idea."

**Implementation:**
- Add "Materialize Architecture" button **inline in chat** when critic approves and design has virtual nodes (same UX pattern as critic report / action buttons)
- Server route: `POST /api/materialize` — accepts proposed nodes/edges + target `rootPath` (user must specify or pick workspace)
- Construction skill: `mkdir` folders (e.g. `src/api`, `src/services`), write `index.ts` stubs
- Re-scan after materialize so graph becomes real
- **Safety:** Auth/ACL, preview dry-run, conflict handling, path sanitization, audit log (see Cross-Cutting)

### Task 5.3 — Concurrency & long-running tasks (P1)
**Action:**
- If LLM or materialize can be long: use background jobs, return `taskId` with status polling or websocket
- Support **cancel** / **retry** and idempotency keys for materialize calls
- Good UX for long-running greenfield design requests

### Task 5.4 — Dev harness / fake Claude
**Files:** `src/ai/mockGreenfieldEnricher.ts` or test fixtures  
**Action:**
- Fake Claude that returns well-formed `graphCommand` for local dev (no API key required)
- Pluggable via env flag (e.g. `USE_MOCK_GREENFIELD=true`)
- Versioned test fixtures for deterministic E2E

### Task 5.5 — Governance & human-in-the-loop (P1)
**Action:**
- **Approval gates:** Require explicit user approval before materialization (or per-node approval)
- **Policy checks:** License/copyright disclaimers for generated boilerplate
- **Review flow:** Comments/votes on proposed designs (optional, multi-user)

### Task 5.6 — Design Template Library (P1)
**Action:**
- Save approved greenfield designs to a template library keyed by domain/pattern
- When user materializes successfully, persist nodes/edges/structure
- Librarian pulls relevant template for similar requests (e.g. "Medical App" → Health-Tech template)
- Stored in `.agent/design_templates.json` or DB

### Task 5.7 — User "reject and revise" in chat (P1)
**Action:**
- Add button "Ask again" or "Fix this" that sends feedback to agent (mirror critic retry flow)
- Explicit iterative refinement: user rejects → agent revises
- Same UX pattern as critic feedback loop

---

## Self-Evolving System (Evolution Beyond Greenfield)

**Concept:** The agent isn't just following static templates. It learns from successful designs and gains new capabilities over time.

### A. Design Librarian (Memory)
- **Current:** `recordSuccessfulRun` in `templateLibrary.ts` logs successful Q&A runs (intent, score, question sample) to `.agent/templates.json`
- **Gap:** Templates are not consumed for prompt selection; they're mostly logging
- **Evolution:** When user materializes a successful greenfield design, save that pattern to a **Design Template Library** keyed by domain/pattern (e.g. "Health-Tech App", "SaaS API")
- **Result:** Next time user asks for "Medical App," the Librarian pulls that template so the agent starts with a V2 design instead of V1

### B. Tool Creation for New Needs
- **Current:** Claude can `save_skill` to `.agent/skills/` and `skill_index.json` (project-local)
- **Evolution:** During greenfield design, Claude might realize "I don't have a tool for Express.js boilerplate" → uses Tool-Builder to write `generate-express-base` skill and save to Skill Library
- **Result:** Agent gains new powers; can scaffold Express apps for any future project without re-programming
- **Gap:** Greenfield has no `rootPath` — skills must live in a **Global Skill Library** or user-selected workspace

### C. Critic Evolution
- **Current:** Critic rules are static (LLM prompt + deterministic checks)
- **Evolution:** As critic reviews more designs, add rules to a **Critic Playbook** (e.g. "Auth was too tightly coupled in design X → add rule: always check Auth decoupling")
- **Result:** System becomes more opinionated and professional the more you use it
- **Gap:** No mechanism today to persist or evolve critic rules from past failures

### D. How Self-Evolving Works Today (Review & Refactor)
| Component | Self-Evolving? | How |
|-----------|----------------|-----|
| **Template Library** | Partial | `recordSuccessfulRun` stores intent + score + question; not yet used for prompt selection |
| **Skill Store** | Yes | Claude can `save_skill`; future turns use `run_skill` — agent gains new tools per project |
| **Critic** | No | Rules are static; feedback is fed to Claude for retries, but critic doesn't learn |
| **Greenfield** | Blocked | Empty graph rejected before agent runs — no design flow yet |

### E. How Self-Evolving Would Work with Writing Code (New Users)
1. **First design:** User asks "Design a blog." Agent proposes nodes (ghost). User approves. Materialize creates folders/files.
2. **Design Librarian:** System saves "blog" pattern (nodes, layers, structure) to template library.
3. **Next user:** Asks "Design a news site." Librarian matches "news site" → "blog" template; agent starts with blog structure, adapts.
4. **Tool evolution:** Agent needs "generate React component" → creates skill, saves to library. Future designs can use it.
5. **Critic evolution:** Past design failed (e.g. auth coupled to UI). Critic adds rule. Future designs are checked for that.

---

## Cross-Cutting Concerns

### Types & API Contracts
- **ManagerResult / CriticResult:** Ensure typed interfaces (answer, graphCommand, criticReport, criticScore, violations, traceId)
- **GraphCommand:** Keep existing union shape for compatibility; add validation layer
- **Id & node shape:** Canonical node spec (id, label, layer, description); id format validation (no path traversal)

### Security & Rate Limits
- **Input limits:** Max size for question + graph payloads (avoid huge LLM contexts)
- **Rate limits:** On LLM calls and (when added) materialize endpoints
- **Materialize:** Auth/ACL, path sanitization (see Task 5.2)

### Session & Persistence (design now, implement when needed)
- **GreenfieldSession table:** id, userId, createdAt, graphJson, status (draft | approved | materialized)
- **Resume:** Store proposed graph server-side keyed by sessionId/userId
- **Expiration:** Ephemeral sessions expire (e.g. 7 days) unless user saves
- **Draft lifecycle:** draft → approved → materialized
- **Concurrency:** Session locking or optimistic merging for multi-user

### Edge Cases (define explicitly)
| Case | Behavior |
|------|----------|
| Max nodes / edges | Reject or flag; e.g. > 30 nodes, > 100 edges |
| Internal vs external deps | Clarify how third-party services appear in design |
| Materialize into repo with uncommitted changes | Fail + instruct user to commit or stash |
| Naming collisions | Auto-suffix or fail with clear message |
| Nodes as code vs infra | Different materialize templates |

### Error Handling
- **Structured errors:** Validation, critic rejection, LLM parse failure, rate limit
- **User-facing:** Map to clear messages; never surface raw LLM output
- **Retry:** Single retry for transient; no retry for validation/parse
- **Logging:** All errors with traceId

### Governance & Human-in-the-Loop
- **Approval gates:** User must approve before materialize
- **Policy:** License/copyright disclaimers for generated code
- **Audit:** Who materialized what, when (see Task 5.2)

### Pluggable Prompt Registry (P2)
- Versioned, testable prompts for greenfield and analysis
- Enables prompt iteration without code churn

---

## Gaps in the Plan & What We Can Learn from AI Coding Assistants

**What AI assistants (e.g. Cursor) do well:**
1. **Preview before write:** User sees diff, approves, then file is written. No blind trust.
2. **Explicit consent:** Every file write is user-approved. Materialize should mirror this — button in chat, not auto-write.
3. **Iterative refinement:** User rejects → assistant revises. Plan has critic retry, but no explicit user "reject and ask again" in chat flow.
4. **Context persistence:** Assistant has full project context. Greenfield has no project yet — proposed graph is the context. Must carry across turns.
5. **Scaffold + patch:** Assistant can create new files or edit existing ones. Materialize is scaffold-only — no "patch existing module" in greenfield yet.
6. **Undo / rollback:** Assistants don't have it; platform doesn't either. For materialize, undo (revert materialization) is critical.
7. **Structured code output:** Assistants emit markdown code blocks. Platform uses `graphCommand` for structure. For materialize we need: node → folder path, file content (stub), not just node metadata.

**Gaps to address:**
| Gap | Priority | Action |
|-----|----------|--------|
| Materialize button in chat (not just canvas) | P0 | Add inline "🏗️ Materialize?" when critic approves + virtual nodes exist |
| Target rootPath for greenfield materialize | P0 | User must pick workspace or paste path; greenfield has no repo yet |
| Design Template Library (save approved designs) | P1 | New task: persist successful greenfield designs for reuse |
| Global Skill Library for greenfield | P1 | Skills are project-local; greenfield needs shared or user-selected root |
| Critic Playbook (evolve rules from failures) | P2 | New task: persist critic rules, add rules from past failures |
| Undo materialization | P1 | Add revert/rollback after materialize |
| User "reject and revise" in chat | P1 | Button "Ask again" or "Fix this" that sends feedback to agent |

---

## Summary Checklist

| #   | Task                                    | File(s)                    | Priority |
|-----|-----------------------------------------|----------------------------|----------|
| 1.1 | Add `AgentMode` type                    | `src/types.ts`             | P0       |
| 1.2 | Relax chat validation, add mode         | `webapp/server/src/chat.ts`| P0       |
| 1.3 | Backwards compatibility (mode default)  | `webapp/server/src/chat.ts`| P0       |
| 2.1 | Add mode param and orchestrator switch  | `src/ai/manager.ts`        | P0       |
| 2.2 | Extract `runAnalysisTask`               | `src/ai/manager.ts`        | P0       |
| 2.3 | Implement `runGreenfieldTask`           | `src/ai/manager.ts`        | P0       |
| 2.4 | Add `traceId` for observability         | `src/ai/manager.ts`, types | P1       |
| 3.1 | Implement `askGreenfield`               | `src/ai/claudeEnricher.ts` or new | P0 |
| 3.2 | Implement `reviewGreenfieldAnswer`      | `src/ai/critic.ts`         | P0       |
| 3.3 | GraphCommand validation                 | `src/ai/`, `schemas/`      | P0       |
| 3.4 | Add JSON schema files                   | `schemas/`                 | P0       |
| 3.5 | `validateGraphCommand` middleware       | `webapp/server/`           | P0       |
| 4.1 | Pipeline isolation (no shared greenfield leaks) | `src/ai/`            | P0       |
| 4.2 | Client verification                     | `webapp/client/src/App.tsx`| P1       |
| 4.3 | Client UX (edit, approve, diff, undo)   | `webapp/client/`           | P1       |
| 4.4 | Error handling strategy                 | manager, chat, client      | P0       |
| 4.5 | Logging                                 | `src/ai/manager.ts`        | P1       |
| 4.6 | Metrics and alerting                    | server                     | P1       |
| 4.7 | Testing with mock LLM                   | `tests/`                   | P0       |
| 5.1 | Mode interface (optional)               | `src/ai/`                  | P2       |
| 5.2 | Materialize Architecture (chat consent button) | server + client | P1       |
| 5.3 | Concurrency & long-running tasks        | server                     | P1       |
| 5.4 | Dev harness / fake Claude               | `src/ai/`, tests           | P1       |
| 5.5 | Governance & human-in-the-loop          | server + client            | P1       |
| 5.6 | Design Template Library (save approved designs) | `src/agent/`         | P1       |
| 5.7 | User "reject and revise" in chat        | `webapp/client/`           | P1       |

---

## Dependencies

```
1.1 (AgentMode) ──┬──► 1.2, 1.3 (chat.ts)
                  └──► 2.1, 2.2, 2.3 (manager)
2.1, 2.2, 2.3 ───────► 3.1 (askGreenfield)
2.3 ─────────────────► 3.2 (reviewGreenfieldAnswer)
2.4 ─────────────────► 4.5 (logging)
3.1 ─────────────────► 3.3, 3.4 (GraphCommand validation, schemas)
3.4 ─────────────────► 3.5 (validateGraphCommand middleware)
3.1, 3.2 ─────────────► 4.1 (integration)
4.1 ─────────────────► 4.2, 4.3 (client verification, UX)
4.1, 4.4 ─────────────► 4.5, 4.6 (logging, metrics)
4.1, 3.1, 3.2 ───────► 4.7 (tests)
5.4 ─────────────────► 4.7 (dev harness for tests)
```
