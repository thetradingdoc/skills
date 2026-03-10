# Architecture Visualizer — Web App

Connect a GitHub repo and visualize its architecture with a chat assistant.

## Quick Start

1. **Configure .env** (create from .env.example if needed):

   ```bash
   # Required for private repos
   GITHUB_TOKEN=ghp_...
   # Required for chat
   OPENAI_API_KEY=sk-...
   ```

2. **Install dependencies** (from project root):

   ```bash
   npm install
   npm install --prefix webapp/server
   npm install --prefix webapp/client
   ```

3. **Run the webapp**:

   ```bash
   npm run webapp
   ```

   This starts:
   - API server at http://localhost:4000
   - Client at http://localhost:5174

4. **Open** http://localhost:5174, paste a GitHub repo URL (e.g. `https://github.com/owner/repo`), and click **Scan repository**.

## Chat

Add `OPENAI_API_KEY` to `.env` to enable the chat. Without it, the chat will show an error when you try to ask a question.

## Violation Re-Scan Trigger (Cron/Webhook)

To trigger violation re-scans externally (e.g. from cron or GitHub Actions):

1. Set `VIOLATION_SCAN_TRIGGER_SECRET` in your environment.
2. `POST /api/violations/scan-trigger` with:
   - Header: `X-Scan-Trigger-Secret: <secret>` or `Authorization: Bearer <secret>`
   - Body: `{ "workspaceId": "<workspace-uuid>" }`
3. Cron example:
   ```bash
   curl -X POST -H "X-Scan-Trigger-Secret: $SECRET" -H "Content-Type: application/json" -d '{"workspaceId":"..."}' https://your-api/api/violations/scan-trigger
   ```

## Public Repos Only

Currently only **public** GitHub repositories work (no auth). Private repos will fail to clone.
