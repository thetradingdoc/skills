-- Rails / todos hardening: triggers, constraints, and FKs.

-- Prevent changing workspace_id on todos after creation (RLS cannot reference OLD; use trigger).
CREATE OR REPLACE FUNCTION todos_prevent_workspace_id_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id THEN
    RAISE EXCEPTION 'workspace_id cannot be changed on todos';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS todos_immutable_workspace ON todos;
CREATE TRIGGER todos_immutable_workspace
  BEFORE UPDATE ON todos
  FOR EACH ROW
  EXECUTE FUNCTION todos_prevent_workspace_id_change();

-- updated_at trigger for rails (reuse set_updated_at from earlier migration).
DROP TRIGGER IF EXISTS rails_updated_at ON rails;
CREATE TRIGGER rails_updated_at
  BEFORE UPDATE ON rails
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- Constrain rails.state to known values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rails_state_check'
  ) THEN
    ALTER TABLE rails
      ADD CONSTRAINT rails_state_check
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
  END IF;
END $$;

-- Link violations.rail_id and todos.rail_id to rails(id).
-- Ensure columns exist (todos may predate 20260310090000 migration; CREATE TABLE IF NOT EXISTS skips entirely).
ALTER TABLE todos ADD COLUMN IF NOT EXISTS rail_id uuid;
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

