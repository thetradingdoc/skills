-- Sticky/group geometry for n8n import grouping containers.
-- Annotations previously only stored a point (canvas_x/y).

ALTER TABLE workspace_annotations
  ADD COLUMN IF NOT EXISTS width REAL,
  ADD COLUMN IF NOT EXISTS height REAL,
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT;

COMMENT ON COLUMN workspace_annotations.width IS 'Optional sticky/group width (n8n sticky notes)';
COMMENT ON COLUMN workspace_annotations.height IS 'Optional sticky/group height';
COMMENT ON COLUMN workspace_annotations.color IS 'n8n color index or CSS color';
COMMENT ON COLUMN workspace_annotations.kind IS 'sticky | group | null';
