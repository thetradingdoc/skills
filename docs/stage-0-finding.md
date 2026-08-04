# Stage 0 — did the ten-layer view earn itself?

**3 August 2026.** The gate was: does a ten-layer view say more than the
findings dashboard, and if not, stop.

## The answer

**Neither replace nor sit beside — the view already existed.**

The Layers tab has been in this tool for some time. It assesses eleven layers
per agent, detected rather than declared, traced along the request path:
Ingress, Context, Reasoning, Tools, Memory, Knowledge, Data, Safety,
Observability, Evaluation, Deployment.

A day was spent building a second one. It should have started with looking.

## What stage 0 did establish

Worth more than the tab. Against `execute-turn.js`, the existing view reports
five layers as absent. **Four of those five are wrong**, verified against the
import graph rather than asserted:

| Layer | Reported | Actually |
|---|---|---|
| Memory | no session or history stores | `priorMessages()` calls `listTradingHistory` on every turn, in the agent file itself |
| Safety | no moderation or guardrails found | `assertCaller` is called by `executeTurn`; tool arguments are clamped in the executor |
| Evaluation | no harness invokes this agent | `scripts/agent-tests.js` requires `execute-turn` and asserts on its behaviour |
| Observability | no tracing on this path | `policy_decision` records every guard decision — though reached from the signal engine, not the agent |
| Knowledge | no vector or RAG client | correct: `vector-retriever.js` exists and nothing on this path imports it |

Run `node scripts/verify-absences.js` in the trading-agent repo to reproduce.

## Two different faults, worth separating

**Detection.** Memory and Evaluation are wrong outright. The history read is in
the agent file; the test harness imports the agent directly. Neither needed a
graph walk to find.

**Scope.** Safety and Observability are accurate about the agent and misleading
about the system. `policy.js` genuinely is not on `execute-turn`'s path — it is
on the signal engine's. The tool says "searched this agent's path" in the
detail and "Layers" in the header, and a reader takes the header to mean the
system.

That ambiguity is a design question rather than a bug: **is a layer a property
of an agent or of a system?** Both are useful. They are not the same view, and
one is currently labelled as the other.

## The pattern, for the fifth time

Every detection fault found today has the same shape: a check looks for one
thing in one place and reports its absence as a fact about the system.

- Agent detection wanted the SDK import and the tool loop in one file
- Auth detection matched six framework helpers against one file
- Reach tracing followed `this.method()` and one hardcoded class name
- SQL was recognised in backticks only
- Money meant payment rails, not held balances

And now: layer detection searching one agent's path and reporting "none found"
as "none exists".

**The better-factored the code, the more the tool reports as missing.** That is
the finding worth carrying into whatever gets built next.

## What was kept

- `architecture.layers.json` in the trading-agent repo — a hand-written
  per-system assessment, useful if the scope question is answered that way
- `GET /api/layers` — the route that serves it
- `scripts/verify-absences.js` — reproduces the four wrong absences
- This note

## What was removed

The duplicate tab. Two tabs called Layers is worse than one imperfect one.

## What stage 1 should be, given this

Not the detectors from the original plan. Instead:

1. **Fix Memory and Evaluation detection** — both are one-file reads away
2. **Decide the scope question** and label the view accordingly
3. **Then** consider whether a per-system view is a separate tab

The original plan had six stages of new building. The finding is that most of
it exists and is wrong in a way that is cheaper to fix than to rebuild.
