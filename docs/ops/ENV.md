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

**Host on Railway (no custom domain):** see [RAILWAY.md](./RAILWAY.md).  
**Host on GCP Cloud Run (this org):** see [GCP_CLOUD_RUN.md](./GCP_CLOUD_RUN.md).

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

## Stripe billing (required to charge)

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Server secret (`sk_test_…` / `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `POST /api/billing/webhook` |
| `STRIPE_PRICE_PRO` | Price id for Pro |
| `STRIPE_PRICE_TEAM` | Price id for Team |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Client key for Payment Element (set in `webapp/client/.env`) |
| `FREE_SCAN_LIMIT_MONTHLY` | Free plan scan credits (default 5) |
| `FREE_DESIGN_MESSAGES_MONTHLY` | Free plan design/greenfield chat messages (default 20); analysis agent stays Pro/Team |
| `PRO_SCAN_CREDITS` / `TEAM_SCAN_CREDITS` | Included scan credits |
| `PRO_AI_CREDITS_CENTS` / `TEAM_AI_CREDITS_CENTS` | Included AI credit pool (cents) |
| `BILLING_DEV_UNLIMITED` | Set `1` for local: every user gets `canUseAiAgent` + `canUseDesignChat` + `canScan` (never in production) |
| `OWNER_USER_IDS` | Comma-separated user ids (e.g. `dev-bypass-user,<your-uuid>`) that always get unlimited entitlements |

Setup:

```bash
# From webapp/server (stripe package lives there)
cd webapp/server
set -a && source .env && set +a
NODE_PATH=./node_modules node --import tsx ../../scripts/stripe-setup-prices.ts
```

Customer Portal: Dashboard → Settings → Billing → Customer portal (cancel at period end + update/remove card), or created via API (`billingPortal.configurations`).

Webhooks: Dashboard endpoint `…/api/billing/webhook` (signing secret → `STRIPE_WEBHOOK_SECRET`), or local forward:

```bash
# Prefer sk_test_ for local; sk_live_ + stripe listen --live is flaky on some CLI versions
stripe listen --forward-to localhost:4000/api/billing/webhook
```

Apply billing migration (requires DB password from Project Settings → Database):

```bash
SUPABASE_DB_PASSWORD=… npx tsx scripts/apply-billing-migration.ts
# or: supabase db push   # if CLI login role works for your project
```

**Paid access is webhook-gated** — never trust client payment success alone.

---

## Trading middleware (separate product)

The Arch Visualizer repo and the trading middleware use **different** `.env` files.

**SSOT (runtime / paper / EOD):** `local:` in [`.blanko-target`](../../.blanko-target) → `~/Voice Agent/trading-agent`, port **4100**. See that repo’s `docs/trading/LOCAL_RUNTIME.md`.

**Blanko sandbox:** `scan-clone:` under `~/.arch-viz/repos/…`. After changing live trading code, sync:

```bash
npx tsx scripts/sync-blanko-scan-clone-from-local.ts
```

Part 1 / runtime checks use `TRADING_LIVE_ROOT` or `local:` (helper: `scripts/lib/blanko-target.ts`). Dogfood Approve stays on **scan-clone** so rails do not write into the live tree.

| Variable | Where it must live for trading |
|----------|--------------------------------|
| `FMP_KEY` | `middleware-platform/.env` (required for earnings panel / PIT). A copy may also exist in repo-root `arch-visualizer/.env`, but middleware does **not** load that file. |
| `TRADING_LIVE_ROOT` | Optional override of `.blanko-target` `local:` |
| `TRADING_API_URL` | Default `http://127.0.0.1:4100` |
| `BLANKO_TARGET_ROOT` | Optional force scan-clone path for sandbox-only harnesses |
| `VITE_CHAT_DEV_BYPASS` / `CHAT_DEV_BYPASS` | When `"1"`, Blanko client/server allow AI chat without signup (local audits) |
| `KELLY_PRIMARY_PROVIDER` | Trading middleware LLM primary (`groq` or `anthropic`); lives in trading `middleware-platform/.env` |

### Schema note: `workspaces.github_full_name`

Some Blanko DBs never migrated this column. Scan/connect/webhook writers soft-gate via `webapp/server/src/workspaceRepoMeta.ts` (still persist `repo_url` / `project_root`). Prefer adding the column when you can; until then lookups fall back to `repo_url`.

---

## GitHub App (platform-wide — one App for all tenants)

Blanko uses **one** GitHub App for install + webhooks across workspaces. Supabase GitHub OAuth stays for user sign-in / optional repo listing only — do **not** wire a second webhook path through OAuth.

Create the App in GitHub (Settings → Developer settings → GitHub Apps → New GitHub App), then set these **server** env vars (`webapp/server/.env`):

| Variable | Purpose |
|----------|---------|
| `GITHUB_APP_ID` | App ID from the GitHub App settings page |
| `GITHUB_APP_PRIVATE_KEY` | PEM private key (generate under the App; store full PEM, newlines ok as `\n`) |
| `GITHUB_APP_CLIENT_ID` | App client id (OAuth credentials on the App) |
| `GITHUB_APP_CLIENT_SECRET` | App client secret |
| `GITHUB_WEBHOOK_SECRET` | **The App’s webhook secret** (same secret GitHub shows on the App) — used by `POST /api/webhooks/github` HMAC verify |

### App permissions checklist

- [ ] **Contents** — Read-only  
- [ ] **Metadata** — Read-only (mandatory)  
- [ ] **Pull requests** — Read-only  

### Subscribed events checklist

- [ ] `push`  
- [ ] `pull_request`  
- [ ] `installation`  
- [ ] (recommended) `installation_repositories`  

### Webhook URL

```
https://<api-host>/api/webhooks/github
```

Examples: production `https://api.yourapp.com/api/webhooks/github`; local dogfood requires a public tunnel (see [LOCAL_DOGFOOD.md](./LOCAL_DOGFOOD.md)) — **hard blocker for Gate C**, not optional.

Handler: `webapp/server/src/githubWebhook.ts` (reuse this route; do not add a parallel webhook stack).

Legacy: `GITHUB_TOKEN` / `GITHUB_ACCESS_TOKEN` may still clone for non–App-linked workspaces. Gate C prefers installation tokens when `workspaces.github_installation_id` is set.

### Collaborate credit policy (Phase 3)

- **Webhook scans:** record `usage_events` with `source=scan`, `cost_cents=0` (free attribution). Do **not** consume Import `scan_credits`.
- **Agent Run:** records `usage_events` with `source=agent_run`; hard-stops when `usage_balances.ai_credits_cents <= 0`.
- Webhook matched nodes may enqueue Tasks with `source=github` (optional bridge).

### Out of scope

See [COLLABORATE_OUT_OF_SCOPE.md](./COLLABORATE_OUT_OF_SCOPE.md) (CODEOWNERS sync, Approve→PR, secrets vault, per-customer Apps).

## Optional

| Variable | Purpose |
|----------|---------|
| `ANON_SCAN_LIMIT` | Anonymous scan limit per IP per 24h (default: 2) |
| `DEBUG_AUTH` | Log auth API calls when `"1"` |
| `USE_MOCK_GREENFIELD` | Use mock greenfield enricher (no Claude) |
| `METRICS_LOG` | Log task and materialize metrics when `"1"` |
| `OPENAI_API_KEY` | Node embeddings for semantic search |
