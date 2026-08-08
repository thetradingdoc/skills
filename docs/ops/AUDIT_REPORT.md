# AUDIT_REPORT.md — Adversarial verification (trading-spine-and-evidence)

**Date:** 2026-08-08  
**Auditor role:** verification only (no fixes applied)  
**Claim source:** prior conversation / dangling `BUILD_PROGRESS.md` at `86a9ac1` (“76 tests green”, L0–Live-0 complete)  
**Repos checked:**

| Repo | Path | Branch / tip |
|------|------|----------------|
| Runtime | `~/.arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170` | `main` @ `911fb48` |
| Blanko | `/Users/ojrichard/Architect/arch-visualizer` | `phase-1-core` @ `fe3c0d1` (+ dirty tree) |

**Important scope split:** Almost every claimed middleware feature exists only on **orphaned commit `86a9ac1`** (reflog), **not** on current `main` HEAD. Where relevant, results are labeled **HEAD** vs **86a9ac1 (extracted archive)**.

Extract used for 86a9ac1 verification: `docs/ops/_audit_86a9ac1/` (from `git archive 86a9ac1`).

---

## 0. Baseline sanity

### Commands (runtime git root)

```text
$ git log --oneline -20
911fb48 Adapt paper broker to identity-scoped positions after rebase.

$ git status -sb
## main...origin/main
 M resources.classify.json
?? architecture.layers.json
?? middleware-platform/artifacts/
?? middleware-platform/scripts/verify-absences.js

$ git merge-base --is-ancestor 86a9ac1 HEAD; echo $?
1
```

```text
$ git cat-file -t 86a9ac1
commit
$ git log -1 --oneline 86a9ac1
86a9ac1 Gate 3 + Live-0: PEAD scheduler skip path and compliance checklist

$ git reflog | head -5
911fb48 HEAD@{0}: reset: moving to origin/main
911fb48 HEAD@{1}: reset: moving to origin/main
86a9ac1 HEAD@{2}: commit: Gate 3 + Live-0: ...
```

### Blanko

```text
$ git log --oneline -3
fe3c0d1 G1-A: wire Telegram→Agent and Identity→Agent on trading spine
8bc077a Make blanko Insights show trading workflow, brokers, and node briefings.
72acf45 Apply trading agent spine on blanko canvas; fix rescan and staleness.

$ git merge-base --is-ancestor fe3c0d1 HEAD; echo $?
0
```

| Check | Claim | Result | Verdict | Notes |
|-------|-------|--------|---------|-------|
| 0.1 | `86a9ac1` exists | object exists | **PASS** | Commit object present |
| 0.2 | `86a9ac1` reachable on current branch | `merge-base --is-ancestor` → exit 1 | **FAIL** | Reset to `origin/main` (`911fb48`) orphaned all L0–Live-0 commits |
| 0.3 | `BUILD_PROGRESS.md` on HEAD | missing | **FAIL** | Present only inside `86a9ac1` tree |
| 0.4 | `fe3c0d1` reachable on Blanko | ancestor of HEAD | **PASS** | Blanko G1-A tip is current HEAD commit |

**Red flag:** A progress report citing `86a9ac1` while `main` points at a post-rebase single commit that **does not contain** that work is itself evidence the “done” claim is not the live checkout.

---

## 1. Full test suite (verbose)

### HEAD (current `middleware-platform`)

```text
$ npm test -- --verbose 2>&1 | tee /tmp/test_output.log
...
Test Suites: 2 failed, 10 passed, 12 total
Tests:       2 failed, 43 passed, 45 total
EXIT: non-zero (failures)
```

Failures:

- `server-health`: expected 200, got 503  
- `trading-chat`: expected 501 when agent disabled, got 500  

**“76 tests green” vs HEAD:** **FAIL** — 45 tests total, 2 failing; none of the L0/G1/Gate suites exist on HEAD.

### 86a9ac1 archive

```text
$ npm test -- --verbose   # package.json testPathPattern
Test Suites: 21 passed, 21 total
Tests:       113 passed, 113 total
```

**But** `package.json` test pattern **excludes** `gate3-pead-cycle` and `live0`:

```text
jest --testPathPattern='...|gate2-' --passWithNoTests
# no gate3- / live0
```

Explicitly:

```text
$ npx jest __tests__/gate3-pead-cycle.test.js __tests__/live0.test.js ...
Tests: 36 passed (includes gate3+live0 + overlapping suites)
```

`it()` count across all `__tests__/*.test.js` at 86a9ac1: **121** (not 76).

