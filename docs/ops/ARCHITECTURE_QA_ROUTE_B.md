# Architecture Q&A — Trading Assistant + Route B

**Date:** 2026-08-08  
**Scope:** Answers from the **current** codebase (trading-agent `middleware-platform` + Blanko spine docs), not aspirational design.  
**Runtime root:** `~/.arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170/middleware-platform`  
**Analysis method:** Multi-agent read of strategy, rails, risk, provenance, broker, and ops docs.

Legend:

- **FACT** — implemented and observable in code/artifacts  
- **DOC** — documented policy / prereg / BUILD_PROGRESS  
- **GAP** — asked for by this review; not implemented or not specified  
- **UNKNOWN** — cannot be established from files read  

---

## Headline: What is Route B?

**Route B is a research / sandbox experiment inside the trading assistant — not production decision architecture.**

| Question | Answer |
|----------|--------|
| Does Route B change what can size paper/live capital? | **No.** `pead_mode` stays `research_only`; paper sizing still requires `mode=paper` **and** `l0d_result=pass` **and** human-gated mode flips. |
| Does a Route B metric “pass” promote PEAD? | **No** (hard rule + runner finalize always leaves `mode=research_only` even on pass). |
| What is Route B for? | Light up L0-D ingest → score → artifact pipeline on free-tier FMP **surrogate** (`low_surrogate` / `restated_non_pit`) data; prove sample-size math and plumbing — **not** clear L0-A. |
| Production PEAD path today | Deterministic `SUE_ts` → `PROPOSED_ACTION` → policy/risk/execution; chat LLM may **call** `generate_signal` (selectors only) but does **not** compute SUE or submit orders. |

---

## 1. System boundary

### What is the trading assistant responsible for?

**FACT — hybrid, layered:**

| Role | Status |
|------|--------|
| Research assistant (chat / Telegram) | **Yes** — propose-only tools, quotes, history |
| Signal generator (PEAD / FDA strategies) | **Yes** — deterministic strategy modules + `generate_signal` thin reader |
| Portfolio manager | **Partial** — paper portfolio/history tools; no full multi-strategy PM allocator |
| Execution system | **Partial** — paper broker + policy/risk/execution spine; Alpaca **NOT_WIRED**; live forbidden without Live-0 human |

### Recommend vs approve vs execute

| Action | Component |
|--------|-----------|
| **Recommend / draft** | Strategy engines (`pead.js`, `fda-supply.js`) and/or LLM tool `generate_signal` → `PROPOSED_ACTION` |
| **Approve (ALLOW / REJECT / REQUIRE_HUMAN)** | `policy-engine` + `risk-engine` + eligibility / paper-size gates |
| **Final authority for execution** | `execution-service.executeProposedAction` → `getBroker().submitOrder` **only if** decision is `ALLOW` — **never** the LLM turn loop |

### LLM hard bounds (FACT)

| Can LLM…? | Answer |
|-----------|--------|
| Directly generate an executable broker order? | **No** — propose-only allowlists; `propose-only-guard` blocks `submit\|broker\|alpaca_order` |
| Modify deterministic strategy parameters (actual/consensus/stdev/sue_ts/size)? | **No** — `sanitizeGenerateSignalArgs` selectors only |
| Modify risk limits / kill switch / envelopes? | **No** — env/ctx only; no tool |
| Modify the universe? | **No** — no LLM write path to watchlist/prereg |
| Override a hard stop (`KILL_SWITCH`, `research_only`, Live-0)? | **No** |
| Flip `pead_mode` / `fda_mode` to live? | **No** — writers throw `*_MODE_LIVE_FORBIDDEN` |

### Human approval vs autonomous

| Requires explicit human | Autonomous today (within paper/research) |
|-------------------------|------------------------------------------|
| Enable `mode=live` (Live-0 checklist + `human_live_enable_confirmed`) | Chat/Telegram research replies |
| Flip `pead_mode` out of `research_only` toward paper after L0-D review | Scheduler PEAD cycle **skips** while research_only |
| Live broker enable | `generate_signal` → proposals (no submit) |
| Route B / L0-D interpretation of surrogate results | Paper fills only if ALLOW **and** paper sizing allowed (currently blocked) |

### Research vs production isolation

