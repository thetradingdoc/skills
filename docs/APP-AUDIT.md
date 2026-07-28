# App audit — phase-1-core

**Date:** 2026-07-27  
**Branch:** `phase-1-core` @ `c5a6a6d`  
**Target:** live app at `http://localhost:5174` + API `http://localhost:4000`, somo-platform  

**Method note:** Live `POST /api/scan` currently fails with `spawnSync npx ENOBUFS` (~24–154s then HTTP 500). After documenting that failure, canvas/view probes used a fulfilled `/api/scan` response built from `buildAgentInventory` on the existing somo clone (`/tmp/audit-somo-graph.json`). Claims about the live scan path use the real API; claims about view behaviour use that seeded graph unless stated otherwise.

**Evidence store:** `docs/app-audit-evidence.json`, screenshots under `docs/app-audit-shots/`.

**Not tested (needs real auth / private repo):** signed-in save/share/workspace persistence, Connect GitHub OAuth success path, private-repo scan.

---

## Summary table

| Surface | works / broken / not built | Evidence | Severity |
|---------|----------------------------|----------|----------|
| Landing CTAs (scan / Sign in / Get started) | **works** | `elementFromPoint` → self/child; `01-landing.png` | — |
| Auth modal from landing | **works** | `02-auth-on-landing.png` shows auth UI | — |
| Live `POST /api/scan` (somo) | **broken** | HTTP 500 `spawnSync npx ENOBUFS` (`/tmp/audit-scan2.json`, ~24s) | **blocker** |
| Anonymous scan → workspace (seeded) | **works** | Layers visible in 536ms; `03-after-scan.png` | — |
| Signup prompt after anon scan | **broken** | No modal after scan; `03-after-scan.png`; auth JSX only under landing branch | **high** |
| Anonymous scan limit (UI) | **broken** / unobservable | Limit increments only after successful scan; live scan never succeeds → `SIGNUP_REQUIRED` never fires | **blocker** |
| Workspace ⋮ menu opens | **works** | Items listed; `04-workspace-menu.png` | — |
| ⋮ Members | **broken** | Click → no panel; `05-menu-members.png` still Layers | **blocker** |
| ⋮ Activity log | **broken** | Same; `05-menu-activity.png` | **blocker** |
| ⋮ Scan history | **broken** | Same; `05-menu-scan-history.png` | **blocker** |
| ⋮ Snapshot timeline | **broken** | Same; `05-menu-snapshot.png` | **blocker** |
| ⋮ Connect from GitHub | **broken** | Same; `05-menu-github.png` | **blocker** |
| Module graph (2D) | **works** | Paint ~98ms; `10-view-2d.png`; `.react-flow__node` present | — |
| 3D view | **broken** | `16b-3d-swiftshader.png`: chrome + legend, **black empty canvas**; thousands of THREE/WebGL console lines in headless | **high** |
| Layers | **works** | Paint ~26ms; 11 bands; `10-view-layers.png` / `03-after-scan.png` | — |
| Layers agent switch | **works** | Kelly Safety `4` vs retell Safety `0` / Missing; `13b-layers-*.png` | — |
| Layers empty vs unsearched | **works** (empty distinct) | Orange dashed “Missing — …” bands; unsearched count 0 on this data; `03-after-scan.png` | — |
| Standard | **works** | Paint ~52ms; `10-view-standard.png` | — |
| Standard ↔ `reference-model.json` | **works** | Score `8 of 11` → `9 of 11` after `evaluation.whenSensitive=optional`; `14-standard-*.png` | — |
| Agents | **works** | Paint ~66ms; `10-view-agents.png` | — |
| Reach | **works** | Paint ~189ms; `10-view-reach.png` | — |
| Reach cell → evidence | **works** | 485 titled “reaches at depth” cells; click opens chain; `11b-reach-cell.png`; scroll ~222ms | — |
| Resources | **works** | Paint ~146ms; unclassified toggle; `12c-resources.png` | — |
| Resources classify → disk | **works** | `patient` click; `resources.classify.json` changed (`diskChanged=true`) | — |
| Guard render | **works** | Paint ~1005ms; `10-view-guard.png` | — |
| Guard Save → `reach.rules` | **works** | Wrote `# audit-probe-line`; file length 700→720 | — |
| Guard Re-check | **works** | Results show FAIL/PASS after Re-check; `15c-guard-check.png` | — |
| `check-reach-rules.ts` somo | **works** (CI fail expected) | exit **1**; `summary={pass:0,fail:7,failNew:7,unevaluable:0}`; 7 evals | — |
| `check-reach-rules.ts` no agents | **works** | exit **0**; `unevaluable:6`, `failNew:0` — UNEVALUABLE does not exit 1 | — |
| PathSearchBar | **not built** | Not mounted / not visible in workspace | — |
| SystemQuestionBar | **not built** | Not mounted / not visible | — |
| NodePopup create-todo | **not built** | No control on node select; `18b-node.png` | — |
| Canvas legend `J` (Jira) badge | **leftover, visible** | `ArchCanvas.tsx:3230` `title="Jira linked"`; `J` in legend on `16b-3d-swiftshader.png` | **medium** |
| `webapp/client/dist` in git | **broken** (process) | `git ls-files`: `index.html` + CSS asset tracked | **medium** |
| API `/api/jira/status` | mounted | HTTP 200 | info |
| API `/api/todos` | mounted | HTTP 400 | info |
| API `/api/rails` | mounted | HTTP 400 | info |
| API `/api/greenfield/drafts` | mounted | HTTP 200 | info |
| API `/api/solo/workspace` | mounted | HTTP 500 | info |
| Flow view (prototype) | **not built** | No Flow toolbar button | — |
| No-agent empty state (prototype) | **not built** | Seeded 0-agent graph still opens normal workspace chrome; no “No AI agent found” | — |
| Anon gate bar (prototype) | **not built** | No locked/gate copy in workspace | — |
| Signed-in flows | **not tested** | No credentials in audit env | — |