| Check | Claim | Result | Verdict | Notes |
|-------|-------|--------|---------|-------|
| 1.1 | 76 tests green on live tree | HEAD 43/45; 86a9ac1 `npm test` = 113 | **FAIL** | Count claim wrong; HEAD missing suites |
| 1.2 | Default `npm test` runs Gate3/Live-0 | pattern omits them | **SUSPICIOUS** | Suites exist & pass when invoked explicitly |

### Rejection greps (HEAD)

```text
lookahead / sector non-eligible / borrow / forbidden args → (empty or happy-path only)
submit_order → present in propose-only / execution (real rejects)
```

### Rejection greps (86a9ac1) — assertion quality

| Grep theme | File / test | Asserts rejection? | Verdict |
|------------|-------------|--------------------|---------|
| look-ahead | `l0a-pit.test.js` “rejects consensus captured after announcement” | `expect(...).toThrow` / reject | **PASS** |
| sector σ | `l0b-lineage.test.js` `stdev_method=sector ⇒ never eligible` | `execution_eligible === false` | **PASS** |
| borrow missing/stale | `l0b-lineage.test.js` | `execution_eligible === false` + paper size 0 | **PASS** |
| forbidden args | `g1a-spine-auth` / `gate2-generate-signal` | `toThrow(/forbidden/)` | **PASS** |
| submitOrder | `propose-only` / `g1a` / `execution` | `rejects` / `not.toHaveBeenCalled` | **PASS** |

---

## 2. `generate_signal` reachable from chat turn

### HEAD

```text
$ grep -n "generate_signal" services/trading-rails/execute-turn.js
(no matches for schema; TOOL_SCHEMAS has get_quote/get_portfolio/get_trade_history only)

$ sed -n '170,195p' services/trading-tool-executor.js
case 'generate_signal':
  throw fail('TRADING_TOOL_NOT_IMPLEMENTED', ...);
```

| Check | Verdict | Notes |
|-------|---------|-------|
| 2.HEAD schema | **FAIL** | Not in `TOOL_SCHEMAS` |
| 2.HEAD executor | **FAIL** | Still stub `TRADING_TOOL_NOT_IMPLEMENTED` |

### 86a9ac1 — schema present

```javascript
// services/trading-rails/execute-turn.js (excerpt)
generate_signal: {
  type: 'function',
  function: {
    name: 'generate_signal',
    description:
      'Run strategy readers (PEAD/FDA) against stored events. Selectors only — never pass actual/consensus/stdev/sue_ts/size. ...',
    parameters: { properties: { symbols, strategy, as_of } },
  },
},
```

Allowlist: `signal.analyze` / `signal.preview` include `generate_signal`.

### Simulated turn (86a9ac1)

```text
$ TRADING_AGENT_ENABLED=1 executeTurn(web anonymous, "Please use generate_signal...")
TURN {
  "state": { "active_lane": "research", "step": "query", ... },
  "reply": "That did not work: GROQ_API_KEY not set. Nothing was changed.",
  "toolsUsed": []
}
```

Default state = `research/query` → tools = `search_biotech_news`, `get_quote` only.  
No code path found that auto-transitions to `signal/analyze`.

Direct executor:

```text
generate_signal({strategy:'all'}) → { proposals: [], pead_mode: "research_only", as_of: null }
```

No broker/submit in that path.

| Check | Verdict | Notes |
|-------|---------|-------|
| 2.86 schema in TOOL_SCHEMAS | **PASS** | Fixed vs earlier omit bug |
| 2.86 model actually called tool in turn | **FAIL** / **SUSPICIOUS** | No API key; even with keys, default lane does not expose the tool |
| 2.86 lineage/eligible on empty DB | N/A | Empty proposals |

---

## 3. Forbidden-argument rejection at tool boundary

### HEAD

```text
$ grep -rn "actual|consensus|stdev|sue_ts" services/trading-tool-executor.js | grep -i reject
(no hits)
Scratch: generate_signal({consensus:5.2}) → TRADING_TOOL_NOT_IMPLEMENTED
```

**FAIL** — rejects as unimplemented, not as forbidden-args.

### 86a9ac1

```text
sanitizeGenerateSignalArgs({symbols:['MCK'], consensus:5.2})
→ REJECTED generate_signal forbidden args: consensus (selectors only)

TradingToolExecutor.execute('generate_signal', {symbols:['MCK'], consensus:5.2}, ...)
→ FORBIDDEN_SIGNAL_ARGS ... consensus
```

| Check | Verdict |
|-------|---------|
| 3.86 | **PASS** — throw, not silent ignore |

---

## 4. `execution_eligible` policy — one rule at a time (86a9ac1 live scripts)