| Mechanism | Status |
|-----------|--------|
| Propose-only LLM lane | **FACT** |
| `pead_mode` / `fda_mode` | **FACT** — both `research_only` |
| Route B plan: `TRADING_DB_PATH` sandbox | **DOC/PLAN** — supported by `database.js`; Option B used default DB for earnings upsert (isolation not fully enforced in last run) |
| Separate research credentials / broker | **GAP** — paper refuses live; Alpaca stub always `NOT_WIRED` |

---

## 2. Strategy architecture (PEAD)

### Mathematical definition (FACT)

```
SUE_ts = (actual_eps − consensus_eps) / σ_hist
σ_hist = sample stdev (n−1) of prior surprises, winsorized 1st/99th
ε floor: max(σ_hist, 0.01)
```

Source: `services/strategy/sue-ts.js` (L0-C).

### Signal basis

| Factor | Used? |
|--------|-------|
| Raw EPS surprise | Via SUE numerator |
| SUE (standardized) | **Yes — primary** |
| Revenue surprise | **No** (v1 EPS-only) |
| Multiple factors | **No** |

### Propose rule (`pead.js`)

- Propose if `|SUE_ts| ≥ threshold` (default **1.0**, env `PEAD_SURPRISE_THRESHOLD`)
- `sue_ts > 0` → buy / `open_long`; else sell / `open_short`
- Sector σ: may compute; **does not propose** unless `allowSectorPropose` (default false)
- Default notional **5000** (`PEAD_DEFAULT_NOTIONAL`)

### What is an earnings event?

**FACT — DB identity:** `(ticker, fiscal_year, fiscal_quarter)` in `earnings_event`, with optional `announcement_at`.  
Derived `earnings_surprise_event` stores SUE + lineage.  
**GAP:** no first-class distinction of preliminary vs final vs amended filing as separate event types.

### Timestamps

| Concept | Code |
|---------|------|
| Event time for SUE / L0-D | `announcement_at` |
| Consensus usability | `as_of` and `known_at` (`:= captured_at`) **before** announcement |
| Actual usability | `as_of >= announcement_at` |
| BMO / AMC / RTH | **GAP** — no session-phase model |
| First tradable price after announcement | **L0-D panel only:** next EOD session after date → +5 trading days (`build-surrogate-l0d-panel.js`) |
| Production entry price | **GAP** — not defined on propose path |

### Holding / invalidation / exit (FACT vs GAP)

| Question | Answer |
|----------|--------|
| Holding period | **5 days** in L0-D prereg/panel only |
| Production hold / exit rules | **GAP** — not on `proposeFromEarnings` |
| Stop-loss / take-profit | **GAP** for PEAD (trade-service has generic stop/target for lifecycle scoring, separate path) |
| Time-based exit | L0-D: 5d; production: **GAP** |
| What invalidates a signal | Eligibility false (lineage, sector σ, borrow, kill, research_only); L0-D skips; print-window skips |
| Position size | Default 5000; Contract N envelopes + healthcare sector clamp; paper gated |
| Multi-strategy conflict | **GAP** — no portfolio conflict resolver; FDA is separate strategy module |
| Override existing PEAD position | **GAP** |

---

## 3. The SUE problem (highest technical risk)

### Formula & history (FACT)

- Formula: above  
- σ from **prior** company surprises only (`announcement_at < current`)  
- Min **8** ticker observations for `stdev_method=ticker`  
- Per-company (ticker) σ; sector σ is fallback for display, **never** `execution_eligible` in v1  
- Fiscal quarters: event keyed by FY/FQ; **GAP** on fiscal-calendar changes  
- Restatements / GAAP vs adjusted: **GAP** — FMP fields taken as given; no accounting-basis check  
- Same-definition guarantee for actual vs estimate: **UNKNOWN** (vendor-dependent)

### Did the estimate exist before the announcement?

| Question | Honest answer |
|----------|----------------|
| Code invariant | Requires `consensus.as_of` and `known_at` **before** `announcement_at` |
| FMP free historical | **Cannot** prove true pre-print consensus (Phase 1: current-state / single-point) |
| Option B | Fabricates `as_of = announcement − 1d` → **shape-valid, truth-invalid for PIT** |
| Accidental use of today’s reconstructed estimate? | **Yes, risk** — documented as `restated_non_pit` / `low_surrogate` |
| Stale / missing consensus | Print-window / ops-skips + provider_conflict; empty → skip |
| 1–2 history points | Skip `missing_stdev` (need ≥8 for ticker) |
| Consensus change immediately pre-release | **GAP** without revision ledger |
| Fallback when true PIT unavailable | **research_only** + surrogate labeled panels for plumbing only; **do not** clear L0-A |

