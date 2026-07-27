-- Share links for public/restricted read-only architecture views.
CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS share_links_slug_idx ON share_links(slug);
CREATE INDEX IF NOT EXISTS share_links_workspace_idx ON share_links(workspace_id);

ALTER TABLE share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY share_links_select ON share_links
  FOR SELECT
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );

CREATE POLICY share_links_insert ON share_links
  FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid())
  );