| Rule | Live result | Verdict |
|------|-------------|---------|
| confidence stub | `execution_eligible === false` | **PASS** |
| confidence fixture | false | **PASS** |
| confidence llm_draft | false | **PASS** |
| stdev_method=sector | false | **PASS** |
| missing lineage | false | **PASS** |
| short missing borrow | false | **PASS** |
| short stale borrow | false | **PASS** |
| short shortable:false | false | **PASS** |
| strategy_kill active | false when `strategy_state.kill_reason` set | **PASS** (field is `kill_reason`, not `killed:true`) |
| sector cap Contract N | sizes clamp (`8000→3000`); **eligible stays true** | **SUSPICIOUS** vs “eligible===false”; enforcement is sizing clamp, not eligibility flip |

HEAD: eligibility-policy module **absent** → **FAIL** for all rules on live checkout.

---

## 5. PEAD paper sizing blocked under research_only (live)

### HEAD

No `pead_mode` / `assertPaperSizeAllowed` → **FAIL**

### 86a9ac1

```text
assertPaperSizeAllowed(grounded PEAD action, { strategy_id: 'pead' })
→ allowed:false, sized_notional:0,
  reasons: ["PEAD paper sizing blocked by L0-D (l0d_result=missing, mode=unset)"]

isPeadPaperSizingAllowed(readPeadMode()) → false
l0d-gate tests: empty panel → research_only; paper blocked → PASS when run
```

Also executor forces `execution_eligible=false` when PEAD and L0-D not allowing paper.

| Check | Verdict | Notes |
|-------|---------|-------|
| 5.86 PEAD blocked from paper size | **PASS** | Concrete gate, not just a flag file |
| 5.HEAD | **FAIL** | Code not on branch |

---

## 6. FDA validation / `execution_eligible`

```text
FDA + openfda grounded lineage + borrow_check
→ execution_eligible: true
→ assertPaperSizeAllowed → allowed:true, sized_notional:2500

Executor PEAD-only forces ineligible under research_only; no equivalent FDA L0-D gate.
```

| Check | Verdict | Notes |
|-------|---------|-------|
| 6 | **FAIL** (finding) | FDA can size on lineage/borrow alone with **no** economic-validation gate analogous to PEAD L0-D |

---

## 7. Stub / dead / reachable leftovers

```text
$ grep -rn "PRIVATE_TO_TICKER|TRADING_TOOL_NOT_IMPLEMENTED|sessiId|TODO|FIXME|not.?implemented" services/
```

| Hit | Category | Verdict |
|-----|----------|---------|
| `PRIVATE_TO_TICKER` in `fda-supply.js` | **(b) reachable** | Used by `resolveTicker` / `proposeFromFdaEvent` |
| `TRADING_TOOL_NOT_IMPLEMENTED` | HEAD: live stub for generate_signal; 86a9ac1: still used for other tools | HEAD **FAIL**; 86a9ac1 remaining stubs for catalysts/news |
| `sessiId` in `trading-chat-service.js` | **(b) live bug** | Defined `sessiId` then `sessionId: sessionId` (unbound) → **ReferenceError** when `TRADING_AGENT_ENABLED=1` | **FAIL** |

---

## 8. Yahoo blocked on execution path

| Path | EXECUTION_PATH=1 behavior | Verdict |
|------|---------------------------|---------|
| `YahooMarketDataProvider` | throws `YAHOO_EXECUTION_FORBIDDEN` | **PASS** |
| `services/market-data-client.js` (used by `get_quote`) | **no** EXECUTION_PATH check; attempted fetch → `FETCH_ERROR` | **FAIL** |
| `dividend-service.js` | hardcodes Yahoo URL, no EXECUTION_PATH | **SUSPICIOUS** / **FAIL** if used on exec path |

---

## 9. Ingress abuse tests (86a9ac1 `g1a-spine-auth.test.js`)

| Claimed behavior | Actual assertion | Quality |
|------------------|------------------|---------|
| Forbidden-arg rejection | `expect(() => sanitize...(key)).toThrow(/forbidden args/i)` | **PASS** — real reject |
| No path to submit tools | `TradingToolExecutor.execute('submit_order')` rejects `PROPOSE_ONLY_VIOLATION` | **PASS** |
| Misreport can’t size ineligible | `assertPaperSizeAllowed({execution_eligible:false})` → `allowed===false`, `sized_notional===0` | **PASS** |
| Loop/spam prevention | Reads `execute-turn.js` for `MAX_STEPS=\d+` and asserts `0 < n ≤ 20` | **SUSPICIOUS** — source-text contract, **not** a behavioral spam/loop test |

---

## 10. Blanko spine edges (independent of UI)

