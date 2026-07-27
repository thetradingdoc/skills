-- graphs: stores scan output (graph_json) per workspace.
-- Referenced by shareRoutes, scan, violationStore, dependencyRisks, etc.
-- RLS policy in 20260313200000_security_rls_hardening.sql.

CREATE TABLE IF NOT EXISTS graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_json JSONB NOT NULL,
  repo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS graphs_workspace_id_idx ON graphs(workspace_id);
CREATE INDEX IF NOT EXISTS graphs_workspace_updated_idx ON graphs(workspace_id, updated_at DESC);
