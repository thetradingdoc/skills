# Current Implementation — What the Code Does

**Last Updated:** February 2026

---

## 1. Overview

The codebase is a **VS Code / Cursor extension** (not a web app). It scans a **local workspace folder**, builds a module dependency graph, enriches it with AI, and renders it in a webview panel.

- **No GitHub connection** — Works only on locally opened folders.
- **No sign-in** — Nothing to log in to.
- **No web app** — Everything runs inside VS Code.

---

## 2. Pipeline (What Happens When You Open the Map)

```
Scan → Drift detection → AI enrichment → Send to webview → ReactFlow render
```

1. **Scan** — `ts-morph` walks TypeScript/TSX files, collects imports, resolves path aliases (`@/`, `#lib/`, `~/`), and builds a graph of **modules** (folders) and **import edges**.
2. **Drift** — Reads `.context.md` and `.arch-rules.json`, marks edges that violate rules (e.g., `auth` must not import `api`).
3. **Enrich** — AI (Claude or MockEnricher) assigns semantic roles to modules (e.g., "JWT Auth Service").
4. **Send** — Extension posts the graph to the webview over `postMessage`.
5. **Render** — ReactFlow draws nodes (modules) and edges (imports), with ELK.js layout in a Web Worker.

---

## 3. Will It Show an Image Like the Reference?

**Partially, but simpler.**

| Reference image | Current implementation |
|-----------------|------------------------|
| 3D isometric stacked nodes | Flat 2D nodes (rectangles) |
| Color-coded tops (green / yellow / red / blue) | Color by status: drift (red), deprecated (gray), default (dark) |
| Clusters / layers | ELK hierarchical layout groups related nodes |
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
| `computeLayout(graph)` | Web Worker runs ELK.js, returns node positions. |

---

## 5. Data Model

- **Node** = module (folder), e.g. `src/auth`, `src/api`, `lib`.
- **Edge** = import from one module to another.
- **Not modeled:** individual files, functions, or runtime events — only static import structure at module level.

---

## 6. Gaps vs. Vision

| Vision | Current |
|--------|---------|
| Web app | VS Code extension only |
| Sign in | None |
| Connect GitHub | None — local folder only |
| Chat with repo context | AI Q&A with graph context only (no raw file content) |
| OpenAI model | Claude (Anthropic) or MockEnricher |
| 3D / layered styling | 2D flat nodes |
