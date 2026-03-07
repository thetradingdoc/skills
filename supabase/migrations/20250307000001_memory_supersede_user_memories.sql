-- Memory conflict: superseded_at for workspace_memories
ALTER TABLE workspace_memories
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS workspace_memories_superseded_idx
  ON workspace_memories(workspace_id, superseded_at) WHERE superseded_at IS NULL;

-- Cross-workspace: user-level memories (preferences, patterns)
CREATE TABLE IF NOT EXISTS user_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  memory_type TEXT NOT NULL DEFAULT 'user_preference',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_memories_user_idx ON user_memories(user_id);
CREATE INDEX IF NOT EXISTS user_memories_created_idx ON user_memories(user_id, created_at DESC);

ALTER TABLE user_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_memories_owner ON user_memories
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
