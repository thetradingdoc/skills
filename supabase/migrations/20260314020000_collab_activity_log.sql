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
