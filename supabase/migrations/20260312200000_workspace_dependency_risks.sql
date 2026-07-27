-- Per-workspace dependency risk snapshots (supply-chain risk).

CREATE TABLE IF NOT EXISTS workspace_dependency_risks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tool TEXT NOT NULL, -- e.g. "npm-audit", "snyk"
  source TEXT,        -- optional: package.json path, lockfile, etc.
  report_json JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_dependency_risks_workspace_idx
  ON workspace_dependency_risks(workspace_id, created_at DESC);

ALTER TABLE workspace_dependency_risks ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_dependency_risks_owner ON workspace_dependency_risks
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

