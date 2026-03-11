-- Soft-delete/archival for workspaces. When archived_at is set, workspace is hidden from default listing
-- and should not be auto-restored on refresh.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS workspaces_owner_archived_idx
  ON workspaces(owner_id) WHERE archived_at IS NULL;

