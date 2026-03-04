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

## Public Repos Only

Currently only **public** GitHub repositories work (no auth). Private repos will fail to clone.
