-- Base tables for analytics/tracing — created before 20250225000000_analytics_tracing_schema.sql (which ALTERs them)
-- pgvector required for node_embeddings.embedding
CREATE EXTENSION IF NOT EXISTS vector;

-- model_traces: LLM call metadata (chat, critic)
CREATE TABLE IF NOT EXISTS model_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  question TEXT,
  node_id TEXT,
  agent_model TEXT,
  critic_model TEXT,
  agent_latency_ms INTEGER,
  agent_prompt_tokens INTEGER,
  agent_completion_tokens INTEGER,
  critic_latency_ms INTEGER,
  critic_prompt_tokens INTEGER,
  critic_completion_tokens INTEGER,
  critic_score TEXT,
  langsmith_url TEXT,
  agent_graph_commands JSONB,
  agent_violations JSONB,
  agent_answer TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS model_traces_workspace_idx ON model_traces(workspace_id);
CREATE INDEX IF NOT EXISTS model_traces_created_idx ON model_traces(created_at DESC);

-- agent_traces: lightweight run metadata
CREATE TABLE IF NOT EXISTS agent_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  node_id TEXT,
  trace_id TEXT,
  run_type TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_traces_workspace_idx ON agent_traces(workspace_id);

-- node_embeddings: vector embeddings for semantic search (OpenAI ada-002, 1536 dims)
CREATE TABLE IF NOT EXISTS node_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, node_id)
);

CREATE INDEX IF NOT EXISTS node_embeddings_workspace_idx ON node_embeddings(workspace_id);
