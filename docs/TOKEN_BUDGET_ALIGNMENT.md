# Token Budget Alignment

## Model Limits

- **Claude Sonnet 4.6:** ~200K token context window
- **Safe cap:** 180K tokens (see `CONTEXT_WINDOW_SAFE` in `src/agent/tokenBudget.ts`)

## Budget Usage by Component

| Component | Budget | Purpose |
|-----------|--------|---------|
| **Main chat** (claudeEnricher) | 180K | Pre-send trim caps context at `CONTEXT_WINDOW_SAFE - 4K` reserve. Trims contextText if estimate exceeds. |
| **Rail context** (buildRailContext) | 100K default | Per-rail history digest; `getTokenBudget()` or passed budget. |
| **Extension gateChecker** | Configurable (default 100K) | Session-level limit; uses `ctx.tokenUsage` from bumpSessionUsage, not tokenBudget module. |

## Why Rail Uses 100K While Main Chat Uses 180K

- **Rail context** is a *subset* of the full prompt—only rail summary + session history. It's built by `buildRailContext` and injected into the system prompt. Keeping it at 100K leaves headroom for graph context, tools, and response.
- **Main chat** sends the full prompt (graph, memories, history, question). The 180K cap is the *total* safe limit for the entire request. Pre-send trim reduces contextText if the estimate exceeds it.

## Token Telemetry

- **Claude responses** include `usage.input_tokens` and `usage.output_tokens`.
- **Logging:** Set `METRICS_LOG=1` to log token usage per step.
- **model_traces:** `agent_prompt_tokens` and `agent_completion_tokens` stored per run (webapp).
- **UI warning:** When input tokens ≥ 144K (80% of 180K), chat panel shows "Context near limit" notice.