**Route B itself does not fix SUE PIT.** Expanding free-tier symbols only increases sample size of the **same surrogate class**.

---

## 4. Point-in-time data integrity

| Capability | Status |
|------------|--------|
| “What did the agent know at T?” | **Partial** — PIT helpers exist; store not fully populated with honest vendor PIT |
| `as_of` / `captured_at` / `known_at` on observations | **FACT** on `provider_observation` |
| Distinct `observed_at` / `effective_at` / `source_timestamp` / `ingested_at` | **Partial naming** — mapped to as_of/captured/known; not four independent columns |
| Overwrite / version vendor corrections | **GAP** — `INSERT OR REPLACE` on observations by unique key; not full version chain |
| Restatements as new observations | **GAP** |
| Backtester reading future info | L0-D uses panel fields; Option B fabricated stamps can hide look-ahead |
| LLM retrieve future docs in backtest | **GAP** — no historical LLM transcript gate wired to L0-D |
| Reconstruct exact info state for any historical trade | **GAP** |

**Recommendation (architecture law):** treat PIT as an explicit layer (Event Store + observation versions), not a footnote — aligns with existing `pit.js` intent but not with FMP free data.

---

## 5. Universe construction

| Question | Current answer |
|----------|----------------|
| Who owns universe? | Seed script + L0-D universe policy docs; **not** LLM |
| Static vs dynamic | **Static** seed (61 healthcare) + listed-throughout assumption |
| Eligibility | On seed list + publicly listed that day (policy); GEHC/COR specials |
| Market cap at event time | **GAP** for eligibility; L0-D spread uses optional `mcap` (often null → lt_1b bps) |
| Delisted / acquired / bankrupt / IPO | Policy: include through last trade; GEHC from list date; **survivors-only hole** documented |
| Ticker changes / mergers / spin-offs | COR rename continuous; GEHC spin start; **GAP** general corporate-action engine |
| Index membership PIT | **No** |
| Today’s survivors for history? | **Yes risk** — explicitly documented for healthcare; Route B free-tier list has same class of risk |
| Survivorship measurement | **DOC only** — not quantified |
| Liquid / ADV / spread / exchange filters | Risk ADV check exists in risk-engine; universe seed has **no** formal ADV/spread math |
| ADR / OTC / ETF / preferred / share class | Seed includes NSE `.NS`; OTC/penny rejected in risk; ETF/preferred rules **GAP** |
| Symbol disappears from provider | Surrogate builder logs `provider_gaps`; no invent |

**Route B** proposes `fmp_free_tier_accessible_v1` — still a **sandbox universe**, not the product healthcare thesis.

---

## 6. Gate 0 sample-size mathematics

| Question | Answer |
|----------|--------|
| Why n ≥ 40? | **Operational convention** in prereg (`min_top_decile_events: 40`), not a derived power analysis |
| Statistical power / effect size / CI / multiple-testing | **GAP** — not specified in code |
| Top-decile cutoff | **Fixed a priori** in prereg (`decile_cutoff: 0.10`) |
| Universe fixed before results? | Intended yes via prereg + hash; Route B Gate 0 broaden-once is **pre-prereg** recon only |
| Broaden depending on returns? | **Must not** — only on free-tier **availability**, not P&L |
| ~980 event estimate | Approximate: need holdout length ≳ 391 so `ceil(0.1 × holdout) ≥ 40`, with ~40% holdout → ~980 scored |
| floor vs ceil | Runner uses **`Math.ceil`** for top-decile k; Gate 0 must match |
| Gate 0 predicts 41, prices drop to 31 | **Should** second hard-stop after panel build (planned); last Option B run had no post-panel n gate beyond L0-D inconclusive |
| Second sample-size hard stop | **DOC/PLAN** for Route B; not a separate code gate beyond L0-D result |

---

## 7. Train / test / holdout contamination

