-- P6 LLMOps: eval runs, runtime traces, node prompt/config refs

CREATE TABLE IF NOT EXISTS eval_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  suite TEXT,
  status TEXT NOT NULL CHECK (status IN ('pass', 'fail', 'error')),
  score NUMERIC,
  threshold NUMERIC,
  metrics JSONB,
  run_url TEXT,
  commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eval_runs_workspace_node_idx
  ON eval_runs(workspace_id, node_id, created_at DESC);

ALTER TABLE eval_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eval_runs_select ON eval_runs;
CREATE POLICY eval_runs_select ON eval_runs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = w.id AND m.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS eval_runs_insert ON eval_runs;
CREATE POLICY eval_runs_insert ON eval_runs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = w.id
              AND m.user_id = auth.uid()
              AND m.role IN ('owner', 'editor')
          )
        )
    )
  );

CREATE TABLE IF NOT EXISTS runtime_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  trace_url TEXT,
  summary TEXT,
  latency_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS runtime_traces_workspace_node_idx
  ON runtime_traces(workspace_id, node_id, created_at DESC);

ALTER TABLE runtime_traces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS runtime_traces_select ON runtime_traces;
CREATE POLICY runtime_traces_select ON runtime_traces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = w.id AND m.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS runtime_traces_insert ON runtime_traces;
CREATE POLICY runtime_traces_insert ON runtime_traces
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = w.id
              AND m.user_id = auth.uid()
              AND m.role IN ('owner', 'editor')
          )
        )
    )
  );

CREATE TABLE IF NOT EXISTS node_llmops_refs (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  prompt_ref TEXT,
  config_ref TEXT,
  memory_node_id TEXT,
  eval_node_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, node_id)
);

ALTER TABLE node_llmops_refs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS node_llmops_refs_select ON node_llmops_refs;
CREATE POLICY node_llmops_refs_select ON node_llmops_refs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = w.id AND m.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS node_llmops_refs_write ON node_llmops_refs;
CREATE POLICY node_llmops_refs_write ON node_llmops_refs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = w.id
              AND m.user_id = auth.uid()
              AND m.role IN ('owner', 'editor')
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM workspace_members m
            WHERE m.workspace_id = w.id
              AND m.user_id = auth.uid()
              AND m.role IN ('owner', 'editor')
          )
        )
    )
  );
