-- Todos and violations.rail_id schema enhancements

CREATE TABLE IF NOT EXISTS todos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text NOT NULL,
  description   text,
  phase         integer,
  depends_on    uuid[],
  status        text NOT NULL DEFAULT 'pending',
  rail_id       uuid,
  source        text,
  source_path   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

CREATE POLICY todos_owner_policy ON todos
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

CREATE INDEX IF NOT EXISTS todos_workspace_status_idx
  ON todos(workspace_id, status);

ALTER TABLE violations
  ADD COLUMN IF NOT EXISTS rail_id uuid;

CREATE INDEX IF NOT EXISTS violations_rail_id_idx
  ON violations(rail_id)
  WHERE rail_id IS NOT NULL;

-- Protect against self-dependencies in depends_on
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'todos_no_self_dependency'
  ) THEN
    ALTER TABLE todos
      ADD CONSTRAINT todos_no_self_dependency
      CHECK (NOT (id = ANY(COALESCE(depends_on, ARRAY[]::uuid[]))));
  END IF;
END $$;

-- updated_at trigger (shared function; safe to CREATE OR REPLACE)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS todos_updated_at ON todos;
CREATE TRIGGER todos_updated_at
  BEFORE UPDATE ON todos
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

