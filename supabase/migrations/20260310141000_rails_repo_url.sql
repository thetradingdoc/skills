-- Rails: add repo_url for workspace/repo linkage.
-- Existing: workspace_id, violation_id, trigger_source, session_id, created_by, sandbox_path.

ALTER TABLE rails
  ADD COLUMN IF NOT EXISTS repo_url text;
