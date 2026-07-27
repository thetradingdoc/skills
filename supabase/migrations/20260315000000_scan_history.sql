-- Scan history per workspace for architecture evolution tracking.
CREATE TABLE IF NOT EXISTS scan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  branch TEXT,
  commit_sha TEXT,
  ref TEXT,
  trigger TEXT CHECK (trigger IN ('manual', 'webhook', 'cron')),
  error_message TEXT,
  node_count INTEGER,
  edge_count INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  graph_id UUID,
  CONSTRAINT valid_completed CHECK (
    status <> 'completed' OR completed_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS scan_history_workspace_idx ON scan_history(workspace_id);
CREATE INDEX IF NOT EXISTS scan_history_started_idx ON scan_history(started_at DESC);

ALTER TABLE scan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY scan_history_select ON scan_history
  FOR SELECT
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    OR workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
