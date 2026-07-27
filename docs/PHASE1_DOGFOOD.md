# Phase 1 dogfood checklist

Phase 1 is **not done** until one real task completes this loop on `/solo`.

## Prerequisites

1. Apply migrations:
   - `supabase/migrations/20260521000000_todos_phase1_agent_fields.sql`
   - `supabase/migrations/20260521000001_append_todo_session_log.sql`
2. Webapp server + client running (`npm run webapp`)
3. Workspace has a **scanned repo** (`project_root` set) — agent run needs a clone on disk
4. `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in `webapp/server/.env`

## Loop (one real task)

1. Open **http://localhost:5174/solo** (or your client URL + `/solo`)
2. Sign in
3. **Memories** — add 1–2 manual notes (optional but tests memory at run)
4. **Create task** with:
   - Title: a small real change in your repo
   - Context: why you're doing it
   - Constraints: e.g. "don't touch tests" or layer rules
   - Acceptance: 1–2 checkable lines
   - File scope: paths the agent may edit
5. **Run agent** — wait until status → **Needs review** (polls every 3s)
6. Read **Session log** — confirm **Ready to review** card lists changed files (+/− lines), not raw JSON blobs
7. **Reject** then **Run** again — should create a **new** rail (old `rail_id` cleared on reject)
8. **Approve** — status → **Done**
9. Verify change exists in the repo

## Trust questions (write answers)

- Did the log explain what happened without opening rails/debug tools?
- Was file scope respected (only scoped paths changed)?
- Did approve feel like a clear human gate?
- What was missing from the log or task form?

## If run fails

- Check server logs for `project_root` / scan errors
- Task may return to `todo` on execution error — see last `error` entry in session log
