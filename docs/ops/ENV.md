# Environment Variables — Operations & Verification

Required and optional environment variables for the Arch Visualizer webapp server.

## Critical for Verification & Share Links

### `APP_URL`

**Purpose:** Base URL where the web app is reachable. Used for share links, Playwright verification, and any absolute-URL generation.

**Examples:**
- Local dev: `http://localhost:4173` (or your Vite preview port)
- Staging: `https://staging.yourapp.com`
- Production: `https://yourapp.com`

**Enforcement:** If unset, the server logs:
```
[shareRoutes] APP_URL not set — share links may have incorrect base URL
```
Share links then fall back to `req.headers.origin`, which may be wrong behind proxies.

**Where used:**
- `shareRoutes`: Share link generation
- `runPlaywrightTrace` / `runPlaywrightForRail`: UI verification against the correct host
- `materialize.ts`: Base URL for Playwright
- `railExecute.ts`: Base URL for execution

**Recommendation:** Set `APP_URL` in production and staging. For local dev, ensure it matches your Vite preview URL (e.g. `http://localhost:5174`).

---

### Related Verification Env

| Variable | Purpose |
|----------|---------|
| `APP_URL` | Base URL for Playwright and share links (see above) |
| `PROJECT_ROOT` | Repo root for scripts (default: parent of webapp/server) |
| `PROJECTS_BASE_DIR` | Restrict materialize/clone to this base path (dev: unset) |
| `RAIL_STALE_MAX_AGE_MS` | Age threshold for stale rail recovery (default: 1h) |
| `RAIL_MAX_CONCURRENT` | Max concurrent rails per workspace (default: 1) |

---

## Auth & Data

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for admin operations |

---

## Optional

| Variable | Purpose |
|----------|---------|
| `ANON_SCAN_LIMIT` | Anonymous scan limit per IP per 24h (default: 2) |
| `DEBUG_AUTH` | Log auth API calls when `"1"` |
| `USE_MOCK_GREENFIELD` | Use mock greenfield enricher (no Claude) |
| `METRICS_LOG` | Log task/materialize metrics when `"1"` |
| `OPENAI_API_KEY` | Node embeddings for semantic search |
