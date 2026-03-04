# Arch Visualizer – Unified Heart TODO

This file tracks the work to build the “Visual Construction” and “Live Heart” bridges: visual design ↔ execution ↔ Jira.

## Phase 0 – Groundwork (IDs & config)

- [ ] **Define `archNodeId` contract**
  - [ ] Decide canonical format (e.g. `routes/auth`, `services/cache`, `ui/dashboard`).
  - [x] Add `archNodeId: string` to `ArchNode` in `src/types.ts` and propagate into scanner output.
  - [x] Ensure `scripts/scan-repo.ts` (and any other scanners) populate `archNodeId` deterministically from path/module type.
  - [ ] Document the ID convention in `README.md`.

- [ ] **Plumbing for external systems**
  - [ ] Add config for Jira (base URL, project key, auth) and telemetry (log path / OTLP endpoint).
  - [ ] Extend `.env` and server config types to carry these settings.

## Phase 1 – ID Decorator Skill (retrofit existing repos)

- [ ] **Implement `id-decorator` skill**
  - [ ] Define a `SkillMeta` entry for `id-decorator` in `skill_index.json`.
  - [x] Implement a script/skill that:
    - [ ] Walks the repo from `projectRoot`.
    - [ ] For each file belonging to an `ArchNode`, inserts/updates a header comment like `// @archNodeId: routes/auth`.
  - [ ] Make it idempotent (safe to re-run).
  - [ ] Save via `save_skill` and verify `run_skill id-decorator` works.

- [ ] **Wire `archNodeId` into logs & Jira**
  - [ ] Define a logger helper that always logs `archNodeId` (or derives it from the file comment).
  - [ ] Define Jira label/field convention: `archNodeId=<id>`.
  - [ ] Add a helper/skill that, given an `ArchNode`, can generate logger context and Jira labels.

## Phase 2 – GraphCommand extensions & Ghost Nodes (Visual Construction)

- [x] **Extend `GraphCommand` model (backend)**
  - [x] In `src/types.ts`, add:
    - [x] `create_node` command (e.g. `{ id, label, layer, isVirtual, archNodeId? }`).
    - [x] `connect` command (e.g. `{ fromId, toId, type }`).
    - [x] `trace_path` command (e.g. `{ nodeIds: string[], intensity?: number }`).
  - [x] Update `claudeEnricher.ts` `parseGraphCommand` to handle new actions.

- [x] **Extend `GraphCommand` model (webapp client)**
  - [x] Mirror the extended union in `webapp/client/src/types.ts`.
  - [x] Ensure `App.tsx` passes new `graphCommand` shapes through to `ArchCanvas`.

- [ ] **Ghost Node rendering in `ArchCanvas`**
  - [ ] Extend the canvas node model to include `isVirtual?: boolean`.
  - [ ] Render virtual nodes with dashed borders / distinct styling.
  - [ ] On `create_node` commands, add temporary nodes with `isVirtual: true`.
  - [ ] On `connect` commands, add temporary edges (dashed or tinted).

- [ ] **Ghost Node confirmation UX**
  - [ ] Add a panel/section listing “Proposed nodes” (virtual nodes).
  - [ ] Provide **Confirm** / **Discard** actions per virtual node.
  - [ ] On **Confirm**:
    - [ ] Call backend (or `run_skill`) to invoke the Scaffold Skill for that node definition.
    - [ ] Trigger a repo re-scan and refresh the graph so virtual nodes become “solid”.
  - [ ] On **Discard**:
    - [ ] Remove the virtual node/edges from client state (no code changes).

## Phase 3 – Scaffold Skill (“Materializer”)

- [ ] **Design the Scaffold Node contract**
  - [ ] Define TS type for a node definition: `{ archNodeId, path, layer, kind, template? }`.
  - [ ] Document mapping rules from definition → folder/files.

- [ ] **Implement `scaffold-node` skill**
  - [ ] Implement a script/skill that:
    - [ ] Creates directories (e.g. `services/cache`).
    - [ ] Creates starter files (`index.ts`, `README.md`, test stub).
    - [ ] Writes the `// @archNodeId: ...` comment.
  - [ ] Save as a Skill via `save_skill`.
  - [ ] Integrate with the manager via a `scaffold_node` tool that wraps `run_skill scaffold-node`.

- [ ] **Manager + Architect integration**
  - [ ] In `claudeEnricher.ts`, teach the agent to:
    - [ ] Emit `create_node` when the user requests a new module.
    - [ ] Propose `scaffold_node` after user confirmation.
  - [ ] In `manager.ts`, add logic so that:
    - [ ] When UI confirms a virtual node, it calls the `scaffold_node` tool.
    - [ ] It triggers or coordinates a repository re-scan and graph refresh.

