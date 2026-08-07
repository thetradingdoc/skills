-- Flow Tasks Kanban: per-agent board fields + issue kind

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS agent_file text,
  ADD COLUMN IF NOT EXISTS layer_id text,
  ADD COLUMN IF NOT EXISTS assignee_label text,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'task';

ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_kind_check;
ALTER TABLE todos
  ADD CONSTRAINT todos_kind_check
  CHECK (kind IN ('task', 'issue'));

CREATE INDEX IF NOT EXISTS idx_todos_workspace_agent_file
  ON todos (workspace_id, agent_file)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_todos_workspace_kind
  ON todos (workspace_id, kind)
  WHERE archived_at IS NULL;
