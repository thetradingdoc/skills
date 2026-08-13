# TRADING_AGENT_VIA_BLANKO_AUDIT

**Date:** 2026-08-10 (Part 1 **live re-verify** same day)  
**Role:** Discovery only — no fixes  
**Evidence:** [`docs/ops/blanko-dual-audit/`](blanko-dual-audit/)

---

## 0. Diagnosis first — why the “stale arch-viz” clone existed (**FIXED**)

### Was this an issue?

**Yes.** Blanko and the trading runtime used **two working trees**. Committed tips matched (`911fb48`); dirty trees did not — prior Part 1 audited the sandbox and mis-described live `:4100`.

### What Blanko is configured to use

[`.blanko-target`](../../.blanko-target) (still dual by design):

| Key | Path | Role |
|-----|------|------|
| `local:` | `~/Voice Agent/trading-agent` | **SSOT** — `:4100` runtime / Part 1 |
| `scan-clone:` | `~/.arch-viz/repos/21a6c9c0-…` | Blanko sandbox (dogfood/Approve) |

### Fix applied (2026-08-10)

1. **Synced** scan-clone `middleware-platform` (+ trading UI) from live SSOT:  
   `npx tsx scripts/sync-blanko-scan-clone-from-local.ts`  
   Evidence: [`scan-clone-sync-report.json`](blanko-dual-audit/scan-clone-sync-report.json) — `sessiId` gone on clone; Alpaca HTTP matches live.
2. **Helper** [`scripts/lib/blanko-target.ts`](../../scripts/lib/blanko-target.ts) — Part 1 / dual-audit harnesses prefer `local:`; dogfood stays on `scan-clone`.
3. **Docs** — [`.blanko-target`](../../.blanko-target) comments + [`docs/ops/ENV.md`](ENV.md) SSOT / sync instructions.

**Ongoing:** after you change live trading code, re-run the sync script before Blanko sandbox audits. Do not treat scan-clone as paper/EOD SSOT.

**BOTH-CLONE-001** → **resolved** (middleware trees aligned; process remains dual-root with sync discipline).

---

## 0b. Meta (tips under test)

| | |
|--|--|
| **Blanko tip** | `8a9fa5d` (arch-visualizer) |
| **Trading committed tip** | `911fb48` on **both** local and scan-clone |
| **Trading SSOT for Part 1** | `/Users/ojrichard/Voice Agent/trading-agent` · **`:4100`** |
| **Scan-clone (stale for runtime)** | `~/.arch-viz/repos/21a6c9c0-4774-4a8c-9cac-128919b48170` |
| **Ask chat ≠ trading chat** | Blanko ChatBar → `BK-*` · Trading `/api/trading/chat/turn` → `TA-*` |

### Part 1 live P0/P1 (after re-verify)

| ID | Live status | Notes |
|----|-------------|-------|
| TA-HEALTH-001 | **resolved-on-live** | `:4100` `/health` → ok |
| TA-CHAT-001 | **resolved-on-live** | turn 200; typo fixed in dirty tree |
| TA-BROKER-001 | **resolved-on-live*** | HTTP path present (*creds still required or NOT_WIRED) |
| TA-SPINE-001 | **open** | `expected-spine.js` still missing |
| BOTH-CLONE-001 | **resolved** | scan-clone middleware synced from live; harnesses prefer `local:` |
| TA-CHAT-LLM | **open P2** | turn works but reply: `GROQ_API_KEY not set` |
| Propose-only | **PASS** | live guards present |

\*Corrected vs script false-negative; see [`part1-live-source-diff.json`](blanko-dual-audit/part1-live-source-diff.json) `liveAlpacaHasHttpFetch: true`.

---

## 1. Part 1 — Trading agent (agentic architecture) — **LIVE**

Harness: [`scripts/part1-live-trading-audit.ts`](../../scripts/part1-live-trading-audit.ts)

### 1.1 UI / canvas evidence (Blanko scan of **live** path)

`POST /api/scan` with `repoUrl` = Voice Agent path → **200**, `projectRoot` = `/Users/ojrichard/Voice Agent/trading-agent`, agents include `execute-turn.js` + `llm-router.js`, ~10 folder nodes (mega-node pattern unchanged).

[`part1-live-blanko-scan.json`](blanko-dual-audit/part1-live-blanko-scan.json)

Prior spine / Platforms / Agents UI shots against **scan-clone boards** remain useful for Blanko product bugs, but **runtime truth** for this section is live.

### 1.2 Backend / runtime evidence (`:4100`)

| Check | Live result | Status |
|-------|-------------|--------|
| `GET http://127.0.0.1:4100/health` | 200 `{status:"ok", mode:"paper"}` | PASS |
| `POST /api/trading/chat/turn` | 200 success; reply notes missing GROQ key | PASS turn / P2 config |
| `sessiId` typo | Absent on live; **present on scan-clone** | fixed live; clone stale |
| Alpaca broker | HTTP `_fetch` / `submitOrder` on live; scan-clone still always-NOT_WIRED stub | live advanced |
| Propose-only + allowlists | Present on live | PASS |
| `expected-spine.js` | Missing on live and scan-clone | OPEN |
| `npm test` subset | 78 pass / 1 fail — trading-chat expects 501 when disabled, got 200 (agent enabled in env) | test contract |