| Question | Answer |
|----------|--------|
| Surprise threshold | Fixed env/default **1.0** for propose; L0-D uses **decile sort**, not absolute threshold (`sue_threshold: null`) |
| Top-decile cutoff | Fixed in prereg before run |
| Holdout untouched until final eval? | **Intended** — inspect split debug-only in runner; **GAP** enforcing that humans/LLM never peek |
| LLM sees holdout? | Not in L0-D path; chat LLM unrelated |
| Developer retune after holdout? | Process rule: new `hypothesis_id` + parent; hash gate blocks silent prereg edit under same lock without updating sha |
| Auto-rerun after result? | **No** agent loop for that |
| Experiment versioning | Prereg YAML + sha256 + `result-{hypothesis_id}.json` |
| Prove no holdout tuning? | **Partial** — hash + parent linkage; not a full audit vault |
| Inconclusive | Valid outcome; stay research_only |
| Reuse holdout for new hypothesis | Process: new hypothesis; **GAP** formal holdout retirement registry |

---

## 8. Data-provider architecture

| Question | Answer |
|----------|--------|
| Why FMP? | Intended earnings/estimate source for PEAD panels; Yahoo for quotes/fundamentals/dividends |
| FMP unavailable | Panel gaps; empty → L0-D inconclusive |
| Schema change / version raw responses | **GAP** — no raw response archive |
| Premium vs empty | Distinguished in surrogate builder (`fmp_premium_symbol` vs parse errors) |
| Rate limits / retries / cache | Sleep delays in scripts; **GAP** robust retry/cache policy |
| Yahoo vs FMP disagree | **GAP** reconciliation |
| `EXECUTION_PATH=1` | Yahoo client/provider **forbidden** |

---

## 9. Data normalization

| Topic | Status |
|-------|--------|
| Canonical ID | **Ticker string** primarily; `entity_id` optional — **GAP** permanent security master |
| Currency / fiscal / accounting norms | **GAP** |
| Splits / dividends | Dividend adjust in trade-service path; L0-D panel uses raw FMP light prices — **GAP** consistency |
| Adjusted vs GAAP EPS | **GAP** |
| Negative / zero EPS / tiny denominator | ε floor on σ only; **GAP** on % surprise blow-ups (SUE uses σ denom) |

---

## 10. Event engine

| Question | Answer |
|----------|--------|
| What creates EarningsEvent? | `upsertEarningsSurprise` / migrations 013; scheduler PEAD cycle reads store |
| Exactly one event per release? | Unique (ticker, FY, FQ) — **assumes** one row per quarter |
| Multi-provider duplicates | Unique observation key; conflict detect on dual consensus |
| Date changes / delays / preliminary / amended | **GAP** |
| Transcript wait | **GAP** — not in PEAD propose path |
| Signal validity window | **GAP** production |
| Event-time ordering | L0-D sorts by `announcement_at` |

---

## 11. LLM architecture

| Question | Answer |
|----------|--------|
| What may LLM decide? | Tool choice within allowlist; natural-language reply; **not** SUE math or submit |
| Categorical vs probability | Free text + tool calls — **not** a formal sustainability score schema |
| Deterministic? | **No** — model/temperature dependent |
| Model/prompt/doc versioning | **GAP** for PEAD; chat history exists |
| Hallucination controls | Prompt rules; tool failures returned as JSON errors |
| Reject valid mathematical signal? | Can omit calling `generate_signal` or ignore results in prose — **does not** delete DB proposals |
| Create signal without strategy? | Cannot pass fabricated SUE args; can only trigger reader |
| Alter SUE / override liquidity / risk / hard stop? | **No** |
| LLM down / timeout / bad JSON | Turn error message; no orders |
| Transcript “sustainable beat” gate | **DOC/aspirational** in older product notes — **NOT IMPLEMENTED** on PEAD path |

---

## 12. Agent vs deterministic strategy (architectural law)

**FACT today (intended shape):**

```text
Data → (earnings store) → deterministic SUE/PEAD → PROPOSED_ACTION
     → policy → risk → execution → broker
LLM may invoke generate_signal (selectors) and explain — not compute SUE or submit
```

| Must stay deterministic | Status |
|-------------------------|--------|
| SUE | **Yes** |
| Position sizing (Contract N) | **Yes** |
| Risk / kill / eligibility | **Yes** |
| Liquidity filters (risk-engine) | **Yes** |
| Broker submit | **Yes** — execution only |
| Reproduce signal without LLM | **Yes** — `runStrategies` / Gate 3 scheduler bypasses agent |

---

## 13. Transcript / research gate

**GAP / NOT IMPLEMENTED** as a formal PEAD gate. No coded definition of “sustainable earnings,” no transcript/10-Q pipeline on the PEAD propose path.

---

## 14. Signal provenance

