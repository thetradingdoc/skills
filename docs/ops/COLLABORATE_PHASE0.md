# Collaborate Phase 0 — Blanko-Lab ops checklist

Manual steps the agent cannot finish from this environment (GitHub UI + public tunnel). Complete these once, then Phase 1–2 code paths work against a live App.

## 1. Public webhook URL (hard blocker)

Local API is `http://localhost:4000`. GitHub cannot reach it without a tunnel.

```bash
# Terminal A — API must be up
npm run webapp

# Terminal B — tunnel (pick one)
ngrok http 4000
# or: cloudflared tunnel --url http://localhost:4000
```

Copy the `https://…` host. In **GitHub → Settings → Developer settings → GitHub Apps → Blanko-Lab**:

- Webhook **Active** = on
- Webhook URL = `https://<tunnel-host>/api/webhooks/github`
- Webhook secret = exact value of `GITHUB_WEBHOOK_SECRET` in `webapp/server/.env`
- Save → **Recent Deliveries** → Ping → expect **200** (not 401/503/timeout)

Tunnel URLs **rotate** when you restart ngrok/cloudflared — update the App Webhook URL each time for local dogfood.

## 2. Permissions & events

Repository permissions:

- Contents — Read
- Metadata — Read
- Pull requests — Read

Subscribe to events:

- Push
- Pull request
- Installation
- Installation repositories

**Where can this GitHub App be installed?** → Any account.

Callback URL: `http://localhost:5174` (add prod origin when you deploy).

Do **not** put App Client ID/Secret into Supabase Providers (that is a separate OAuth App for login).

## 3. Install + smoke

1. Blanko-Lab → **Install App** → your user/org → grant **richiejeremiah/trading-agent**.
2. In Blanko Ops Rollup confirm **Linked · richiejeremiah/trading-agent** (or Connect + pick that repo).
3. Push a commit to the repo.
4. App **Deliveries**: `push` → **200** (body must not be signature failure; `noWorkspace` means link mismatch).
5. Blanko: Scan history shows `trigger: webhook` and/or Rollup last-change updates.

## 4. Server env hygiene

| Var | Notes |
|-----|--------|
| `GITHUB_APP_ID` / `CLIENT_ID` / `CLIENT_SECRET` / `PRIVATE_KEY` | Used by Gate B/C install + tokens |
| `GITHUB_WEBHOOK_SECRET` | Must match App webhook secret |
| `GITHUB_TOKEN` | Legacy PAT for private clone until installation tokens (Gate C) — copy into `webapp/server/.env` |

After any `.env` edit: **fully restart** `npm run webapp` (`node --watch` does not reload env).

Optional: rotate App private key if the PEM was ever printed in a terminal log.

## 5. Local verify helpers

```bash
# Health
curl -s http://localhost:4000/health

# Webhook rejects bad signature
curl -s -X POST http://localhost:4000/api/webhooks/github \
  -H 'Content-Type: application/json' -H 'X-GitHub-Event: ping' -d '{}'
# → 401 Invalid signature when secret is configured

# App config (Gate B)
curl -s http://localhost:4000/api/github/app/config
# → {"configured":true,"slug":"blanko-lab",...}
```

### Agent note (this environment)

`ngrok` may return **403 Forbidden** from some sandboxed/CI hosts. Use a tunnel on your laptop, or point the App Webhook URL at a deployed API host. Code paths for Gate B/C do not require the tunnel until you dogfood live deliveries.

See also [LOCAL_DOGFOOD.md](./LOCAL_DOGFOOD.md), [ENV.md](./ENV.md) § GitHub App, and [COLLABORATE_OUT_OF_SCOPE.md](./COLLABORATE_OUT_OF_SCOPE.md).
