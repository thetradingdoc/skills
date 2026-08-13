# Local dogfood — GitHub App webhooks

## Ops prerequisite (hard blocker for Gate C)

Gate C dogfood (**Install App → link repo → push → scan / Rollup last-change**) requires GitHub to reach your local API over **HTTPS**. Without a tunnel, webhooks never arrive and Track 1 acceptance cannot pass — this is **not optional**.

## Setup

1. Run the Blanko API locally (default port **4000**):

   ```bash
   npm run webapp
   # or: cd webapp/server && npm run dev
   ```

2. Expose `POST /api/webhooks/github` with a tunnel:

   **cloudflared**

   ```bash
   cloudflared tunnel --url http://localhost:4000
   ```

   **ngrok**

   ```bash
   ngrok http 4000
   ```

3. In the GitHub App settings, set **Webhook URL** to:

   ```
   https://<tunnel-host>/api/webhooks/github
   ```

   Example: `https://abc123.ngrok-free.app/api/webhooks/github`

4. Set `GITHUB_WEBHOOK_SECRET` in `webapp/server/.env` to the **same** secret as the GitHub App webhook secret. Restart the API after changing env.

5. Confirm the App permissions/events checklist in [ENV.md](./ENV.md) (Contents/Metadata/PRs read; `push`, `pull_request`, `installation`).

## Smoke check

- Deliver a test ping from the GitHub App webhook settings (or push to a linked repo).
- API should return **200** (ignored for ping / installation until Gate C; scan path for `push` / `pull_request` when a workspace matches `github_full_name`).
- Invalid signature → **401**. Missing `GITHUB_WEBHOOK_SECRET` → **503**.

## Related

- Env vars and App creation checklist: [ENV.md](./ENV.md) § GitHub App  
- Handler: `webapp/server/src/githubWebhook.ts`
