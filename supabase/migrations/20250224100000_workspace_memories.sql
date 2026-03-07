-- Workspace memories: insights and user-saved notes per workspace
-- Referenced by 20250225000000_analytics_tracing_schema.sql (ALTER) and 20250307000001 (superseded_at)

CREATE TABLE IF NOT EXISTS workspace_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL DEFAULT 'arch_insight',
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_memories_workspace_idx ON workspace_memories(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_memories_created_idx ON workspace_memories(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_memories_superseded_idx
  ON workspace_memories(workspace_id, superseded_at) WHERE superseded_at IS NULL;

ALTER TABLE workspace_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_memories_owner ON workspace_memories
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));