```text
$ grep -n "bp-ta-telegram|bp-ta-agent|bp-ta-identity" webapp/client/src/designBlueprints.ts
...
165: bpEdge("bp-ta-telegram", "bp-ta-agent", "invokes"),
166: bpEdge("bp-ta-identity", "bp-ta-agent", "authorizes"),

$ spineWorkflowConnected → EXPECTED_SPINE_EDGES.every(...)
```

```text
$ node --import tsx scripts/test-expected-spine.ts
ok: G1-A EXPECTED_SPINE Blanko edges + spineWorkflowConnected

$ node --import tsx scripts/test-trading-spine.ts
ok: trading spine apply + file bind + buildStatus

$ npm test -- tradingSpine
No test files found, exiting with code 1   # vitest filter miss; scripts above are the real checks
```

| Check | Verdict |
|-------|---------|
| 10 edges in blueprint | **PASS** |
| 10 `spineWorkflowConnected` requires them | **PASS** |
| 10 vitest `tradingSpine` name | **SUSPICIOUS** — wrong runner; script tests pass |

---

## 11. Cross-repo `EXPECTED_SPINE` consistency

**Blanko** (`tradingSpine.ts`) and **86a9ac1 runtime** (`expected-spine.js`) edge lists **match** (same 8 edges, same hops).

**HEAD runtime:** file **missing**.

| Check | Verdict | Notes |
|-------|---------|-------|
| 11 definitions match (Blanko vs 86a9ac1) | **PASS** today | Comment says “keep in sync” |
| 11 test ties repos together | **FAIL** | No test fails if one side drifts; each repo tests only its own copy |
| 11 HEAD | **FAIL** | No runtime copy on current branch |

---

## 12. Contract P logic-hash

86a9ac1 live:

```text
evaluateRevalidation with matching latest.logic_hash → ok:true
whitespace append to pead.js → reasons: ['logic_hash_mismatch'], pead_mode forced research_only
reverted pead.js
```

| Check | Verdict |
|-------|---------|
| 12.86 | **PASS** — real mechanism |
| 12.HEAD | **FAIL** — module absent |

---

## Master table

| # | Claim verified | Command / method | Result (short) | PASS/FAIL/SUSPICIOUS | Notes |
|---|----------------|------------------|----------------|----------------------|-------|
| 0 | Commits reachable | `merge-base --is-ancestor` | `86a9ac1` not on HEAD; `fe3c0d1` ok | **FAIL** / **PASS** | Runtime work orphaned by reset |
| 1 | 76 green tests | `npm test --verbose` | HEAD 43/45; 86a9ac1 113 (+8 if gate3/live0) | **FAIL** | Wrong count; HEAD incomplete |
| 1b | Rejection tests assert failure | greps + file read | Present & assert on 86a9ac1; absent on HEAD | **PASS**/86 **FAIL**/HEAD | |
| 2 | generate_signal in TOOL_SCHEMAS + turn | grep + executeTurn | Schema ok on 86a9ac1; turn never exposes tool (research/query) | **SUSPICIOUS**/FAIL | Lane gating |
| 3 | Forbidden args at boundary | scratch executor | 86a9ac1 throws FORBIDDEN_SIGNAL_ARGS; HEAD NOT_IMPLEMENTED | **PASS**/86 **FAIL**/HEAD | |
| 4 | Policy rules each false | live node script | 9/10 PASS; sector is clamp not eligible=false | **PASS** + **SUSPICIOUS** | |
| 5 | PEAD research_only blocks sizing | assertPaperSizeAllowed live | sized_notional 0 | **PASS**/86 **FAIL**/HEAD | Most important economic brake — works in orphan tree only |
| 6 | FDA cannot eligible without validation | openfda+borrow script | eligible=true, paper 2500 | **FAIL** | Real gap |
| 7 | No live stubs/typos | grep + read | `sessiId` bug; PRIVATE_TO_TICKER live | **FAIL** | Chat enable crashes |
| 8 | Yahoo blocked on exec path | EXECUTION_PATH=1 | Provider OK; market-data-client not gated | **FAIL** | get_quote uses ungated client |
| 9 | Ingress abuse adversarial | quote assertions | 3 solid; MAX_STEPS is source sniff | **SUSPICIOUS** | |
| 10 | Blanko spine edges | grep + tsx scripts | Edges + connected check | **PASS** | |
| 11 | EXPECTED_SPINE cross-repo | side-by-side + tests | Match on 86a9ac1; no cross-repo CI | **SUSPICIOUS**/FAIL | Drift unprotected; HEAD missing |
| 12 | Contract P hash fires | whitespace pead.js | logic_hash_mismatch → research_only | **PASS**/86 **FAIL**/HEAD | |

