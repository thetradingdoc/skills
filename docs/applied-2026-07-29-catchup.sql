-- Applying four migrations that exist as files but were never run against
-- this project. Discovered because workspace_members was absent, which meant
-- no workspace could have a second member, and scan_history was absent, which
-- meant every scan history insert failed silently.


-- ===== 20260314000000_collab_workspace_members.sql =====
-- Workspace members: owner/editor/viewer roles for collaboration.
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS workspace_members_workspace_idx ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_members_select ON workspace_members
  FOR SELECT
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    OR user_id = auth.uid()
  );

CREATE POLICY workspace_members_insert ON workspace_members
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY workspace_members_update ON workspace_members
  FOR UPDATE
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY workspace_members_delete ON workspace_members
  FOR DELETE
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    OR user_id = auth.uid()
  );


-- ===== 20260314020000_collab_activity_log.sql =====
-- Activity log for workspace changes (scenes, views, annotations).
CREATE TABLE IF NOT EXISTS workspace_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name TEXT,
  action TEXT NOT NULL,  -- e.g. 'scene_saved', 'view_saved', 'annotation_created', 'annotation_updated', 'annotation_deleted'
  entity_type TEXT NOT NULL,  -- 'scene', 'view', 'annotation'
  entity_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_activity_log_workspace_created_idx
  ON workspace_activity_log(workspace_id, created_at DESC);

ALTER TABLE workspace_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_activity_log_select ON workspace_activity_log
  FOR SELECT
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY workspace_activity_log_insert ON workspace_activity_log
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );


-- ===== 20260314010000_annotation_comments.sql =====
-- Threaded comments on annotations (parent_id for replies).
CREATE TABLE IF NOT EXISTS annotation_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  annotation_id UUID NOT NULL REFERENCES workspace_annotations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES annotation_comments(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS annotation_comments_annotation_idx ON annotation_comments(annotation_id);

ALTER TABLE annotation_comments ENABLE ROW LEVEL SECURITY;

-- RLS: users can read/write if they have workspace access (via annotation)
CREATE POLICY annotation_comments_select ON annotation_comments
  FOR SELECT
  USING (
    annotation_id IN (
      SELECT id FROM workspace_annotations
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
         OR workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY annotation_comments_insert ON annotation_comments
  FOR INSERT
  WITH CHECK (
    annotation_id IN (
      SELECT id FROM workspace_annotations
      WHERE workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
         OR workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY annotation_comments_delete ON annotation_comments
  FOR DELETE
  USING (author_id = auth.uid());


-- ===== 20260315000000_scan_history.sql =====
-- Scan history per workspace for architecture evolution tracking.
CREATE TABLE IF NOT EXISTS scan_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  branch TEXT,
  commit_sha TEXT,
  ref TEXT,
  trigger TEXT CHECK (trigger IN ('manual', 'webhook', 'cron')),
  error_message TEXT,
  node_count INTEGER,
  edge_count INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  graph_id UUID,
  CONSTRAINT valid_completed CHECK (
    status <> 'completed' OR completed_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS scan_history_workspace_idx ON scan_history(workspace_id);
CREATE INDEX IF NOT EXISTS scan_history_started_idx ON scan_history(started_at DESC);

ALTER TABLE scan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY scan_history_select ON scan_history
  FOR SELECT
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
    OR workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

