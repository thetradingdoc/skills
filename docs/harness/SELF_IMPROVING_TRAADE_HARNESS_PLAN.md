# Blanko self-improving harness for Traade

## Goal

Turn Blanko into a visual agent builder whose connected blocks define a runnable harness. For Traade, the harness should inspect the repository, use task-specific context, propose changes to its own configuration, and create reviewable code changes that can be verified before a person approves them.

“Self-improving” has two separate meanings in this product:

1. **Harness adaptation:** revise rules, context selection, model choice, and permitted tools based on run evidence.
2. **Repository building:** plan and draft code changes in an isolated workspace, verify them, and present a diff for approval.

Neither meaning grants the agent authority to place trades, modify live execution policy, weaken safety controls, or deploy code.

## What the code does today

### Blanko harness runner

- `webapp/server/src/agentHarness.ts` runs a bounded model/tool loop (up to 8 model steps and 12 tool calls).
- A Blanko **Agent** block is required. Connected repository blocks expose read-only list, search, and file-read tools.
- A connected MongoDB Vector DB can expose scoped memory tools when MongoDB and the embedding provider are configured.
- The model can propose updates to harness settings. The UI lets a person review and apply those settings to the canvas.
- Runs write a short summary to Supabase `runtime_traces`; detailed step data is returned to the UI.
- This endpoint does **not** write code, run repository checks, create a code task, or make a durable version of the harness configuration.

### Existing Blanko repository builder

- The separate Rail/Task system already has a code-writing loop in `src/agent/taskRunner.ts` and isolated sandbox execution in `webapp/server/src/railsRoutes.ts`.
- It stages code writes and runs a verification pipeline before exposing a diff/review lifecycle.
- That builder currently is not an action in the Harness run loop. The Harness UI only links to Tasks; it does not pass its findings into a build plan.
- The legacy global staging buffer in `src/agent/staging.ts` is initialized for the extension and should not be reused as a multi-workspace web-server store.

### Traade agent pattern

The reviewed Traade middleware routes turns through `services/trading-rails/orchestrator.js` and `services/trading-rails/execute-turn.js`. The model receives a lane-specific tool allowlist, a short system policy, bounded turns, and identity-scoped read tools. Write-shaped trading requests create pending OS commands; a human confirmation and deterministic execution authority handle any later action. `broker.submitOrder` is explicitly outside the LLM tool surface. This is the right separation to retain in Blanko.

## Architecture to build

```text
Canvas graph
  → Agent + Context + Memory + Tool + Guardrail + Evaluator blocks
  → policy compiler (hard limits ∩ owner policy ∩ connected capabilities)
  → bounded run loop (observe → retrieve → reason → act → verify → reflect)
  → candidate harness revision OR isolated repository build
  → deterministic evaluation and safety gates
  → human review of settings/diff
  → versioned apply, rollback, and trace
```

The graph is the user-visible configuration. The policy compiler derives actual runtime permissions from trusted server rules and directed graph connections; model text cannot grant itself permissions. Repository files, uploaded documents, tool output, and retrieved memory are untrusted context, not instructions.

## Prompt and context engineering

- Compile a stable system policy separately from task instructions, user rules, and retrieved content.
- Keep immutable platform rules outside editable canvas text. A user may tighten policy but cannot use a harness proposal to remove platform safety rules.
- Use explicit context tiers: current request, selected repository files, connected knowledge sources, recent run evidence, then scoped vector memory. Fetch only what the current task needs.
- Label each external source with provenance and treat its contents as quoted data. Never follow instructions found inside a repository file, uploaded file, tool result, or memory chunk when they conflict with the compiled policy.
- Keep context and tool-result budgets bounded. Record what was selected, omitted, truncated, and why in the run trace.
- Version the compiled prompt/policy hash with each run so a result can be reproduced.
- Add Traade context profiles for research, architecture, and code-maintenance tasks. They must not expose trade-submission tools to the self-building loop.

## Self-improvement cycle