| Question | Status |
|----------|--------|
| Unique proposal IDs / lineage JSON | **Partial** — `input_lineage`, observation IDs |
| Hypothesis ID on every live signal | **L0-D artifacts yes**; live proposals **GAP** linkage to hypothesis |
| Strategy / model / prompt versions | Strategy files hashed for L0-D `logic_hash`; LLM prompt versioning **GAP** |
| Trade ↔ signal ↔ thesis chain | Paper orders exist; full provenance chain **GAP** |
| Reconstruct months later | **Partial** |

---

## 15. Risk architecture

| Control | Status |
|---------|--------|
| Max notional / book / PEAD/FDA envelopes | **FACT** — env defaults in sizing + risk-engine |
| Healthcare sector % cap | **FACT** — clamp + audit |
| Sub-sector max open/pending | **FACT** — 2 / 2 |
| Strategy kill (DD / underperf) | **FACT** |
| Global kill switch | **FACT** |
| Max daily loss / simultaneous positions / losing-streak policy | **GAP** or incomplete |
| Halt / spread widen / broker reject / slippage beyond entry | **GAP** or broker-stub limited |
| Who stops trading | Env kill, mode gates, Live-0 human, research_only |

---

## 16. Execution realism

| Topic | Status |
|-------|--------|
| L0-D prices | FMP EOD light close-to-close over 5 sessions; spread bps assumption |
| Bid/ask | **Not** in L0-D |
| Commission | **Not** in L0-D (spread proxy only) |
| Short borrow | Eligibility `borrow_check`; L0-D cost includes optional borrow bps in prereg but panel path is long/short via side — **partial** |
| Partial fills / limit vs market / gaps | Paper broker simplified; Alpaca NOT_WIRED |

---

## 17. Sandbox architecture

| Question | Answer |
|----------|--------|
| Schema identical if same migrations? | **Yes** via `TRADING_DB_PATH` |
| Accidental production connect? | **Risk** — default path if env unset |
| Tests mutate prod DB? | Possible if shared path — **GAP** hard guard |
| Sandbox → live broker? | Blocked by propose-only + live mode forbids + Alpaca stub |
| Hard architectural boundary | **Partial** — process/env discipline, not OS sandbox |

---

## 18. Research → production promotion

| Step | Status |
|------|--------|
| Passing L0-D auto-promote? | **No** |
| Required: hash-matching pass, human review, pead_mode flip, M/N, paper track, Live-0 | **DOC** in BUILD_PROGRESS / Live-0 |
| Independent datasets / periods / paper duration / decay / rollback | **GAP** formal promotion SOP |
| Agent self-promote? | **No** tool |

**Preserve permanently:** metric pass ≠ paper/live.

---

## 19. Experiment registry

| Artifact | Location |
|----------|----------|
| Hypotheses | `docs/ops/l0d_preregistration.yaml` + parent links |
| Lock | `l0d_preregistration.sha256` |
| Results | `artifacts/l0d/result-*.json` (+ committed mirrors under `docs/ops/`) |
| Strategy versions | `logic_hash` over listed strategy files |
| Datasets / prompts / models | Panel fixtures; LLM prompt versioning **GAP** |
| Immutable runs | File overwrite possible — **GAP** WORM store |
| Diff two hypotheses | Manual YAML + parent_id |

---

## 20. Statistical validation

| Topic | Status |
|-------|--------|
| Null / alternative | Implicit: holdout top-decile mean net return ≤ 0 vs > 0 |
| Metric | `mean_net_return_top_decile_holdout` |
| Benchmark / market / sector / vol adjust | **GAP** — raw return minus spread bps |
| Equal vs dollar weight | Equal among top-decile events |
| Independence / clustering / serial correlation / CI / bootstrap / FDR | **GAP** |
| Overlapping events | Allowed if in panel |

---

## 21. PEAD-specific confounders

Pre-announcement drift, guidance, revenue, revisions, sector/regime/vol/momentum/gap controls: **GAP** in L0-D scorer. Transaction costs: crude spread model only. Size control: **GAP**.

---

## 22. Strategy interaction (PEAD + FDA + …)

**GAP** — no portfolio-level conflict resolver, priority, or cross-strategy close. Spine shows Strategy → Policy → Risk → Execution as a single pipeline of proposals.

---

## 23. Observability