---

## Prioritized findings (closest to sizing/submit first)

1. **CRITICAL — Runtime HEAD is not the claimed build.** `main`=`911fb48` after `reset` to `origin/main`; L0–Live-0 code/`BUILD_PROGRESS`/`expected-spine`/`eligibility-policy` are **not** on the branch. Any “done” claim about the live clone is false until restored.
2. **HIGH — FDA can be `execution_eligible=true` and paper-sized** with grounded `openfda` + borrow, with **no** L0-D-equivalent economic gate (PEAD-only brake in executor).
3. **HIGH — `sessiId` typo** in `trading-chat-service.js`: enabling the agent references unbound `sessionId` → crash on chat path.
4. **HIGH — Yahoo via `market-data-client` / `get_quote`** is not EXECUTION_PATH-gated (provider class is; the client used by tools is not).
5. **MEDIUM — `generate_signal` not reachable from default chat turn** (lane stuck at `research/query`); schema/allowlist alone do not make Gate 2 “chat-reachable.”
6. **MEDIUM — Default `npm test` omits Gate3 + Live-0**; “76 green” understates and miscounts (113–121).
7. **MEDIUM — Contract N sector cap clamps size but leaves eligible true** — if the claim was “eligible===false,” it is overstated.
8. **MEDIUM — Ingress “loop/spam” test is a MAX_STEPS source regex**, not an adversarial loop simulation.
9. **MEDIUM — No cross-repo test** binding Blanko `EXPECTED_SPINE_EDGES` to runtime `expected-spine.js` (match today is coincidental discipline).
10. **LOW — Blanko `npm test -- tradingSpine` finds no vitest files**; real coverage is `scripts/test-*.ts` (those pass).
11. **LOW — Blanko `fe3c0d1` claim** holds; spine edges/tests are the healthiest part of the report.

---

## Explicit non-actions (original audit)

- No fixes applied **in the original audit pass**.
- No `git reset` / restore of `86a9ac1` onto `main` **during the audit**.
- No live broker / `mode=live` enablement attempted.
- Proposal of fixes deferred until you confirm priority order from the list above.

---

## Remediation re-verification (2026-08-08, post Phases 0–8)

**Not part of the original adversarial audit.** Fresh checks only after the ordered fix pass. Do not treat earlier HEAD/86a9ac1 rows as current.

| Runtime | Tip |
|---------|-----|
| `~/.arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170` | `main` includes merge `749865a` + Phases 1–8 (`f03f19e` tip at verification) |
| Blanko | `phase-1-core` + `test:trading-spine` / expected-spine binding commits |

```text
$ cd middleware-platform && npm test
Test Suites: 27 passed, 27 total
Tests:       136 passed, 136 total
```

| # | Original finding | Re-verify method | Result |
|---|------------------|------------------|--------|
| 0 | Orphaned `86a9ac1` | `git merge-base --is-ancestor 86a9ac1 HEAD` | **PASS** (ancestor via merge) |
| 1 | Wrong test count / omitted suites | `npm test` default (no path filter) | **PASS** — 136 tests, includes gate3+live0 |
| 2 | `generate_signal` unreachable from chat | `__tests__/signal-lane-routing.test.js` | **PASS** — routes to signal/analyze; tool in trace |
| 3 | Forbidden args | existing gate2 / g1a suites in full run | **PASS** (suite green) |
| 5 | PEAD research_only sizing | existing l0d / eligibility in full run | **PASS** (suite green; mode unchanged) |
| 6 | FDA no economic gate | `__tests__/fda-mode.test.js` | **PASS** — research_only blocks paper size |
| 7 | `sessiId` crash | `__tests__/trading-chat.test.js` | **PASS** |
| 8 | Yahoo ungated on client | `__tests__/market-data.test.js` EXECUTION_PATH cases | **PASS** |
| 9 | MAX_STEPS source sniff only | `__tests__/max-steps-runtime.test.js` | **PASS** — runtime stops at MAX_STEPS |
| 11 | No cross-repo spine binding | fixture hash tests + deliberate drift→fail→revert | **PASS** |
| 8b / N | Silent sector clamp | contracts-mnop Phase 8(a) audit assertion | **PASS** — clamp audible; eligible semantics unchanged (option a) |

**Still HARD STOP (unchanged by remediation):**

- `pead_mode` / `fda_mode` remain **research_only** — do not flip without real validation methodology.
- **No `mode=live`** / live broker enablement without explicit human approval.
- Live-0 checklist built & tested; live enable still awaiting human.