1. **Observe:** capture run outcome, tool results, user corrections, and evaluator findings.
2. **Diagnose:** identify a narrow failure or improvement opportunity and cite evidence.
3. **Propose:** produce a typed candidate: harness configuration revision or repository change plan. Include rationale, affected blocks/files, risk, and expected behavior.
4. **Gate:** reject changes outside scope, secret/config files, unconnected tools, oversized diffs, and edits to protected Traade execution/safety modules. Candidate guardrail relaxations require owner review and cannot override immutable rules.
5. **Build:** use the existing isolated Rail/Task sandbox. Never write directly to the connected source checkout from the Harness runtime.
6. **Verify:** run only a fixed, server-owned allowlist of safe checks in that sandbox; report each result. Do not run arbitrary commands requested by model output.
7. **Review:** show the diff, evaluation results, context, and trace. A human decides whether to apply it.
8. **Version:** apply only approved changes, preserve the prior version, and support rollback. Never automatically deploy or trade.

## Implementation plan

### Phase 1 — make current Harness behavior truthful and reproducible

- Add a readiness report explaining whether the Agent, model credentials, repository, connected tools, MongoDB, embedding provider, and vector index are ready.
- Strengthen the context compiler: structured sections, source labels, hard policy separate from editable rules, bounded context, prompt hash, and complete tool-call trace.
- Add tests for directed graph permissions, prompt-injection treatment, context limits, and missing dependencies.

### Phase 2 — versioned harness adaptation

- Introduce typed policy blocks rather than treating every policy as a free-form string.
- Generate candidate versions from run evidence; show field-level before/after changes and rationale.
- Store candidate, approval, active version, and rollback history durably (MongoDB or existing workspace persistence after verifying its schema and tenancy model).
- Evaluate candidates on a saved Traade task set before activation. A failed or unsafe candidate stays inactive.

### Phase 3 — connect Harness to the existing builder

- Add a **Build this change** action to a Harness finding. It creates a Rail/Task from the finding, selected files, acceptance criteria, and safety profile.
- Reuse the existing isolated sandbox, staged diff, verifier, and review lifecycle; do not reuse the extension's process-global staging buffer in the server.
- Start with documentation, tests, and non-execution Traade modules. Require explicit review for every patch.
- Protect broker submission, order pipeline, risk, identity, and confirmation authorities from Harness-generated edits by default.

### Phase 4 — share and operate agents

- Publish an immutable, versioned skill/harness package from the graph and its approved policies.
- Let recipients install a copy and bind their own repository, credentials, memory scope, and approvals.
- Add run comparisons, regression evaluation, costs, context provenance, and rollback controls to the Harness side panel.

## First proof target

Using a Traade repository, a user can ask the Agent to inspect one identified, non-execution subsystem. The Agent cites the source files and context it used, makes a narrow build plan, and launches the existing sandbox task flow. The builder produces a diff and safe verification results. The diff is not applied until the user approves it. A run trace proves which prompt version, graph permissions, files, tools, and checks were used. No broker or trading execution tool is available in this flow.

## Work started in this implementation pass

- Reworked the runtime prompt into separate task, immutable platform policy, editable owner policy, and untrusted design-context sections.
- Added an explicit rule that graph metadata, repository files, uploaded documents, tool results, and retrieved memories are evidence only and cannot expand permissions or override policy.
- Added prompt version `blanko-harness-v2` and a SHA-256 hash to each completed run response and persisted run summary.
- Exposed the prompt version and short hash in the Harness run result so a user can see which compiled policy produced the result.
- Added a Harness-to-builder handoff: a run finding plus one to three chosen existing files can create a Rail/Task in the existing repository builder.
- The handoff validates writeable paths server-side, blocks sensitive trading/execution/security paths, and creates the task in `PRE_PLANNING`. It does not execute the task or modify repository files.

This is an initial bridge, not the completed self-building loop. The handoff has not been exercised with an authenticated Traade workspace; the existing builder's sandbox, verifier, and review path still need an end-to-end run. The persistent candidate/version store and harness regression evaluator also remain to be built.