Partial: health `/health` (DB ping), scheduler logs, provider_gaps in panels, L0-D artifacts, pead_mode note.  
**GAP:** systematic dashboards for API success, freshness, LLM fail rate, slippage, drift alerts when events collapse (known FMP free-tier risk).

---

## 24. Failure modes (selected)

| Failure | Behavior |
|---------|----------|
| FMP zero / Premium | Gaps / empty panel → inconclusive |
| Yahoo vs FMP disagree | **GAP** |
| LLM down | Chat fails soft; PEAD math unaffected |
| Scheduler double-run | **GAP** idempotency beyond DB unique keys |
| Duplicate signal | Unique earnings keys help; **GAP** trade idempotency beyond client_order_id on paper |
| Broker unavailable | Execution fails; LLM cannot submit anyway |
| Ticker change / acquisition / correction | Partial (COR/GEHC policy); general **GAP** |

---

## 25. Security / agent permissions

| Question | Answer |
|----------|--------|
| Tools | Allowlisted only |
| Research agent → broker submit? | **No** |
| LLM see API keys? | Should not — keys in env for scripts; chat tools don’t echo keys |
| Agent modify strategy/prereg/eval/delete results? | **No** tools; filesystem would require human/agent outside allowlist |
| Permissions by research/paper/live | Mode files + Live-0 + propose-only |

---

## 26. What prevents changing the rules after seeing the evidence?

| Control | Present? |
|---------|----------|
| Preregistration + SHA256 refuse | **Yes** |
| New hypothesis_id + parent on methodology change | **Process yes** |
| PIT / surrogate labeling | **Partial** (honest labels; data still weak) |
| Holdout isolation | **Intended**; human discipline **GAP** |
| LLM determinism | **No** |
| Model/prompt versioning | **GAP** |
| Risk / research_only / Live-0 human | **Yes** |
| Sandbox DB | **Supported**; must be enforced |
| Auditability | **Partial** |

---

## Top 10 gaps (prioritize before / while Route B)

1. **Exact honest PIT SUE** — formula exists; **vendor PIT consensus does not**.  
2. **Historical consensus as-of announcement** — cannot reconstruct from FMP free tier.  
3. **Immutable research↔production boundary** — strong for submit/live; weaker for shared DB/default paths.  
4. **LLM decide vs deterministic** — mostly correct; transcript gate and `requireVerifiedForEligible` on chat **under-wired**.  
5. **Universe survivorship** — documented assumption, not measured.  
6. **Train/holdout protection from iterative humans/agents** — hash helps; no sealed holdout vault.  
7. **Unified versioning** of signal + data snapshot + prompt + model + hypothesis.  
8. **Statistical test beyond mean>0** — no power/CI/FDR.  
9. **Duplicate/stale/malformed → trade** — eligibility helps; end-to-end idempotency incomplete.  
10. **Research agent → live execution** — blocked today; keep forever.

---

## Recommended architecture law (target shape)

```text
Data Layer
  → PIT Event Store (versioned observations)
  → Feature Engine (deterministic SUE, etc.)
  → Deterministic Strategy Engine
  → LLM Research / Gatekeeper (optional, non-authoritative)
  → Risk Engine
  → Portfolio Decision
  → Execution (paper | live behind Live-0)
```

**LLM is never the ultimate authority over risk or execution.**  
**Route B remains a research experiment** under that law until Option A (true PIT) and promotion SOP exist.

---

## Route B decision (for implementers)

| Proceed with Gate 0 free-tier recon? | Only as **sandbox density** work, after accepting SUE remains surrogate. |
| Treat Route B pass as production PEAD? | **Never.** |
| Production PEAD thesis (healthcare)? | Requires true PIT + product universe — separate from free-tier mega-cap sandbox. |

---

## Key file index

| Area | Paths |
|------|-------|
| SUE / PEAD | `services/strategy/sue-ts.js`, `pead.js` |
| PIT / eligibility / L0-D | `services/provenance/pit.js`, `eligibility-policy.js`, `l0d-runner.js`, `pead-mode.js` |
| LLM rails | `services/trading-rails/execute-turn.js`, `tool-allowlists.js`, `propose-only-guard.js` |
| Risk / size | `services/risk/sizing.js`, `risk-engine.js`, `strategy-kill.js` |
| Execution | `services/execution/execution-service.js`, `services/broker/*` |
| Ops | `docs/ops/l0d_*.md`, `l0d_preregistration.yaml`, `BUILD_PROGRESS.md` |
