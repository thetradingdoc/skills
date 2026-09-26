# Skills

**Turn any agent architecture — a doc, or a one-line prompt — into a running,
memory-backed agent you can edit by voice and share as a link.**

Built for the **Harness Engineering & Model Wrangling Hackathon** with MongoDB
(Sept 26, 2026, NYC).

## What it does

1. Paste or upload a doc describing a system (architecture spec, README, design
   doc — anything), or just type a one-line prompt.
2. An LLM parses it into a visual graph of agents, tools, memory stores, and
   guardrails, rendered on an interactive canvas.
3. Edit the graph by **voice** — speak an instruction and watch the canvas
   update live.
4. Every generated agent's memory is backed by **MongoDB Atlas + Vector
   Search** — real semantic memory, not a mock.
5. Swap the reasoning model between **OpenAI** and **Anthropic** with one
   environment variable — no code changes.
6. Share a link and someone else opens the same canvas, live.

## A note on where this came from

Skills is built on top of an architecture-visualizatialready been
developing (originally for scanning and visualizing existing codebases). For
this hackathon, I extended it with:

- A MongoDB Atlas-backed memory layer for generated agents
- A provider switch between OpenAI and Anthropic for the graph-generation engine
- Markdown/doc import into the graph-generation pipeline
- Voice-driven graph editing

The canvas, chat interface, and repo-scanning engine predate the event; the
agent-memory, multi-provider, doc-import, and voice-editing layers were built
during it.

## Partners used

| Partner | How it's used |
|---|---|
| **MongoDB Atlas** | Vector Search-backed semantic memory for every generated agent |
| **OpenAI** | Graph-generation engine (doc/prompt → architecture graph); reasoning model for generated agents |
| **Anthropic** | Alternate graph-generation engine, swappable via `GREENFIELD_PROVIDER` |
| **OpenRouter** | Swappable model routing for generated agents |
| **ElevenLabs** | Voice input for live graph editing |

## Getting started

```bash
npm install
npm install --prefix webapp/server
npm install --prefix webapp/client

cp webapp/server/.env.example webapp/server/.env
cp webapp/client/.env.example webapp/client/.env
```

Fill in `webapp/server/.env`:
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — auth (free Supabase project)
- `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` — at least one required
- `GITHUB_TOKEN` — for scanning private repos
- `GREENFIELD_PROVIDER` — `openai` or `anthropic` (default: `anthropic`)

Fill in `webapp/client/.env`:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — same Supabase project

Then:
```bash
npm run webapp
```

Server on `:4000`, client on `:5174`.

## License

No license  yet — treat this as all-rights-reserved until one is
added.
