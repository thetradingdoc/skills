-- Phase 1 solo agent workspace: agent-native todo fields + session_log

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS context text,
  ADD COLUMN IF NOT EXISTS constraints text,
  ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb,
  ADD COLUMN IF NOT EXISTS file_scope text[],
  ADD COLUMN IF NOT EXISTS session_log jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Migrate legacy statuses to Phase 1 enum
UPDATE todos SET status = 'todo' WHERE status = 'pending';
UPDATE todos SET status = 'done' WHERE status = 'completed';

ALTER TABLE todos DROP CONSTRAINT IF EXISTS todos_status_phase1_check;
ALTER TABLE todos
  ADD CONSTRAINT todos_status_phase1_check
  CHECK (status IN ('todo', 'in_progress', 'needs_review', 'done'));

ALTER TABLE todos ALTER COLUMN status SET DEFAULT 'todo';
