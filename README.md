# Architecture Visualizer

Live architecture map for your codebase — static analysis, AI enrichment, drift detection, and AI-assisted code changes via rails.

**New to the codebase?** See [docs/CODEBASE.md](docs/CODEBASE.md) for structure, data flow, and conventions.

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   cd webview-ui && npm install
   ```

2. **Configure secrets (optional)**
   ```bash
   cp .env.example .env
   # Add ANTHROPIC_API_KEY for live AI. Leave empty to use MockEnricher.
   ```

3. **Build**
   ```bash
   npm run build
   ```

4. **Run**

   **Web app:**
   ```bash
   npm run webapp
   ```
   Open the URL shown (e.g. http://localhost:5174). Sign in, create a workspace, scan a repo, use chat and rails. Add `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` for AI.

   **VS Code extension:**
   - Run `npm run compile` (or `npm run build`) so `out/extension.js` exists
   - Press **F5** in VS Code/Cursor to launch Extension Development Host (loads this repo as the extension)
   - In the new window: File → Open Folder → `fixtures/sample-project`
   - Press **Cmd+Shift+A** (Mac) or **Ctrl+Shift+A** (Windows/Linux) to open Architecture Map
   - **Verify activation:** Run **Developer: Show Running Extensions** and confirm `arch-visualizer` is listed; or install the built `.vsix` from the repo root (`npm run package` if available) and install via Extensions view

## Dev Loop

```bash
# Terminal 1: watch extension
npm run dev:ext

# Terminal 2: watch webview (HMR)
npm run dev:webview

# In VS Code: F5 to launch Extension Development Host
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `archVisualizer.anthropicApiKey` | — | Anthropic API key for semantic roles & Q&A. Omit to use MockEnricher. |
| `archVisualizer.projectRoot` | `.` | Project root for scanning (relative to workspace). |

## Environment

| Variable | Description |
|----------|-------------|
| `ARCH_TEST_MODE=1` | Force MockEnricher (no API calls). |
| `ARCH_FIXTURE_PATH` | Override scan root, e.g. `fixtures/sample-project`. |
| `ANTHROPIC_API_KEY` | Fallback for API key (prefer settings). |

## .context.md

Per-module context with frontmatter:

```yaml
---
role: Authentication Service
must-not-depend-on: [api, ui]
deprecated: false
---

# Auth Module
Handles JWT and session logic.
```

## .arch-rules.json

Cross-module rules at project root:

```json
{
  "rules": [{
    "id": "auth-no-api",
    "description": "Auth must not depend on API",
    "sourcePattern": "auth",
    "mustNotImportPattern": "api",
    "severity": "error"
  }]
}
```

## Testing

```bash
npm test
```

Uses MockEnricher by default. Set `ARCH_TEST_MODE=1` in CI.

## Docs for Contributors

| Doc | Purpose |
|-----|---------|
| [docs/CODEBASE.md](docs/CODEBASE.md) | Structure, entry points, data flow |
| [docs/PRODUCT_STATUS.md](docs/PRODUCT_STATUS.md) | Features, APIs |
| [docs/TODO_AUDIT.md](docs/TODO_AUDIT.md) | Tracked work |
| [docs/ops/ENV.md](docs/ops/ENV.md) | Environment variables |
