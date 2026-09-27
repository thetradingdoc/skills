# Host Blanko on Railway (no custom domain)

Blanko runs as **one** Railway service: Express serves the Vite build and `/api` on the same host. You get a free URL like `https://blanko-production-xxxx.up.railway.app`.

## Prerequisites

- GitHub repo pushed (this branch or `main`)
- [Railway](https://railway.app) account
- Supabase project (URL + anon + service role)
- Railway CLI optional: `npm i -g @railway/cli` (or Volta/brew)

## A. Deploy from CLI (recommended)

From the **repo root**:

```bash
railway login
railway init          # create project, link this directory
railway up            # build Dockerfile + deploy
railway domain        # generate *.up.railway.app if not assigned
railway open          # open dashboard
```

After the first URL exists:

```bash
railway variables set APP_URL=https://YOUR-SERVICE.up.railway.app
railway up            # redeploy so share links / absolute URLs pick it up
```

Health check:

```bash
curl -s https://YOUR-SERVICE.up.railway.app/health
# {"ok":true}
```

## B. Deploy from GitHub (dashboard)

1. Railway → **New Project** → **Deploy from GitHub repo** → `arch-visualizer`
2. Root directory: repo root (Dockerfile + `railway.toml` already configure the build)
3. Open **Settings → Networking → Generate Domain**
4. Set variables (below), then redeploy

## Build-time variables (Vite)

These must be present during the Docker **client** build (Railway Variables are available as build args if named the same, or set explicitly under Variables — Railway injects them into the build environment):

| Variable | Required |
|----------|----------|
| `VITE_SUPABASE_URL` | yes |
| `VITE_SUPABASE_ANON_KEY` | yes |
| `VITE_STRIPE_PUBLISHABLE_KEY` | if billing UI |

If the image builds without them, the client will have empty Supabase config and auth will fail.

Dockerfile uses:

```dockerfile
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_STRIPE_PUBLISHABLE_KEY
```

On Railway, set those as service variables **before** the first successful production build. For Docker Hub-style builds, Railway passes matching env names as build-args when using their Dockerfile builder; if a build ships with blank Vite keys, add a Nixpacks/Docker “build arg” mapping in the service UI or rebuild after setting vars.

## Runtime variables (server)

| Variable | Required | Notes |
|----------|----------|--------|
| `APP_URL` | yes | Exact public HTTPS origin, no trailing slash |
| `SUPABASE_URL` | yes | Same project as `VITE_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server only |
| `PORT` | no | Railway sets this; image defaults to 8080 |
| `CLIENT_DIST_PATH` | no | Image sets `/app/webapp/client/dist` |
| `PROJECT_ROOT` | no | Image sets `/app` |

### Do **not** set in production

- `CHAT_DEV_BYPASS=1`
- `BILLING_DEV_UNLIMITED=1`
- `TERMINAL_ENABLED=1` (loopback-only; leave off on Railway)

### Optional

Stripe (`STRIPE_*`), GitHub App (`GITHUB_APP_*`, `GITHUB_WEBHOOK_SECRET`), OpenAI / LLM keys, `OWNER_USER_IDS`, etc. — see [ENV.md](./ENV.md).

Example:

```bash
railway variables set \
  APP_URL=https://YOUR-SERVICE.up.railway.app \
  SUPABASE_URL=https://xxxx.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  VITE_SUPABASE_URL=https://xxxx.supabase.co \
  VITE_SUPABASE_ANON_KEY=eyJ...
```

## Supabase Auth URLs

Authentication → URL configuration:

- **Site URL:** `https://YOUR-SERVICE.up.railway.app`
- **Redirect URLs:** `https://YOUR-SERVICE.up.railway.app/**` (keep `http://localhost:5174/**` for local)

## Webhooks (when you enable them)

| Provider | URL |
|----------|-----|
| Stripe | `https://YOUR-SERVICE.up.railway.app/api/billing/webhook` |
| GitHub App | `https://YOUR-SERVICE.up.railway.app/api/webhooks/github` |

## Local Docker smoke (optional)

```bash
docker build \
  --build-arg VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
  --build-arg VITE_SUPABASE_ANON_KEY="$VITE_SUPABASE_ANON_KEY" \
  -t blanko .
docker run --rm -p 8080:8080 \
  -e SUPABASE_URL -e SUPABASE_SERVICE_ROLE_KEY \
  -e APP_URL=http://localhost:8080 \
  blanko
curl -s http://localhost:8080/health
```

## Limits to expect

- **Ephemeral disk** — repo clones/scans do not survive redeploys; add a volume later if you need persistence
- **Terminal** — disabled / not for multi-tenant cloud
- **Migrations** — apply with Supabase CLI / scripts; Railway does not run SQL for you

## Files in this repo

| File | Role |
|------|------|
| [Dockerfile](../../Dockerfile) | Multi-stage client + server image |
| [railway.toml](../../railway.toml) | Dockerfile builder + `/health` check |
| [.dockerignore](../../.dockerignore) | Keeps build context small |
