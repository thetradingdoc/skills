-- Todos: ensure full source traceability for greenfield, violation, and rail linkage.
-- Existing: phase, depends_on, source, source_path, rail_id.

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS source_node_id text,
  ADD COLUMN IF NOT EXISTS source_violation_id uuid REFERENCES violations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS todos_source_node_id_idx
  ON todos(workspace_id, source_node_id) WHERE source_node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS todos_source_violation_id_idx
  ON todos(source_violation_id) WHERE source_violation_id IS NOT NULL;
