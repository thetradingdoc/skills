-- Per-workspace auto-execute toggle for rails/todos execution.
-- When false, auto-rails-and-execute / auto-execute-ready must refuse to start new executions.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS auto_execute_enabled BOOLEAN NOT NULL DEFAULT FALSE;

