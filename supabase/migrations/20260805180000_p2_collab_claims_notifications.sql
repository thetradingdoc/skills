-- P2 collab: section claims, notifications, github architecture events

-- Who owns which architecture section/node/layer
CREATE TABLE IF NOT EXISTS section_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('layer', 'node', 'section')),
  target_id TEXT NOT NULL,
  target_label TEXT,
  claimer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, kind, target_id)
);

CREATE INDEX IF NOT EXISTS section_claims_workspace_idx ON section_claims(workspace_id);
CREATE INDEX IF NOT EXISTS section_claims_claimer_idx ON section_claims(claimer_id);

ALTER TABLE section_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS section_claims_select ON section_claims;
CREATE POLICY section_claims_select ON section_claims
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

DROP POLICY IF EXISTS section_claims_insert ON section_claims;
CREATE POLICY section_claims_insert ON section_claims
  FOR INSERT WITH CHECK (
    claimer_id = auth.uid()
    AND EXISTS (
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

DROP POLICY IF EXISTS section_claims_delete ON section_claims;
CREATE POLICY section_claims_delete ON section_claims
  FOR DELETE USING (
    claimer_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspaces w
      WHERE w.id = workspace_id AND w.owner_id = auth.uid()
    )
  );

-- @mention notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'mention' CHECK (kind IN ('mention', 'assign', 'claim', 'system')),
  title TEXT NOT NULL,
  body TEXT,
  deep_link JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_update ON notifications
  FOR UPDATE USING (user_id = auth.uid());

-- GitHub → architecture PM bridge events
CREATE TABLE IF NOT EXISTS github_architecture_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('push', 'pull_request', 'scan')),
  sha TEXT,
  branch TEXT,
  pr_number INT,
  author_login TEXT,
  author_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  message TEXT,
  changed_paths TEXT[] NOT NULL DEFAULT '{}',
  matched_node_ids TEXT[] NOT NULL DEFAULT '{}',
  github_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS github_arch_events_workspace_idx
  ON github_architecture_events(workspace_id, created_at DESC);

ALTER TABLE github_architecture_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS github_arch_events_select ON github_architecture_events;
CREATE POLICY github_arch_events_select ON github_architecture_events
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
