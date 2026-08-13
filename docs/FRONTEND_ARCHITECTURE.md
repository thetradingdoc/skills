# Frontend architecture — as built today

Audit date: 2026-08-06 (updated Phase 5 AI design canvas). Client `webapp/client` on `http://localhost:5174`, API on `http://localhost:4000`.

**Primary surface:** [AI design canvas](./AI_DESIGN_CANVAS.md) — compose and manage an agent system (Agent · RAG · Strategies · Channels). Architecture swimlanes are an optional lens. blanko does not execute n8n or edit Retell transitions.

Everything below marked **[verified]** was observed by driving the running app with Playwright.
Anything marked **[source]** was read from the code because it could not be reached at runtime
(signed-in surfaces — see [Signup is blocked in this environment](#signup-is-blocked-in-this-environment)).

Probes live in `scripts/fe-audit.spec.ts`, `scripts/fe-audit2.spec.ts`, `scripts/fe-audit3.spec.ts`, `scripts/blanko-ai-design-canvas.spec.ts`.
Re-run instructions are at the [bottom](#reproducing-this-audit).

---

## 1. Stack and build

| Concern | Choice |
| --- | --- |
| Framework | React 19 + TypeScript, function components only |
| Bundler / dev server | Vite 6, port 5174 |
| 2D canvas | `reactflow` 11 |
| 3D canvas | `three` + `@react-three/fiber` + `drei` + `postprocessing` |
| Layout engine | `elkjs` (aliased to `elk-api.js`, see `vite.config.ts`) |
| Auth + realtime | `@supabase/supabase-js` (direct from the browser) |
| Payments | `@stripe/react-stripe-js` (Payment Element) |
| Terminal | `@xterm/xterm` over a proxied websocket |
| Markdown / code | `react-markdown`, `react-syntax-highlighter` |
| Virtualisation | `@tanstack/react-virtual` |
| Styling | **Inline style objects only.** No CSS modules, no Tailwind, no styled-components. One global `index.css`. |

`vite.config.ts` proxies `/api` → `http://localhost:4000` with `ws: true`, so the browser only ever
talks to one origin, and the terminal websocket upgrade survives the proxy.

Size: **105 `.ts`/`.tsx` files**, ~37k lines in the flat `src/` root alone.

```
webapp/client/src/
├── App.tsx                 8,828 lines — the entire application shell
├── ArchCanvas.tsx          3,828 lines — React Flow canvas
├── Arch3DView.tsx            855 lines — three.js canvas
├── OnboardingChat.tsx        884 lines — signup wizard
├── <60 more *.tsx>                    — views, panels, modals
├── <29 *.ts>                          — pure logic: rules, exporters, catalogs, diffing
├── analysis/                          — graphAnalyser, graphInsights, blastRadius, pathSearch
├── architecture/layerModel.ts
├── layout/                            — elk / depth / domain / layer layouts, 2D→3D projection
└── utils/                             — safeStorage, deriveProjectKey
```

---

## 2. Routing and app shell

There is **no router library**. `main.tsx` does one string check on `window.location.pathname`:

```
/shared/:slug   →  <SharedView slug={slug} />     (public read-only workspace)
everything else →  <App />
```

Inside `<App />` there are no URL-driven routes at all. Every screen is a boolean or enum in React
state, so the URL never changes as you navigate, and there is no deep-linking or browser-back
support for any view. **[verified]** — the URL stayed `http://localhost:5174/` through all 14 tab
switches, the sign-in modal, the whole signup wizard, and the design canvas.

### The three top-level screens

| Screen | Condition | What it is |
| --- | --- | --- |
| Landing | `graph == null` | Marketing hero + import card |
| Workspace shell | `graph != null` | The IDE-like layout: left panel, canvas, right inspect |
| Shared view | pathname `/shared/*` | Separate component tree, read-only |

The workspace shell renders in one of two **modes**, and the mode is inferred from graph contents,
not from a route:

- **Design mode** — `isDesignGraph(graph)`, entered via *Design from scratch* or a blueprint fork.
- **Scan mode** — entered via *Import from GitHub*; the graph carries files, agents, and findings.

---

## 3. Landing page **[verified]**

![Landing page](frontend-audit/01-landing.png)

Single viewport-height hero. There is **no footer** — no links, no legal, no nav, nothing below the
fold. The page does not scroll.

### Header

| Control | Position | Behaviour |
| --- | --- | --- |
| `LITTLELABS` wordmark | top-left | Static text, not a link |
| `Home` | x≈865 | Renders, but see contrast note below |
| `About` | x≈940 | Clicking it produces no visible change |
| `Sign in` | x≈1023 | Opens the auth modal on the *Sign in* tab |
| `Get started` | x≈1114 | Opens the onboarding chat overlay |

> **Contrast defect.** `Home` and `About` compute to `color: rgba(245, 243, 238, 0.42)` — near-white
> cream at 42% alpha — on the light hero background. They occupy real space and accept clicks but
> are effectively invisible. Confirmed via `getComputedStyle` in `docs/frontend-audit/…` probe output
> and by their absence from the screenshot above.

### Hero

The word after "Design" cycles through `your code.` → `your systems.` → `your architecture.` →
`your future.` on a timer. The bracket glyphs `[ ]` frame it.

### Import card (bottom-left, `IMPORT EXISTING DESIGN`)

| Control | testid | Behaviour |
| --- | --- | --- |
| URL input | — | `type="url"`, placeholder `https://github.com/owner/repo` |
| `Import from GitHub →` | `landing-import-scan` | Starts a scan; requires auth + scan credit |
| `Design from scratch` | `design-from-scratch` | `createBlankDesignGraph("New Design")`, sets view to `2d`, enters the shell with an empty canvas. **Fires zero network requests.** |
| `Or start from a blueprint →` | `design-blueprint-gallery-toggle` | Expands the blueprint gallery |

### Blueprint gallery **[verified]**

![Blueprint gallery](frontend-audit/02-blueprints.png)

Toggle label flips to `Hide starting points ▴`. Five blueprints, each with a `Fork this design →`
button that calls `forkBlueprint()` from `designBlueprints.ts` and drops you straight into design
mode:

1. **Web app with auth and database** — "The classic shape: a frontend, an API behind auth, a database, and a cache."
2. **Multi-tenant SaaS** — "A subscription product with billing, a background worker for async work, and a queue so writes don't block requests."
3. **RAG agent** — "An AI agent that retrieves relevant context from a vector database before asking an LLM to answer, behind a normal API."
4. **Event-driven orders** — "Placing an order publishes an event that multiple independent workers react to."
5. **Mobile app with a BFF** — "A mobile client talks to a backend-for-frontend shaped around what the app screen needs."

> **Layout defect.** The expanded gallery panel is tall enough to overlap the `LITTLELABS` wordmark
> rather than pushing it or scrolling under it.

---

## 4. Authentication surfaces

### 4a. Sign-in modal **[verified — Phase 3 white]**

Opened by header `Sign in`, or by `Already have an account? Sign in` inside the onboarding chat.

White blanko card (`CANVAS`) over a blurred landing page — no dark-mode chrome:

- Bubbleboddy `blanko` mark in accent pink + `Welcome back`
- Segmented **Sign up** | **Sign in** toggle (paper track, white active). **Sign up** closes the modal and opens `OnboardingChat` (no duplicate form).
- Email / password fields, pink focus rings
- `Forgot password?` → `supabase.auth.resetPasswordForEmail`
- Ink primary **Sign in** → `supabase.auth.signInWithPassword`
- **Continue with GitHub** with colored GitHub mark → OAuth

### 4b. Onboarding chat — the primary signup **[verified — Phase 3 white]**

`OnboardingChat.tsx`. Full-screen **white** overlay titled `Get started`, with `Close`, `Already have an account? Sign in`, and a composer. Chat flow is unchanged: `greet → intent → email → profile → password → plan → pay → repo → done`.

**Step `intent`** — "What brings you in today?"

| Chip | testid | Plan it steers you toward |
| --- | --- | --- |
| Start designing | `onboarding-intent-design` | free |
| Explore a codebase | `onboarding-intent-explore` | free |
| Save and share architecture | `onboarding-intent-save` | pro |
| Collaborate with a team | `onboarding-intent-collaborate` | team |

**Step `email`** — `onboarding-email` + Send.

**Step `profile`** — first / last / `@nickname`, Continue.

**Step `password`** — password widgets + strength (never in chat bubbles).

**Step `plan`** — transparent pricing table (`onboarding-pricing-table`) shown **after** the recommendation copy, then Free / Pro / Team cards with “recommended for you”, ToS checkbox. Account is created on plan pick.

| Plan | Price | Notes |
| --- | --- | --- |
| Free | $0 | 20 design msgs + 5 scans/mo |
| Pro | $29/mo | 100 scan credits + $20 AI pool — Stripe Payment Element |
| Team | $79/mo | 500 scan credits + $100 AI pool — Stripe Payment Element |

**Step `pay`** — inline Stripe Payment Element (light appearance, blanko tokens). Free skips pay via `ensure-free`.

### 4c. View-first vs signup journeys (token guardrails)

| Journey | What happens |
| --- | --- |
| New user | Landing **Get started** / **Start designing** → OnboardingChat → plan (+ Stripe if paid) |
| Existing user | Landing **Sign in** → white auth modal → workspace |
| Import / blank canvas first | n8n preview or blank canvas **without account**; `guest-view-banner` (“Viewing free”); AI / Save / Share / materialize call `promptSignup` |
| Shared link | `/shared/:slug` read-only + **Get started free →** deep-links `/?get-started=1` into OnboardingChat |

Server: `/api/chat-async` and `/api/billing/*` return **401** without a bearer token.

Paid plans after plan pick: Free → `POST /api/billing/ensure-free`; Pro/Team → `POST /api/billing/create-subscription` then inline Stripe Payment Element (`onboarding-payment-element`).

> Docs note: older screenshots in `frontend-audit/03–06` may still show the pre-blanko dark chrome; live UI is white.

---

## 5. The workspace shell **[verified]**

![Design shell](frontend-audit/07-design-shell.png)

Three columns plus two stacked header rows. Layout is flexbox with a draggable divider
(`panelWidth` / `isResizing` state).

### 5a. Header row 1 — workspace bar

| Control | Behaviour |
| --- | --- |
| `Hide panel` / `Show panel` | Collapses the left panel to a 40px icon rail (`D`, `C`, `<>`). See [panel hidden](frontend-audit/16-panel-hidden.png). |
| Workspace title (`New Design`) | Click-to-rename, but only when `activeWorkspaceId && accessToken` — inert when signed out (`App.tsx:7172`) |
| `Save 🔒` | Pink when signed out; opens OnboardingChat via `promptSignup` (Phase 3). |
| `Share 🔒` | Same gate — viewing stays free, keep/share needs an account. |
| `Overview` \| `Learn` \| `Deep Dive` | Persona selector, `Persona = "overview" \| "learn" \| "deep_dive"`. Controls how much detail nodes and panels expose. `Learn` is the default. |
| `Search…` | Graph search box, filters/highlights nodes |
| `⋮` | Workspace overflow menu |

> Guest chrome also shows `guest-view-banner` (“Viewing free”) with **Get started free →**.

#### `⋮` overflow menu

![Overflow menu](frontend-audit/10-overflow-menu.png)

`Rename` · `Members` · `Activity log` · `Classify resources` · `Scan history` · `Snapshot timeline` ·
`Connect from GitHub` · ☑ `Remember on device` · ☐ `Scene editor` · `Export scene bundle…` ·
`Import scene bundle…`

Each opens a dedicated panel component (`WorkspaceMembersPanel`, `ActivityLogPanel`,
`ScanHistoryPanel`, `SnapshotSelectorPanel`, `ConnectGitHubModal`, `ResourcesView`).

### 5b. Header row 2 — view tabs

Fourteen view tabs, then a divider, then canvas controls. All of them set a single state value,
`graphViewMode`.

Narrative order intended by the code comment at `App.tsx:7877`: *what was found → what it reaches →
how complete it is → whether it meets the bar → what is enforced.*

| Tab | `graphViewMode` | Tooltip | Design mode? **[verified]** |
| --- | --- | --- | --- |
| Assessment | `assessment` | What this system is, and what matters | Placeholder |
| Agents | `agents` | Agent surfaces found in this repository | Placeholder |
| Files | `files` | Browse and read the code | Placeholder |
| Reach | `reach` | What each tool can touch | Placeholder |
| Flow | `flow` | How a request travels from caller to resource | Placeholder |
| Layers | `layers` | The eleven layers of this agent | Placeholder |
| Platforms | `platforms` | Real providers this architecture depends on | **Works** |
| Usage | `usage` | Token spend attributed to nodes and teammates | Needs sign-in |
| Rollup | `rollup` | Exec-readable ownership, findings, and spend by section | **Works** |
| DevOps | `devops` | Missing env vars and CI status per node | **Works** |
| Standard | `standard` | This agent against the reference model | Placeholder |
| Guard | `guard` | Rules and what would block a merge | Placeholder |
| Changes | `changes` | What moved since the last scan | Placeholder |
| Terminal | `terminal` | A shell in the scanned repository | Placeholder + "Sign in to open a terminal." |

"Placeholder" means `ScanOnlyPlaceholder` renders *"{Tab} isn't available in design mode / Available
after you import your repo."* The gate is a single hardcoded condition at `App.tsx:8480`:

```tsx
isDesignMode && graphViewMode !== "2d" && graphViewMode !== "3d"
  && graphViewMode !== "platforms" && graphViewMode !== "usage"
  && graphViewMode !== "rollup" && graphViewMode !== "devops"
```

![Scan-only placeholder](frontend-audit/17-scan-only-placeholder.png)

So **ten of the fourteen tabs are dead weight for a design-mode user**, and they are rendered at
full opacity with no visual hint that they will be empty until clicked.

#### The three that do work in design mode

**Platforms** — `PlatformInventoryView`. Reads `providerCatalog.ts` (31 providers) and reports which
real vendors the design implies. With four placed nodes it inferred five unbound providers
(Anthropic/Claude, AWS, LangChain, OpenAI, Stripe), each tagged `unbound` + `critical gap`. Filter
chips: All / Gaps / LLM / Framework / Cloud / Data / Observability / Third party / Voice. A
`Catalog preview` strip along the bottom shows every provider icon.

![Platforms](frontend-audit/11-tab-platforms.png)

**Rollup** — `ManagementRollupView`. Groups nodes by architectural layer into "sections", each with
owner status, open findings, GitHub activity, and 30-day spend. Filters: All / Hotspots / Unowned /
Past-due. With no account everything reads `unowned`, `0 open`, `$0.00 / 30d`.

![Rollup](frontend-audit/12-tab-rollup.png)

**DevOps** — `DevOpsHealthView`. Per-node env/CI readiness. Filters: All / Hotspots / Missing env.
Every node showed `UNKNOWN` / "No CI or env signal yet" with a `checked <time>` stamp.

![DevOps](frontend-audit/13-tab-devops.png)

### 5c. Canvas controls (right of the tab strip)

| Control | Behaviour |
| --- | --- |
| `2D` / `3D` | Swaps `ArchCanvas` (React Flow) for `Arch3DView` (three.js) |
| `canvas options ▾` | Expands a second control row — see below |
| `Export ▾` | Export menu |
| `Materialize` | `MaterializeDesignButton` — scaffolds the design into real artifacts |

**`canvas options ▾` expanded** reveals four grouped control sets:

![Canvas options](frontend-audit/08-canvas-options.png)

- **Colour mode:** `Arch` · `Domains` · `Runtime` · `Failure`
- **Layout:** `Depth` · `Domain` · `Elk`
- **Theme:** `Dark`
- The row shares space with `Export ▾` and `Materialize`.

**`Export ▾` menu** — two groups:

![Export menu](frontend-audit/09-export-menu.png)

| Group | Items |
| --- | --- |
| Graph exports | `Assessment`, `SVG`, `Doc`, `C4`, `Mermaid`, `PUML` |
| Design exports | `Design README`, `Design ADR`, `Design score`, `Design PNG` |

All ten are implemented client-side in `exporters.ts` — nothing hits the server. That matters for
the n8n work: **there is no server-side export path today.**

### 5d. Left panel

Three panel modes, selected by a segmented control at the bottom of the palette:
`Dashboard · Review` | `Chat` | `Files`.

Above the mode switcher, in design mode, sits the **component palette** (`DesignPalette.tsx` +
`DESIGN_PALETTE` from `greenfieldDesign.ts`) — 21 items in five groups. Instruction text:
*"Drag onto the canvas, or click to place. Hover a piece for what it does."* Each row is prefixed
with a three-letter layer tag.

| Group | Items (tag) |
| --- | --- |
| CORE | Frontend `Pre`, Mobile app `Pre`, API / Gateway `Pre`, Load balancer `Inf`, Auth `Saf` |
| DATA & STORAGE | Database `Dat`, Postgres `Dat`, Cache `Mem`, Redis `Mem`, Object storage (S3) `Inf` |
| MESSAGING | Queue `Inf`, Kafka `Inf`, Worker `Inf` |
| AI & AGENTS | Agent `Rea`, LLM `Rea`, Memory store `Mem`, Eval harness `Eva`, Vector DB `Mem` |
| EXTERNAL & OPS | External `Ext`, Stripe `Ext`, CDN `Inf` |

Below the palette: `Or start from a blueprint →`, then an `IMPORT EXISTING DESIGN` block repeating
the landing card's repo URL input and `Import from GitHub` button, then the mode switcher, then a
workspace switcher (`New workspace ▾`) pinned to the very bottom.

**Chat mode:**

![Left panel — chat](frontend-audit/14-left-chat.png)

Header reads `DESIGN` + a `BUILD ARCHITECTURE` pill, with `Export`, `Show thinking`, `Chat 1`,
`History`, and `+` controls. Prompt placeholder: *"Describe what to design, or drag components from
the palette onto the canvas."* A suggested prompt chip is pre-seeded ("Design a clean, modular
architecture for a new project from scratch. Add an API, a database, and auth."). Composer has a
📎 attachment button (PDF/DOCX — `pdfAttachment` / `docAttachment` state) and a green send arrow.

**Dashboard · Review mode:**

![Left panel — dashboard](frontend-audit/15-left-dashboard.png)

Two sub-tabs, `Review` (`design-dashboard-tab-review`) and `Plan` (`design-dashboard-tab-plan`).
Review shows a live `Design review` score — `100 / 100`, "No issues found. Keep adding pieces — the
review updates live." — computed by `evaluateDesign()` in `designRules.ts` (`DesignReviewPanel`).
Plan renders `DesignBuildPlanPanel` from `buildPlan.ts` (`planFromGraph` / `nextStep`), which is
what feeds the `What's next: Build "Database" — No dependencies — safe to build first.` banner.

**Files mode:** file browser + filter. Signed out it reads *"Sign in to see what the tool has changed."*

### 5e. Canvas overlays

The canvas is not just the graph. Floating cards sit on top of it:

- **Legend card** (left, always on): `Click to highlight` collapse toggle, `LAYERS` list with per-layer counts and a `Layers ON` toggle, `TECH FAMILIES` chips (DB, Cache, Queue, API, UI, K8s, SaaS), `NODE BADGES` key (V, TR, D, d), `RUNTIME HEATMAP` key (<100ms / 100–300ms / >300ms), `BY TYPE` edge key (Imports, Layer violation, Drift), and `FOCUS` → `Focus on selection`.
- **Empty state**: *"Empty workspace — Describe what you want in chat, or drag a component from the left palette onto the canvas."*
- **Node domain card** (appears on selection): domain, layer, roles, dependencies (↑ inbound / ↓ outbound), flows/total edges, blast radius, description.
- **`<Node> · ACTIVITY`** card with a `Sign in to claim` button — `NodeCollabMeta`, section claims.
- **`<Node> · LLMOPS`** card for AI nodes — `NodeLlmopsPanel`: Eval status, Traces, Prompt/config refs, and a `DRIFT / WARN` list (e.g. "No Memory node connected on the design graph").
- **Minimap** bottom-right.

### 5f. Right inspect panel

`DesignInspectPanel.tsx`. Opens on node selection, closes with `×`.

| Section | Content |
| --- | --- |
| `Label` | Editable text input |
| `WHAT THIS IS` | Plain-language definition from `designKnowledge.ts` |
| `WHY IT'S HERE` | Rationale |
| `USUALLY CONNECTS TO` | Chips (e.g. for LLM: `Agent`, `Vector DB`) + `+ Add usual neighbours` button that inserts them wired up |
| `WHAT BREAKS WITHOUT IT` | Failure-mode copy |
| `REAL TECHNOLOGIES` | e.g. "OpenAI API · Anthropic API · Google Gemini · Self-hosted (Ollama, vLLM)" |
| `Notes` | Free-text textarea, persisted on the node |
| `▸ Advanced` | Collapsed disclosure — provider binding (`design-inspect-provider`, account, status), prompt/config refs, deploy-health chip, and the polymorphic property form from `nodePropertySchemas.ts` |
| `Delete node` | Red destructive button |

This panel is the single best-designed part of the UI: it is the only place that teaches rather than
reports.

### 5g. Footer

**There is no application footer.** The bottom edge is occupied by whatever the current column
renders — the workspace switcher in the left panel, the `Catalog preview` strip in Platforms, the
minimap over the canvas. No status bar, no connection indicator, no save state, no legal links.

---

## 6. State and data flow

### The shape of the problem

`App.tsx` is a single 8,828-line component holding **110 `useState` hooks**, 40 `useCallback`s, and
32 `useEffect`s. There is no Redux, no Zustand, no React Context, no reducer. Every piece of state —
auth token, graph, selection, all fourteen view modes, every modal boolean, chat tabs, scene
playback, resize drag state — is a sibling `useState` in one function body, threaded down through
props.

The state clusters, roughly:

| Cluster | Representative state |
| --- | --- |
| Auth | `accessToken`, `authEmail`, `authPassword`, `authMode`, `authBusy`, `authStatus`, `signupPendingConfirmation`, `showAuthModal`, `showOnboardingChat` |
| Graph | `graph`, `selectedNode`, `selectedEdgeId`, `activeFilters`, `activeNodeFilters`, `graphSearch` |
| View | `graphViewMode`, `persona`, `sidebarTab`, `designDashboardTab`, `leftPanelCollapsed`, `panelWidth`, `isResizing` |
| Workspace | `activeWorkspaceId`, `savedWorkspaces`, `archivedWorkspaces`, `workspaceScene`, `workspaceAnnotations`, `activeWorkspaceIsOwner` |
| Chat | `chatTabs`, `activeChatId`, `activeThreadId`, `chatSessions`, `threadList`, `backgroundTasks`, `showThinkingPanel` |
| Canvas | `canvasTheme`, `canvasDensity`, `presentationMode`, `sceneEditMode`, `scenePlaying`, `scenePlaybackSpeed` |
| Panels | ~12 `show*Panel` / `show*Menu` booleans |
| Design | `greenfieldSessionId`, `pendingDesignIntent`, `agentGraphCommand`, `lastCriticResult`, `activeViolations` |

Only three custom hooks exist in the whole client:

- `useDesignGraphSync` — CRDT-lite last-write-wins graph sync + revision conflict handling
- `useWorkspacePresence` — Supabase realtime presence cursors
- `useSceneAnimation` — three.js frame callback

### Where the logic actually lives

The redeeming feature: substantial domain logic is already extracted into **pure, server-runnable
modules** with no React imports.

| Module | Responsibility |
| --- | --- |
| `greenfieldDesign.ts` | Palette definition, node/edge factories, command application |
| `designRules.ts` | Design-time rule engine → `DesignFinding[]` |
| `designKnowledge.ts` | The teaching copy behind the inspect panel |
| `buildPlan.ts` | Dependency-ordered build plan from a graph |
| `providerCatalog.ts` | 31-provider catalog + icon keys |
| `platformInventory.ts` | Graph → provider inventory with gap detection |
| `managementRollup.ts` | Graph → per-section ownership/cost rollup |
| `deployHealth.ts`, `llmopsDrift.ts`, `graphSync.ts`, `designMaterialize.ts`, `nodePropertySchemas.ts`, `findings.ts`, `scanDiff.ts`, `exporters.ts`, `assessment.ts`, `standardScorecard.ts` | ditto |
| `analysis/` | `graphAnalyser`, `graphInsights`, `blastRadius`, `pathSearch` |
| `layout/` | elk / depth / domain / layer layouts, 2D→3D projection |

Several of these are duplicated or near-duplicated on the server already (`graphSync`,
`designMaterialize`, `llmopsDrift`, `managementRollup`, `deployHealth`). `exporters.ts` and
`designRules.ts` are **client-only** and are the two the backend plan needs to lift into a shared
location.

### Persistence

Three layers, in this order:

1. `localStorage` via `utils/safeStorage.ts` — `workspaceGraph:<id>`, "Remember on device", panel widths.
2. Supabase JS directly from the browser — auth session, `profiles` table, realtime presence.
3. The Express API at `/api` for everything else.

### API surface consumed by the client

~60 distinct endpoints, all under `/api`:

```
auth/         config · me · debug-validate · github-connect
billing/      me · ensure-free · create-subscription · confirm-subscription · portal
workspaces/   (list) · archived · :id · :id/load · :id/save · :id/share · :id/restore
              :id/members · :id/activity · :id/annotations(/:id/comments) · :id/memories
              :id/threads(/:id/messages) · :id/scenes(/latest) · :id/views
              :id/graphs/:id · :id/graph-snapshots · :id/scan-history · :id/connect-repo
              :id/claims · :id/budgets · :id/usage · :id/usage/node/:id · :id/rollup
              :id/deploy-health · :id/llmops/drift · :id/nodes/:id/llmops(-ref) · :id/nodes/:id/collab
              :id/runtime/latest · :id/dependency-risks · :id/run-npm-audit · :id/github-events
scan · chat-async · chat-feedback · file-content · tasks/:id · shared/:slug
violations · violations/:id/dismiss · greenfield/session · greenfield/draft/:id
layers · layers/applicability · reach/rules · reach/baseline · reach/evaluate
resources/classify · notifications · design-materialize · metrics/agent · terminal (ws)
```

---

## 7. User journeys, as they behave today

### Journey A — anonymous visitor designs something **[verified end to end]**

```
Landing
  └─ "Design from scratch"          0 network calls
       └─ Workspace shell, design mode, empty canvas
            ├─ click palette items    nodes appear, still 0 network calls
            ├─ select a node          inspect panel + activity + LLMOps cards
            ├─ Platforms / Rollup / DevOps    work, computed client-side
            ├─ Assessment/Agents/Files/Reach/Flow/Layers/Standard/Guard/Changes/Terminal
            │                          → "isn't available in design mode"
            ├─ Usage                   → "Sign in to a workspace to see token usage."
            ├─ Export ▾ → any of 10    works, client-side
            ├─ Save 🔒                 nothing happens (bug above)
            └─ Share 🔒                → onboarding overlay, "Create an account to share this workspace."
```

The whole design experience is **fully local**. Not one request left the browser until the user hit
a gated action. That is a real strength — instant, no-signup try-before-you-buy — and it is also why
the work is silently lost on refresh, since only `localStorage` holds it.

### Journey B — signup **[verified up to the Supabase call]**

```
"Get started"  (or Share 🔒, or any promptSignup call site)
  └─ intent chip        → tailors copy + suggests a plan
       └─ email         → Send
            └─ profile  → first, last, @nickname → Continue
                 └─ password + confirm + strength → Continue
                      └─ plan cards + ToS checkbox
                           ├─ Free  → POST /auth/v1/signup → POST /api/billing/ensure-free → done
                           └─ Pro/Team → POST /auth/v1/signup
                                        → POST /api/billing/create-subscription
                                        → step "pay" → Stripe Payment Element → confirm
```

If a repo URL was pending when signup started, the wizard inserts a `repo` step
("Continue with <url>?") before `done`, then resumes the scan. `onComplete` hands
`{ accessToken, plan, continueRepo, startDesign }` back to `App`.

**Observed failure:** Supabase rejected both test email domains with
`Email address "…" is invalid`, the error rendered in `onboarding-error`, and the overlay dropped
the user back to the landing hero with no recovery affordance beyond re-opening the wizard.

### Journey C — sign in **[verified to the modal]**

```
Header "Sign in"  (or "Already have an account? Sign in" inside the wizard)
  └─ auth modal, SIGN IN tab
       ├─ email + password → supabase.auth.signInWithPassword → modal closes
       ├─ "Forgot password?" → supabase.auth.resetPasswordForEmail
       └─ "CONTINUE WITH GITHUB" → signInWithOAuth, redirectTo = window.location.origin
```

### Journey D — returning signed-in user **[source]**

`App` subscribes to `supabase.auth.onAuthStateChange`, sets `accessToken`, calls `ensureProfile()`
to backfill a `profiles` row if the email-confirmation redirect skipped it (`App.tsx:111`), then
loads `GET /api/workspaces`. The header gains `account-profile-btn` (→ `ProfileBillingPanel`) and
`notifications-bell` (→ `NotificationsBell`), and the padlocks disappear from Save and Share.

---

## 8. Findings

Ordered by how much they cost a user.

| # | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| 1 | High | `Save 🔒` is a no-op when signed out. The signup prompt exists but is unreachable because `onClick` returns before calling `handleSaveWorkspace`. | `App.tsx:7197` vs `:1938`; runtime probe recorded no overlay and no request |
| 2 | High | Anonymous design work lives only in `localStorage`. Combined with #1, the most likely first-session outcome is silent data loss. | Journey A, zero network calls |
| 3 | Medium | Ten of fourteen tabs render at full opacity in design mode and only reveal "isn't available in design mode" after a click. | All 14 tabs probed |
| 4 | Medium | `Home` and `About` are `rgba(245,243,238,0.42)` on a light background — invisible — and `About` does nothing when clicked. | `getComputedStyle` probe + screenshot |
| 5 | Medium | Two parallel auth implementations (modal `SIGN UP` tab and the chat wizard) that can drift apart. | `App.tsx:4166` and `OnboardingChat.tsx:277` |
| 6 | Medium | Signup fails on ordinary-looking email domains with an unrecoverable overlay dismissal. | `onboarding-error` text captured |
| 7 | Medium | No routing. No deep links, no browser back, nothing shareable except `/shared/:slug`. | URL unchanged across every interaction |
| 8 | Low | `App.tsx` is 8,828 lines with 110 `useState` hooks in one component. Every new feature widens the prop drilling. | Static count |
| 9 | Low | Blueprint gallery overlaps the wordmark when expanded. | Screenshot |
| 10 | Low | No application footer or status bar anywhere — no save state, no connection state, no legal links. | All screenshots |

### What this means for the n8n work

- The **canvas, palette, and inspect panel are the right foundation** — `DesignPalette` +
  `greenfieldDesign.ts` + `designKnowledge.ts` already express "component with meaning", which is
  exactly what an n8n node needs to become.
- **`providerCatalog.ts` is the integration bottleneck.** 31 providers today; n8n's native node set
  is in the hundreds. It must move server-side and grow before mapping is useful.
- **Exports are client-only.** A handover document generated on the server needs `exporters.ts`
  lifted into a shared module first.
- **Design mode already proves three server-backed views can run on a pure client graph**
  (Platforms, Rollup, DevOps). An imported n8n estate should light those three up immediately.
- **Nothing persists without an account, and the save path is broken.** Any n8n import flow has to
  fix #1 and #2 first, or imported estates will vanish the same way.

---

## Reproducing this audit

```bash
# terminal 1
npm run webapp:server        # API on :4000

# terminal 2
npm run webapp:client        # Vite on :5174

# terminal 3 — browsers live in the user cache, not the sandbox cache
PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" \
  npx playwright test scripts/fe-audit.spec.ts scripts/fe-audit2.spec.ts scripts/fe-audit3.spec.ts
```

Artifacts land in `/tmp/fe-audit`, `/tmp/fe-audit2`, `/tmp/fe-audit3` — one `.png` and one `.json`
per step. Each JSON carries the visible-control inventory with bounding boxes, text bucketed by
screen region, the API calls that step fired, and any console errors. `probe-log.txt` records, per
click, whether it was gated and what it requested.

Two probe caveats worth knowing before you trust a re-run:

- `getByRole("button", { name: X }).first()` is ambiguous here — the left panel and the header both
  have `Files` and `Chat` buttons. Pass 1 mis-attributed a Files click for this reason. Prefer
  coordinate clicks from `headerButtons()` or scope the locator to the header.
- The onboarding overlay is click-blocking. Pass 1's entire tab loop was invalidated because a
  `Share 🔒` click opened it and nothing dismissed it. `dismissOverlay()` in pass 2 fixes this.
