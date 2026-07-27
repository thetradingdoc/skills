-- workspace_system_models: persist latest SystemModel per workspace for AI reasoning and UI.

CREATE TABLE IF NOT EXISTS workspace_system_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  graph_id UUID REFERENCES graphs(id) ON DELETE SET NULL,
  system_model_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id)
);

CREATE INDEX IF NOT EXISTS workspace_system_models_workspace_id_idx ON workspace_system_models(workspace_id);

-- RLS: allow authenticated users with workspace access (via workspace_members or owner)
ALTER TABLE workspace_system_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_system_models_select ON workspace_system_models
  FOR SELECT USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY workspace_system_models_insert ON workspace_system_models
  FOR INSERT WITH CHECK (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','editor')
    )
  );

CREATE POLICY workspace_system_models_update ON workspace_system_models
  FOR UPDATE USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
      UNION
      SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('owner','editor')
    )
  );
