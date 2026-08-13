# Strategy doc pipeline — decided plan (Gate G)

**Status:** plan only — do not implement in the quant-cockpit Build.  
**Next user priority after subsystem cockpit ships.**

## Goal

Let a quant edit strategy thesis in an external editable document (e.g. Google Doc) so the trading agent can read it at runtime without diving into Express glue.

## 1. What already exists

### blanko (arch-visualizer)

| Area | Finding |
|---|---|
| Google Docs / Drive API | **None** found in server or client |
| Generic doc ingest | `.context.md` per module; agent writeContext; no remote doc sync |
| n8n | **Import path exists** (`webapp/server/src/n8n/mapper.ts`, fixtures, Landing import) — maps workflows → ArchGraph; does **not** execute n8n or sync Google Docs |
| File sync | Workspace clone under `~/.arch-viz/repos/`; rescan on webhook — not document-oriented |

### trading-agent

| Area | Finding |
|---|---|
| Strategy code | `middleware-platform/services/strategy/` (pead, fda-supply), `signal-engine.js`, `fda-client.js` |
| Layer status | `docs/trading/LAYER_STATUS.md` — human tracker, not live agent context |
| Google / Docs API | **None** in middleware-platform (no googleapis dependency for docs) |
| Knowledge ingest | `knowledge-ingest.js` / Pinecone paths — news/RAG oriented, not Google Doc thesis |

## 2. Options (tradeoffs)

| Approach | Effort | Pros | Cons |
|---|---|---|---|
| **A. Poll Google Docs API → `strategy_notes` table** | Medium | Simple, auditable versions, agent reads DB at turn start | Needs OAuth + cron; lag (1–5 min) |
| **B. Webhook (Apps Script / Drive push) → ingest** | Higher | Near-real-time | More moving parts; Apps Script ownership |
| **C. Manual export/import** (markdown drop into repo / blanko upload) | Lowest | No Google credentials | Quant friction; easy to go stale |
| **D. n8n: Google Docs → HTTP → agent** | Medium if n8n already ops | Reuses blanko’s n8n familiarity; little agent code | Requires running n8n; blanko only *imports* n8n graphs today — not a host |

## 3. n8n vs in-agent

blanko’s n8n support is **visualization/import**, not a runtime bus. Unless the team already runs n8n for other ops, **building Docs → n8n → agent is not less code** than a small poller in trading-agent or blanko.

**Decision for next Build:** **Option A — poll Google Docs into `strategy_notes`** (Postgres in trading-agent or shared Supabase), with:

1. Service account or OAuth refresh for one Doc ID (env `STRATEGY_DOC_ID`)
2. Table: `id`, `doc_id`, `revision`, `markdown`, `fetched_at`
3. Agent turn / `runStrategies` reads latest row as system context prefix
4. blanko Insights later: “thesis last synced …” (optional)

Defer B/D until A proves the quant workflow. Keep C as fallback (paste into `docs/trading/STRATEGY_THESIS.md` + rescan).

## 4. Explicit non-goals (this decision)

- No Google Docs implementation in the current cockpit Build  
- No n8n hosting inside blanko  
- Do not block canvas readiness work on this pipe
