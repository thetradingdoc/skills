-- Rails metadata table for analytics/joins.

CREATE TABLE IF NOT EXISTS rails (
  id           uuid PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  outcome      text NOT NULL,
  archetype    text,
  state        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE rails ENABLE ROW LEVEL SECURITY;

CREATE POLICY rails_owner_policy ON rails
  USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS rails_workspace_state_idx
  ON rails(workspace_id, state);