---

## 1. Paths (anonymous → workspace)

### Landing clickability
All three CTAs receive hits. `elementFromPoint` at button centers returned the button (or a child), not a decorative overlay.

- Scan: `(228,833)` → self/child — `docs/app-audit-shots/01-landing.png`
- Sign in: `(1225,58)` → self/child
- Get started: `(1331,58)` → self/child

Sign in from landing opens the auth UI (`02-auth-on-landing.png`).

### Live scan
```
POST /api/scan { repoUrl: somo-platform }
→ HTTP 500 {"error":"spawnSync npx ENOBUFS"}
```
Recorded in `/tmp/audit-scan2.json` and reproduced (~24s wall time). This is a **blocker** for any real anonymous or signed-in scan through the running server.

### After a successful graph load (seeded)
Workspace opens on Layers (`03-after-scan.png`). **No signup modal** appears despite anon `persistError` on the seed payload. Auth modal markup is only rendered inside the landing branch (`App.tsx` early return `if (!graph && !loading)`), so `setShowAuthModal(true)` after `setGraph(...)` cannot paint.

### Anonymous scan limit
Server default `ANON_SCAN_LIMIT=2` (`webapp/server/src/scan.ts`). Count increments **only after** a successful `execFileSync`. While ENOBUFS persists, the limit **never fires** and the UI path that should show `You've used your free scan…` + auth modal was **not observable**.

---

## 2. Orphaned modals (⋮ menu)

Menu opens and lists: Share, Rename, Members, Activity log, Scan history, Snapshot timeline, Connect from GitHub (`04-workspace-menu.png`).

Every panel-opening item was clicked. **No modal/panel overlay appeared.** Screenshots remain on Layers:

| Item | Shot |
|------|------|
| Members | `05-menu-members.png` |
| Activity | `05-menu-activity.png` |
| Scan history | `05-menu-scan-history.png` |
| Snapshot | `05-menu-snapshot.png` |
| GitHub | `05-menu-github.png` |

**Classification:** **broken** (UI wired, mount orphaned to landing-only JSX) — not “not built.”

Auth modal after scan: same orphan class (**broken**).

---

## 3. Every view (seeded somo inventory)

| View | First paint | Console | Interactive notes |
|------|-------------|---------|-------------------|
| 2D | ~98ms | clean | RF nodes present |
| 3D | ~46ms chrome | flood of THREE/WebGL errors in headless | Canvas black / empty — `16b-3d-swiftshader.png` |
| Layers | ~26ms | clean | Agent switch changes Safety 4→0 |
| Standard | ~52ms | clean | Hot-edit reference model moves score 8/11→9/11 |
| Agents | ~66ms | clean | Renders |
| Reach | ~189ms | clean | ~485 reaches cells; click opens evidence (`11b-reach-cell.png`); scroll ~222ms |
| Resources | ~146ms | clean | Unclassified toggle; `patient` classify **writes** `resources.classify.json` |
| Guard | ~1005ms | clean | Save writes `reach.rules`; Re-check shows FAIL/PASS |

