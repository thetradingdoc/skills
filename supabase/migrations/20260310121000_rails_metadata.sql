-- Rails metadata columns for analytics and workspace joins.

ALTER TABLE rails
  ADD COLUMN IF NOT EXISTS trigger_source text,
  ADD COLUMN IF NOT EXISTS violation_id uuid REFERENCES violations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS sandbox_path text;

