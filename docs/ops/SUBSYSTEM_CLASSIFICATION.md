# Subsystem classification — trading-agent

**Target:** https://github.com/richiejeremiah/trading-agent  
**Scan clone:** `~/.arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170`  
**Status vocabulary (canvas):** `built` | `paper` | `stub` | `missing`  
(Design boards still use `planned` | `building` | `built`.)

## Scanner note (important)

The current ArchNode scan **collapses** `middleware-platform/services/**` into a **single mega-node** (`middleware-platform/services`). PEAD, FDA, policy, risk, broker, and market-data files therefore share one box. Classification may mark that node `unclassified` when multiple subsystems score highly. **Trading capability readiness** (below) still binds by **file path patterns** so the quant cockpit headers remain accurate.

**Placement convention for new strategies:**  
`middleware-platform/services/strategy/<name>.js` (or a dedicated folder under `services/strategy/`) so heuristics auto-classify into Strategy & reasoning when/if scan granularity improves.

## Ambiguities

| Node / path | Issue | Resolution |
|---|---|---|
| `middleware-platform/services` | Contains strategy + risk_execution + data_obs + ingress files | Prefer `unclassified` mega-module OR override via `.context.md` `subsystem:`; capabilities still listed under correct subsystems |
| `llm-router` / `trading-tool-executor` | Strategy vs ingress | Heuristic: **strategy** (medium confidence) |
| `fda-client` | Strategy signal vs data | Heuristic: **strategy** (with PEAD/FDA-shock) |
| `middleware-platform` (root) | server.js + DB | **ingress** (low) / often supporting shell |
| `utils` (langsmith) | Observability vs util | **data_obs** |

Override: add `subsystem: strategy` (etc.) to module `.context.md` frontmatter.

## Node inventory (latest scan)

| id | label | layer | kind | domain | tier | subsystem | confidence | reason |
|---|---|---|---|---|---|---|---|---|
| middleware-platform | Middleware Platform | Business Logic | module | users | supporting | ingress | high | matched server/middleware patterns |
| unified-dashboard/trading | Trading | Presentation | module | users | peripheral | ingress | high | trading-chat |
| middleware-platform/investment-agent | Investment Agent | Reasoning | module | users | peripheral | strategy | high | investment-agent |
| middleware-platform/middleware | Middleware | Business Logic | guardrail | users | peripheral | ingress | low | middleware/ |
| middleware-platform/migrations | Migrations | Business Logic | module | users | peripheral | unclassified | low | no rule |
| middleware-platform/routes | Routes | Memory | module | users | peripheral | ingress | high | routes + trading-chat |
| middleware-platform/scripts | Scripts | Business Logic | module | users | peripheral | unclassified | low | no rule |
| middleware-platform/services | Services | Reasoning | agent | users | supporting | unclassified* | low | multi-subsystem mega-module |
| middleware-platform/utils | Utils | Business Logic | module | users | peripheral | data_obs | high | langsmith |
| .github/workflows | Workflows | Orchestration | infra | users | peripheral | unclassified | low | no rule |

\*See scanner note. Raw dump: [`_subsystem_nodes.json`](_subsystem_nodes.json).

## Trading capability map (quant readiness)

Aligned with `docs/trading/LAYER_STATUS.md` in trading-agent. Used for **region headers** and sequence strip — not agent-layer badges.

| Capability | Subsystem | File patterns | Status |
|---|---|---|---|
| Identity | ingress | identity-service, telegram-auth | built |
| Telegram wallet | ingress | telegram-paper, paper-wallet, wallet-service | paper |
| Trading chat API | ingress | trading-chat, execute-turn | stub |
| PEAD | strategy | services/strategy/pead, pead.js | paper |
| FDA-shock | strategy | services/strategy/fda-supply, fda-client | paper |
| Signal engine | strategy | signal-engine | paper |
| Policy | risk_execution | services/policy/, policy-engine | built |
| Risk | risk_execution | services/risk/, risk-engine | built |
| Paper execution | risk_execution | services/execution/, paper-broker, execution-service | paper |
| Alpaca live | risk_execution | services/broker/alpaca, AlpacaBroker | stub |
| Market data | data_obs | market-data | paper |
| Scheduler | data_obs | scheduler | missing |

## Hybrid assignment

1. `.context.md` `subsystem:` override (highest)  
2. Path/file heuristics (`subsystemClassify`)  
3. Else `unclassified`

Code: `src/analyzer/subsystemClassify.ts`, `webapp/client/src/subsystemClassify.ts`, wired via enricher + `buildSystemModel`.
