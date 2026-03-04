# Arch Visualizer — Execution Plan v1

**What this is:** The build sequence to turn the current scaffolding into a working agent that acts as a staff engineer across frontend, backend, LLM, and DevOps. Based on AGENT_ROADMAP v4.1 and the current codebase state.

**Current state:** Planning UI works. Trace logger works. Staging, commit, reject are wired. Plan approval now triggers: read_file → LLM → write_file (staged) → Diff Preview. Session restore fixed.

---

## Phase 0 — Prove the Wiring ✓

- `toolExecutor.ts` with `read_file`
- `taskRunner.ts` with `runFirstTask`
- Extension wires plan approval to `runFirstTask`
- Trace entries visible in panel

## Phase 1 — First LLM Call ✓

- `llmClient.ts` — `callLLM` for Code Writer
- taskRunner calls LLM after read_file
- Parses tool_call (write_file), executes it
- Emits llm_call trace

## Phase 2 — Complete One Task ✓

- `write_file` in toolExecutor → staging
- agentStagingEntries sent after write
- Session save on plan approve
- agentSessionRestore: load session, restore pendingPlan, send staging (no delete)

## Phase 3 — Full Loop + Error Routing (Partial)

- `run_lint`, `run_vitest` in toolExecutor
- classifyFailure, retry limits, multi-task loop: roadmap spec, to be wired

---

## Immediate Next Actions

| Action | Status |
|--------|--------|
| Add llm_reasoning to TraceStepType | ✓ |
| toolExecutor read_file | ✓ |
| taskRunner runFirstTask | ✓ |
| toolExecutor write_file, run_lint, run_vitest | ✓ |
| llmClient callLLM | ✓ |
| Session restore fix | ✓ |
| Wire runFirstTask with LLM + staging | ✓ |

---

*Execution Plan v1 — Phase 0–2 implemented. Phase 3 (full loop, classifyFailure, retry limits) partially scaffolded.*
