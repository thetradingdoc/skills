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
