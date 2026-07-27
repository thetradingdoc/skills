-- Security: RLS hardening for workspace-scoped tables.
-- Ensures graphs, model_traces, agent_traces, and node_embeddings enforce workspace ownership.

-- graphs: if table exists, enable RLS and add policy
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'graphs') THEN
    ALTER TABLE graphs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS graphs_owner ON graphs;
    CREATE POLICY graphs_owner ON graphs
      USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
      WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));
  END IF;
END $$;

-- model_traces: workspace-scoped
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'model_traces') THEN
    ALTER TABLE model_traces ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS model_traces_owner ON model_traces;
    CREATE POLICY model_traces_owner ON model_traces
      USING (
        workspace_id IS NULL
        OR workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
      )
      WITH CHECK (
        workspace_id IS NULL
        OR workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
      );
  END IF;
END $$;

-- agent_traces: workspace-scoped
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_traces') THEN
    ALTER TABLE agent_traces ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS agent_traces_owner ON agent_traces;
    CREATE POLICY agent_traces_owner ON agent_traces
      USING (
        workspace_id IS NULL
        OR workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
      )
      WITH CHECK (
        workspace_id IS NULL
        OR workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
      );
  END IF;
END $$;

-- node_embeddings: workspace-scoped
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'node_embeddings') THEN
    ALTER TABLE node_embeddings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS node_embeddings_owner ON node_embeddings;
    CREATE POLICY node_embeddings_owner ON node_embeddings
      USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
      WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));
  END IF;
END $$;
