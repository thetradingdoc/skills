-- Workspace scenes: versioned iCraft-style scene documents (objects/transforms/materials/links/states).
-- This is intentionally separate from graphs.graph_json (static scan output), so users can author/edit
-- a scene that references graph nodes but is not overwritten by re-scans.

CREATE TABLE IF NOT EXISTS workspace_scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Scene',
  scene_version INTEGER NOT NULL DEFAULT 1,
  scene_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure predictable latest-by-version selection per workspace
CREATE UNIQUE INDEX IF NOT EXISTS workspace_scenes_workspace_version_uniq
  ON workspace_scenes(workspace_id, scene_version);

CREATE INDEX IF NOT EXISTS workspace_scenes_workspace_updated_idx
  ON workspace_scenes(workspace_id, updated_at DESC);

ALTER TABLE workspace_scenes ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_scenes_owner ON workspace_scenes
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

-- updated_at trigger (reuse set_updated_at from earlier migrations; safe fallback if missing)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspace_scenes_updated_at ON workspace_scenes;
CREATE TRIGGER workspace_scenes_updated_at
  BEFORE UPDATE ON workspace_scenes
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

