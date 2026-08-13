-- P5: workspace usage events + budgets for token/cost attribution

CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL CHECK (source IN ('chat', 'scan', 'greenfield', 'provider_api', 'app_credit', 'manual')),
  provider_id TEXT,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  model_trace_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS usage_events_workspace_idx
  ON usage_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_node_idx
  ON usage_events(workspace_id, node_id)
  WHERE node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS usage_events_user_idx
  ON usage_events(workspace_id, user_id)
  WHERE user_id IS NOT NULL;

ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_events_select ON usage_events;
CREATE POLICY usage_events_select ON usage_events
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

DROP POLICY IF EXISTS usage_events_insert ON usage_events;
CREATE POLICY usage_events_insert ON usage_events
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

CREATE TABLE IF NOT EXISTS budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('workspace', 'section', 'node')),
  target_id TEXT,
  limit_cents INTEGER NOT NULL CHECK (limit_cents >= 0),
  period TEXT NOT NULL DEFAULT 'monthly' CHECK (period IN ('monthly', 'weekly')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, kind, target_id, period)
);

CREATE INDEX IF NOT EXISTS budgets_workspace_idx ON budgets(workspace_id);

ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budgets_select ON budgets;
CREATE POLICY budgets_select ON budgets
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

DROP POLICY IF EXISTS budgets_write ON budgets;
CREATE POLICY budgets_write ON budgets
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