[`part1-live-health-chat.json`](blanko-dual-audit/part1-live-health-chat.json) · [`part1-live-npm-subset.json`](blanko-dual-audit/part1-live-npm-subset.json)

### 1.3 Spine scorecard (live tip + Blanko fixture)

Locked edges still from Blanko [`fixtures/expected-spine.json`](../../fixtures/expected-spine.json). Runtime `expected-spine.js` **still absent** on live → **TA-SPINE-001** open.

| Node | Blanko spine UI | Live runtime |
|------|-----------------|--------------|
| Telegram / Trading Chat | Present when spine applied | Turn API **works** on `:4100` (LLM key gap) |
| Identity / Payment | Present | Identity + paper wallet code on live dirty tree |
| Agent | Present | `execute-turn.js`; research lane |
| Strategy→Policy→Risk→Execution | Present after Apply | Present in live tree |
| Alpaca | UI binding may still confuse | **HTTP broker** on live (creds gated) |

### 1.4 Ranked TRADING findings (live)

#### Still open on live

**BOTH-CLONE-001** · resolved · both · Scan/config  
- Was: scan-clone lagged live (`sessiId`, stub Alpaca).  
- Now: synced via `scripts/sync-blanko-scan-clone-from-local.ts`; harnesses prefer `local:`.  
- **Evidence:** [`scan-clone-sync-report.json`](blanko-dual-audit/scan-clone-sync-report.json)

**TA-SPINE-001** · P2 · backend · Spine  
- No `expected-spine.js` under live `trading-rails/`.

**TA-CHAT-LLM-001** · P2 · backend · Chat  
- Turn returns success but model path: `GROQ_API_KEY not set`.  
- **Evidence:** [`part1-live-health-chat.json`](blanko-dual-audit/part1-live-health-chat.json)

**TA-CHAT-002** · P2 · backend · Tests  
- `trading-chat.test.js` expects 501 when disabled; with agent enabled locally, suite sees 200.

#### Resolved on live (do not re-fix as if open)

| ID | Was (scan-clone audit) | Now (live) |
|----|------------------------|------------|
| TA-HEALTH-001 | 503 | **ok** on `:4100` |
| TA-CHAT-001 | 500 sessionId | **200**; typo fixed in dirty tree |
| TA-BROKER-001 | always NOT_WIRED stub | **HTTP path**; NOT_WIRED only without creds |

#### PASSes

- Propose-only guard on live  
- Blanko can scan live path as `projectRoot`  
- Process on `:4100` is Voice Agent middleware (not scan-clone)

---

## 2. Part 2 — Blanko (product) — unchanged from prior pass

Blanko UI/API findings (Send intercept, Platforms “3 bound”, Agents empty on spine, Flow `project_root`, a11y, etc.) remain in evidence under [`blanko-dual-audit/`](blanko-dual-audit/) from the earlier dual pass. They are **product** issues; they were not invalidated by the live trading re-verify.

Key pictures: [gap-41-platforms.png](blanko-dual-audit/gap-41-platforms.png) · [gap-40-agents-inventory.png](blanko-dual-audit/gap-40-agents-inventory.png) · [38-view-diff.png](blanko-dual-audit/38-view-diff.png) · [a11y-10-forced-drift-pulse.png](blanko-dual-audit/a11y-10-forced-drift-pulse.png)

---

## 3. Both / misrepresentation

| ID | Issue |
|----|-------|
| **BOTH-CLONE-001** | **Resolved** — scan-clone middleware synced from live; keep syncing after live edits |
| BOTH-PROV-001 | Platforms bound copy vs broker readiness — re-check on board built from **live** scan after Apply spine |
| BOTH-SCAN-001 | Folder mega-node still true on live scan (10 nodes) |

---

## 4. Recommended next actions

1. After live trading edits: `npx tsx scripts/sync-blanko-scan-clone-from-local.ts`  
2. Part 1 / `:4100` remains SSOT — do not re-open fixed TA-HEALTH/CHAT/broker-stub  
3. Blanko Part 2 backlog (Send intercept, Platforms honesty, Agents on spine, Flow `project_root`)  
4. Set `GROQ_API_KEY` / Anthropic on live for real chat replies  
5. Add `expected-spine.js` on live when you want Blanko↔runtime SSOT binding  

---

## 5. Success criteria (Part 1 live pass)

| Criterion | Status |
|-----------|--------|
| Diagnosed dual-root before re-audit | **Yes** §0 |
| Confirmed Blanko `.blanko-target` local vs scan-clone | **Yes** |
| Part 1 against live `:4100` + Voice Agent tree | **Yes** |
| Stale findings marked resolved-on-live | **Yes** |
| Open items are real on live or config drift | **Yes** |
| Discovery only | **Yes** |
