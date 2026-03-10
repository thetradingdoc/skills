-- Soft-delete/archival for todos. When archived_at is set, todo is hidden from default listing.

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS todos_workspace_archived_idx
  ON todos(workspace_id) WHERE archived_at IS NULL;