## Phase 4 – Telemetry Skill & `trace_path` (Pulse Bridge)

- [x] **Telemetry Skill implementation**
  - [x] Implement `telemetry-tail` skill that:
    - [x] Tails structured logs or queries traces for a given `requestId` or route.
    - [x] Extracts a sequence of `archNodeId`s from log fields.
  - [x] Map each hop to `ArchNode.id` via `archNodeId`.

- [x] **`trace_path` backend integration**
  - [x] Extend `GraphCommand` to include `trace_path` (if not already done).
  - [x] In `claudeEnricher`, add a telemetry tool description and prompt rules:
    - [x] For runtime flow questions, call telemetry tool and emit `trace_path`.
  - [ ] In `manager.ts`, when a runtime flow is requested, prefer telemetry + `trace_path`.

- [x] **`trace_path` UI animation**
  - [x] In `ArchCanvas`, handle `trace_path` commands:
    - [x] Highlight edges along the path (increased opacity/width).
    - [ ] Add CSS keyframe animation (flowing gradient) along those edges.
    - [ ] Optionally add a legend entry: “Active trace path”.

## Phase 5 – Jira Skills & Fix-or-Track Protocol (Issue Bridge)

- [x] **Jira Skills**
  - [x] Implement tools/skills:
    - [x] `jira_search` (by `archNodeId`, repo, status).
    - [x] `jira_create` (summary, description, `archNodeId`, severity).
    - [ ] `jira_watch` or polling helper for a Jira ID.
  - [x] Ensure they accept/emit enough context (graph node info, findings).

- [ ] **Manager’s Fix-or-Track protocol**
  - [ ] In `manager.ts`, after Critic identifies a violation:
    - [ ] Detect architectural violations (drift/layer issues).
    - [ ] Ask the user: “Fix now or track (create Jira)?”
  - [ ] If user says **Fix**:
    - [ ] Ask architect to propose a refactor plan (possibly scaffold new modules or move code).
  - [ ] If user says **Track**:
    - [ ] Call `jira_create` with `archNodeId`, node description, and findings/critic issues.
    - [ ] Store Jira key on the node (e.g. in `ArchNode.jiraIssues[]`).

- [ ] **Jira overlay in UI**
  - [ ] Extend `ArchNode` to include `jiraIssues[]` (key, status, type, severity).
  - [ ] Display a Jira badge on nodes with open issues (count + severity hint).
  - [ ] Add filters such as “Highlight nodes with open critical Jira issues”.

## Phase 6 – From-Scratch Design Workflow (Greenfield Mode) — IN PROGRESS

- [x] **Greenfield execution mode (implemented)**
  - [x] Add `AgentMode` type ("analysis" | "greenfield") in `src/types.ts`
  - [x] Relax chat validation: allow empty graph; detect mode from `graph.nodes.length === 0`
  - [x] Add orchestrator switch in `manager.ts`: `runAnalysisTask` vs `runGreenfieldTask`
  - [x] Implement `askGreenfield` in `src/ai/greenfieldEnricher.ts`
  - [x] Implement `reviewGreenfieldAnswer` in `critic.ts` (deterministic + LLM coherence)
  - [x] Wire chat route and extension to pass `mode` and `rootPath`

- [ ] **Greenfield UX & materialize**
  - [ ] Confirm empty workspace can send chat requests
  - [ ] Confirm `create_node` / `connect` render as virtual nodes
  - [ ] Add "Materialize this Architecture?" button in chat
  - [ ] Wire materialize to `POST /api/materialize` or `scaffold_node`

- [ ] **New project bootstrap flow**
  - [ ] Add a “Start new architecture” mode in the webapp:
    - [ ] If no repo yet, allow prompts like “Design a new payments system.”
    - [ ] Architect emits `create_node` and `connect` commands to sketch a draft graph.
  - [ ] Let the user confirm a subset of nodes and trigger the Scaffold Skill to materialize them.

- [ ] **Iterative design/update loop**
  - [ ] Ensure:
    - [ ] Every new file gets an `archNodeId` via the Scaffold Skill.
    - [ ] Runtime and Jira enrichment runs on each scan.
    - [ ] Manager uses telemetry + Jira + findings to answer:
      - [ ] “Is this module healthy?”
      - [ ] “Where are the biggest risks?”
      - [ ] “Show me the live path for X.”

