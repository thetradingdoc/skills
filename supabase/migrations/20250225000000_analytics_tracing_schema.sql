-- Analytics / tracing schema for Arch Visualizer
-- Aligns model_traces, workspace_memories, agent_traces, and node_embeddings
-- with the fields used in chat.ts, workspaces.ts, and metrics.ts.

-- model_traces: add columns used by chat.ts & /api/metrics/agent
ALTER TABLE model_traces
  ADD COLUMN IF NOT EXISTS node_id TEXT,
  ADD COLUMN IF NOT EXISTS agent_model TEXT,
  ADD COLUMN IF NOT EXISTS critic_model TEXT,
  ADD COLUMN IF NOT EXISTS langsmith_url TEXT;

-- workspace_memories: align with chat.ts & workspaces.ts
-- (We keep any existing summary/session_id columns; migration does not drop or rename.)
ALTER TABLE workspace_memories
  ADD COLUMN IF NOT EXISTS node_id TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS memory_type TEXT;

-- agent_traces: add columns used by chat.ts
ALTER TABLE agent_traces
  ADD COLUMN IF NOT EXISTS node_id TEXT,
  ADD COLUMN IF NOT EXISTS trace_id TEXT,
  ADD COLUMN IF NOT EXISTS run_type TEXT,
  ADD COLUMN IF NOT EXISTS payload JSONB;

-- node_embeddings: upsert in nodeEmbeddings.ts relies on (workspace_id, node_id) being unique
CREATE UNIQUE INDEX IF NOT EXISTS node_embeddings_workspace_node_idx
  ON node_embeddings(workspace_id, node_id);

