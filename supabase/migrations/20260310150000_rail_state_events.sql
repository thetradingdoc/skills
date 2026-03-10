-- Audit log for rail state transitions.
-- Code writes to this table from railsRoutes.ts; this migration creates the schema.

CREATE TABLE IF NOT EXISTS rail_state_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rail_id     text NOT NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  from_state  text,
  to_state    text NOT NULL,
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rail_state_events_rail_id_idx
  ON rail_state_events(rail_id);

CREATE INDEX IF NOT EXISTS rail_state_events_workspace_id_idx
  ON rail_state_events(workspace_id);

CREATE INDEX IF NOT EXISTS rail_state_events_created_at_idx
  ON rail_state_events(created_at);

ALTER TABLE rail_state_events ENABLE ROW LEVEL SECURITY;

-- Only workspace owners can read their rail state events.
CREATE POLICY rail_state_events_select ON rail_state_events
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  );
