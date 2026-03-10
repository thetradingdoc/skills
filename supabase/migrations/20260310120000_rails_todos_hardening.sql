-- Rails / todos hardening: triggers, constraints, and FKs.

-- Prevent changing workspace_id on todos after creation.
CREATE POLICY todos_immutable_workspace_update ON todos
  FOR UPDATE
  USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id = OLD.workspace_id
  );

-- updated_at trigger for rails (reuse set_updated_at from earlier migration).
DROP TRIGGER IF EXISTS rails_updated_at ON rails;
CREATE TRIGGER rails_updated_at
  BEFORE UPDATE ON rails
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Constrain rails.state to known values.
ALTER TABLE rails
  ADD CONSTRAINT IF NOT EXISTS rails_state_check
  CHECK (state IN (
    'PRE_PLANNING',
    'PLANNING',
    'AWAITING_APPROVAL',
    'EXECUTING',
    'AWAITING_HITL',
    'VERIFYING',
    'SELF_CORRECTING',
    'MATERIALIZING',
    'ARCHIVED',
    'SUSPENDED',
    'FAILED'
  ));

-- Link violations.rail_id and todos.rail_id to rails(id).
ALTER TABLE violations
  DROP CONSTRAINT IF EXISTS violations_rail_id_fkey;

ALTER TABLE todos
  DROP CONSTRAINT IF EXISTS todos_rail_id_fkey;

ALTER TABLE violations
  ADD CONSTRAINT violations_rail_id_fkey
  FOREIGN KEY (rail_id) REFERENCES rails(id) ON DELETE SET NULL;

ALTER TABLE todos
  ADD CONSTRAINT todos_rail_id_fkey
  FOREIGN KEY (rail_id) REFERENCES rails(id) ON DELETE SET NULL;

