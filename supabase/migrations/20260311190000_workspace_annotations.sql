-- Annotations pinned to nodes, layers (zones), or canvas positions.
CREATE TABLE IF NOT EXISTS public.workspace_annotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('note', 'highlight', 'question')),
  content TEXT NOT NULL DEFAULT '',
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name TEXT,
  -- Anchor: exactly one of these is set
  node_id TEXT,
  layer TEXT,
  canvas_x REAL,
  canvas_y REAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS workspace_annotations_workspace_idx
  ON public.workspace_annotations(workspace_id);

ALTER TABLE public.workspace_annotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_annotations_owner ON public.workspace_annotations
  USING (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()))
  WITH CHECK (workspace_id IN (SELECT id FROM workspaces WHERE owner_id = auth.uid()));

CREATE OR REPLACE FUNCTION set_annotation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspace_annotations_updated_at ON public.workspace_annotations;
CREATE TRIGGER workspace_annotations_updated_at
  BEFORE UPDATE ON public.workspace_annotations
  FOR EACH ROW
  EXECUTE FUNCTION set_annotation_updated_at();
