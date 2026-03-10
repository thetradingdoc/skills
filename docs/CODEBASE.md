# Codebase Guide for Developers

**Last Updated:** March 2025

This guide helps new developers understand the architecture, where to find things, and how to work with the codebase.

---

## 1. What This Project Does

Architecture Visualizer is a tool that:

- **Scans** TypeScript/TSX repos to build a module dependency graph
- **Visualizes** the graph (2D ReactFlow or 3D) with layers, drift, and violations
- **Chats** about the architecture using AI (Claude)
- **Executes code changes** via “rails” — planned tasks that run in a sandbox, verify with lint/tests, then materialize after approval

See [PRODUCT_STATUS.md](./PRODUCT_STATUS.md) for current feature status and [TODO_AUDIT.md](./TODO_AUDIT.md) for tracked work.

---

## 2. Project Structure

```
arch-visualizer/
├── src/                      # Shared logic (extension + webapp)
│   ├── agent/                # Plan execution: taskRunner, toolExecutor, rails
│   ├── ai/                   # Manager, critic, enrichers, tools
│   ├── analyzer/             # Scanner, path resolver, arch rules
│   ├── analysis/             # graphAnalyser (shared)
│   ├── architecture/         # layerModel
│   └── extension.ts          # VS Code extension entry
├── webapp/
│   ├── client/               # React SPA (Vite, ReactFlow, Three.js)
│   ├── server/               # Express API (chat, rails, workspaces, scan)
│   └── shared/               # Shared utils (e.g. deriveProjectKey)
├── webview-ui/               # VS Code webview (React, ReactFlow)
├── scripts/                  # CLI tools: scan-repo, id-decorator, tests
├── fixtures/                 # Sample project for tests
├── supabase/migrations/      # Database schema
└── docs/                     # Documentation
```

---

## 3. Key Entry Points

| What | Where |
|------|-------|
| Web app server | `webapp/server/src/index.ts` |
| Web app client | `webapp/client/src/App.tsx` |
| VS Code extension | `src/extension.ts` |
| Chat API | `webapp/server/src/chat.ts` |
| Rail execution | `webapp/server/src/railExecute.ts` + `src/agent/taskRunner.ts` |
| Graph scanning | `src/analyzer/scanner.ts`, `webapp/server/src/scan.ts` |

---

## 4. Data Flow (High Level)

### Web App: Scan & Visualize

1. User scans a repo (GitHub URL or local path) → `POST /api/scan` or clone + scan
2. Server builds graph via `src/analyzer/scanner.ts` (ts-morph)
3. Graph + violations sent to client
4. Client renders with ReactFlow (2D) or Three.js (3D)

### Chat & Rails

1. User asks a question → `POST /api/chat-async`
2. Chat detects intents: analysis, execution, todo, greenfield
3. For analysis: `runArchitectureTask` → critic, violations, graph commands
4. For execution: picks ready todos → creates rails → triggers execute
5. Execute: plan → LLM code gen → `read_file` / `write_file` in sandbox → lint + Vitest + Playwright → approve → materialize

### Rails Pipeline

- **Create rail** — from violation (Fix Now), todo (To rail), or greenfield
- **Execute** — `taskRunner` runs code tasks, `verificationPipeline` runs lint/tests
- **Materialize** — applies staged changes to repo; `completeTodosForRail` marks todos done

---

## 5. Shared vs Duplicated Code

| Module | Locations | Notes |
|--------|-----------|-------|
| `graphAnalyser` | `src/analysis/`, `webapp/client/src/analysis/`, `webview-ui/src/analysis/` | Three copies; consider moving to `webapp/shared/` |
| `layerModel` | `src/architecture/`, `webapp/client/src/architecture/` | Same core logic |
| `layerPalette` | `webapp/client/`, `webview-ui/` | Same constants |
| `deriveProjectKey` | `webapp/shared/` | Centralized; client/server re-export |

---

## 6. Database (Supabase)

- **Workspaces** — project root, repo URL, Jira project key, auto-execute flag
- **Todos** — phase, depends_on, status, rail_id
- **Rails** — stored in `.agent/rails/` on disk; `rail_state_events` table for audit
- **Violations** — stored in DB; linked to workspaces and scans

Migrations live in `supabase/migrations/`. Run `scripts/verify-migrations.ts` to check applied state.

---

## 7. Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | LLM for chat and code generation |
| `APP_URL` | Base URL for verification (e.g. `http://localhost:4173`) |
| `RAIL_TOKEN_BUDGET` | Max tokens per rail (default 100k) |
| `RAIL_MAX_CONCURRENT` | Concurrent executions per workspace (default 1) |
| `MATERIALIZE_MAX_CHANGED_FILES` | Diff guard (default 200) |
| `SUPABASE_*` | Auth and DB for web app |

See `docs/ops/ENV.md` for full list.

---

## 8. Running & Testing

```bash
# Install
npm install
cd webapp/client && npm install
cd webapp/server && npm install  # if needed

# Web app
npm run webapp

# Extension dev
npm run dev:ext     # watch extension
npm run dev:webview # watch webview (separate terminal)
# F5 in VS Code → Extension Development Host

# Tests
npm test
```

---

## 9. Documentation Index

| Doc | Purpose |
|-----|---------|
| [CODEBASE.md](./CODEBASE.md) | This file — structure and flow |
| [PRODUCT_STATUS.md](./PRODUCT_STATUS.md) | Current features, APIs |
| [TODO_AUDIT.md](./TODO_AUDIT.md) | Tracked work, done vs pending |
| [current-implementation.md](./current-implementation.md) | Implementation details |
| [EXECUTION_PLAN.md](./EXECUTION_PLAN.md) | Agent execution phases |
| [ops/ENV.md](./ops/ENV.md) | Environment variables |

---

## 10. Conventions

- **Rails** — Agent work items; move through states (PRE_PLANNING → EXECUTING → VERIFYING → ARCHIVED)
- **Tasks** — Code units within a rail; `read_file` → LLM → `write_file` → staging
- **Materialize** — Apply staged changes to the repo after approval
- **Violations** — Architecture drift (e.g. layer rules); Fix Now creates a rail to address them
