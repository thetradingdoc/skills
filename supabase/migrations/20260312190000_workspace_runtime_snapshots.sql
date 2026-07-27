-- Workspace runtime snapshots: OTEL-inspired metrics mapped onto nodes/edges.

CREATE TABLE IF NOT EXISTS workspace_runtime_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_runtime_snapshots_workspace_idx
  ON workspace_runtime_snapshots(workspace_id, recorded_at DESC);

ALTER TABLE workspace_runtime_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_runtime_snapshots_owner ON workspace_runtime_snapshots
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

