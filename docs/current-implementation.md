# Current Implementation — What the Code Does

**Last Updated:** March 2025

---

## 1. Overview

The codebase has two main surfaces:

1. **Web app** — React SPA + Express server. Sign in (Supabase), scan a GitHub repo or load a workspace, visualize the graph, chat, run rails, materialize changes.
2. **VS Code extension** — Uses the same core logic; scans a local folder, renders in a webview panel.

Both share `src/` (agent, AI, analyzer) and use the same graph model. The web app adds workspaces, todos, Jira, and rails execution.

---

## 2. Pipeline (What Happens When You Open the Map)

```
Scan → Drift detection → AI enrichment → Send to webview → ReactFlow render
```

1. **Scan** — `ts-morph` walks TypeScript/TSX files, collects imports, resolves path aliases (`@/`, `#lib/`, `~/`), and builds a graph of **modules** (folders) and **import edges**.
2. **Drift** — Reads `.context.md` and `.arch-rules.json`, marks edges that violate rules (e.g., `auth` must not import `api`).
3. **Enrich** — AI (Claude or MockEnricher) assigns semantic roles to modules (e.g., "JWT Auth Service").
4. **Send** — Extension posts the graph to the webview over `postMessage`.
5. **Render** — ReactFlow (or Three.js 3D) draws nodes (modules) and edges (imports); layout via `computeDepthLayout` and `computeLayerLayout`.

---

## 3. Will It Show an Image Like the Reference?

**Partially, but simpler.**

| Reference image | Current implementation |
|-----------------|------------------------|
| 3D isometric stacked nodes | Flat 2D nodes (rectangles) |
| Color-coded tops (green / yellow / red / blue) | Color by status: drift (red), deprecated (gray), default (dark) |
| Clusters / layers | Depth and layer layout group related nodes |
| Project list on left, Flow Observer stats on right | ReactFlow center, right panel (Project Overview, ModuleCard, AI Q&A) |
| Top Modules with counts (e.g., Products: 357) | **Not implemented** — no event/usage counts |
| Live / Replay / Heatmap | **Not implemented** |

So yes, it runs through the code and shows an architecture graph — modules and connections — but it is a 2D ReactFlow graph, not the full 3D-style visualization with runtime stats.

---

## 4. Main Functions in the Codebase

### Extension host (Node.js)

| Function / Module | Purpose |
|-------------------|---------|
| `activate()` | Registers `arch-visualizer.open` command. |
| `openPanel()` | Creates webview panel, starts watcher, calls `buildAndSendGraph`. |
| `buildAndSendGraph(rootPath)` | Runs scan → drift → enrich, sends graph to webview. |
| `scanProject(rootPath)` | Uses ts-morph to build raw graph (nodes = modules, edges = imports). |
| `detectDrift(graph)` | Applies `.context.md` and `.arch-rules.json`, marks drift edges. |
| `enrichGraph(graph)` | AI assigns roles to modules (Claude or MockEnricher). |
| `askAboutArchitecture(question, graph, nodeId?)` | AI answers architecture questions. |
| `resolveImportPath(specifier, fromFile, rootPath)` | Resolves `@/`, `#lib/`, `~/` via tsconfig. |
| `readContextFile(modulePath)` | Reads `.context.md` (role, must-not-depend-on, etc.). |
| `readArchRules(rootPath)` | Reads `.arch-rules.json`. |
| `ProjectWatcher` | Watches files with chokidar, triggers rescan on change. |

### Webview (React)

| Component / Module | Purpose |
|--------------------|---------|
| `App` | Layout, message handling, Project Overview, ModuleCard, AI Q&A textarea. |
| `ArchCanvas` | ReactFlow canvas, node/edge mapping, ELK layout. |
| `computeDepthLayout` / `computeLayerLayout` | Assign positions to nodes by depth and layer. |

---

## 5. Data Model

- **Node** = module (folder), e.g. `src/auth`, `src/api`, `lib`.
- **Edge** = import from one module to another.
- **Not modeled:** individual files, functions, or runtime events — only static import structure at module level.

---

## 6. Gaps vs. Vision

| Vision | Current |
|--------|---------|
| Web app | ✅ Implemented (React + Express) |
| Sign in | ✅ Supabase auth |
| Connect GitHub | ✅ Clone via URL; workspace project root |
| Chat with repo context | ✅ Chat + rails; agent has read_file/write_file |
| AI model | Claude (Anthropic) or MockEnricher |
| 3D / layered styling | 2D ReactFlow + optional 3D (Three.js) |

## 7. UX Review Loop

- **References:** iCraft README and player docs.
- **Target repos:** `doclittle-platform` and a small sample OSS backend.
- **Cadence:** run a visual UX review at least monthly.
- **Checklist per review:**
  - Compare 2D canvas layout against the iCraft-style reference screenshot.
  - Validate node density and readability at default zoom (no overlaps, icons legible).
  - Verify 3D scene readability for ~50, ~200, and ~500-node graphs (fps, clutter, selection clarity).
  - Capture at least 3–5 qualitative notes and 1–2 screenshots for before/after comparisons.
