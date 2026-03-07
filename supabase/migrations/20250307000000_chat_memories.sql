-- Chat threads and messages — persist chat history per workspace
-- conversation_snapshots — lightweight intent/outcome per exchange

-- chat_threads: one per conversation
CREATE TABLE IF NOT EXISTS chat_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New chat',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_threads_workspace_idx ON chat_threads(workspace_id);
CREATE INDEX IF NOT EXISTS chat_threads_updated_idx ON chat_threads(workspace_id, updated_at DESC);

-- chat_messages: messages within a thread
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON chat_messages(thread_id, created_at ASC);

-- conversation_snapshots: lightweight intent/outcome per exchange (for retrieval)
CREATE TABLE IF NOT EXISTS conversation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT,
  intent_summary TEXT NOT NULL,
  outcome_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_snapshots_workspace_idx ON conversation_snapshots(workspace_id);
CREATE INDEX IF NOT EXISTS conversation_snapshots_node_idx ON conversation_snapshots(workspace_id, node_id) WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_snapshots_created_idx ON conversation_snapshots(workspace_id, created_at DESC);

ALTER TABLE chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY chat_threads_owner ON chat_threads
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE POLICY chat_messages_owner ON chat_messages
  USING (thread_id IN (SELECT id FROM chat_threads WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())))
  WITH CHECK (thread_id IN (SELECT id FROM chat_threads WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())));

CREATE POLICY conversation_snapshots_owner ON conversation_snapshots
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));