### Reach stress
- Large matrix renders; scroll remained interactive (~222ms for wheel burst).
- Cell click: `title="reaches at depth 0"` buttons (n=485); evidence panel shows tool/path chrome (`11b-reach-cell.png`).
- Deep path-vs-source correctness for a specific DB callsite was **not** fully proven against a checkout file in this pass (panel opened; hop-to-disk line audit not completed).

### Resources
- Rows present (`db:`/`external:` counts ~91–92).
- Blast-radius **label** not prominent in body text; list order is blast-sorted in implementation — treat “sort control” as default-sort **works**, explicit “Sort by blast” button **not observed**.
- Bulk/row classify via `patient` button: **disk changed** (`diskChanged=true`).

### Layers
- Eleven band labels present.
- Empty bands are loud (dashed “Missing — …” + why-it-matters) — `03-after-scan.png`.
- `unsearched` not observed on this dataset (0 mentions); cannot claim unsearched styling from this run.
- Agent switch Kelly vs retell: Safety filled(4) vs empty/Missing — **works**.

### Standard
Editing `webapp/client/public/reference-model.json` (`evaluation.whenSensitive` → `optional`) and remounting Standard changed **8 of 11 → 9 of 11** without a client rebuild (`14-standard-before.png`, `14-standard-after-edit.png`).

### Guard
- Save (non–“Sign in to save” button) persisted `# audit-probe-line` to repo-root `reach.rules`.
- Re-check re-evaluated; FAIL/PASS visible.

---

## 4. 3D after extraction

`docs/app-audit-shots/16b-3d-swiftshader.png`: 3D tab selected, legend/camera chrome visible, **main canvas black with no graph**. Headless Chromium also logged thousands of WebGL/THREE messages.

**Verdict:** **broken** for showing the scanned graph in this environment. A headed GPU re-check is still warranted, but the empty canvas with intact chrome is already a product failure signal, not merely a missing feature.

---

## 5. CI entrypoint (`scripts/check-reach-rules.ts`)

### somo clone
```
exit: 1
summary: { pass: 0, fail: 7, failNew: 7, failBaselined: 0, unevaluable: 0 }
evaluations: 7
sample display: "FAIL (86% of scope traced)"
JSON keys: ok, summary, evaluations, exitCode, ciLine, rules, confidenceOfReaches
```

### no-agent temp repo (`tmp-audit-empty-repo`)
```
exit: 0
summary: { pass: 1, fail: 0, failNew: 0, failBaselined: 0, unevaluable: 6 }
```
Did **not** crash. **UNEVALUABLE does not force exit 1** (six UNEVALUABLE, exit 0).

---

## 6. Extraction leftovers

| Item | Reachable in running UI? | Verdict |
|------|--------------------------|---------|
| `PathSearchBar.tsx` | No | **not built** (unmounted) |
| `SystemQuestionBar.tsx` | No | **not built** (unmounted) |
| NodePopup create-todo | No button on node select (`18b-node.png`) | **not built** in UI (route may still exist server-side) |
| Legend Jira `J` badge | **Yes** — legend shows `J`; `ArchCanvas.tsx:3230` | **leftover / broken** (user can see it) |
| `webapp/client/dist` tracked | Yes — 2 files in `git ls-files` | process smell |
| Server jira/todos/rails/greenfield/solo | HTTP responses 200/400/500 — **mounted** | API leftover; **not** clickable product UI except where other chrome still calls them |

---

## 7. Prototype features absent from product

Confirmed **absent** (not built):

1. **Flow view** — no toolbar button.
2. **No-agent empty state** — 0-agent seed still shows normal workspace chrome; no dedicated “No AI agent found” canvas.
3. **Anonymous gate bar** — no “you're viewing without an account / locked: …” strip in workspace.

Do not build these in this audit.

---

## Three things most likely to stop someone tomorrow

1. **Live scan is dead** — `spawnSync npx ENOBUFS` on `/api/scan` means nobody gets a real somo (or any) scan through the running app.
2. **Orphaned workspace modals** — Members, Activity, Scan history, Snapshots, Connect GitHub, and post-scan signup all no-op once a graph is loaded; the ⋮ menu looks alive and does nothing useful.
3. **3D shows an empty black stage** — after extraction, the 3D tab is a dead end for reading the scanned graph (`16b-3d-swiftshader.png`).
