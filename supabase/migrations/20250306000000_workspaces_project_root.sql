-- Optional project root path for workspaces (used by Rails API when resolving rootPath from workspaceId).
-- When set, GET /api/rails?workspaceId=X uses this as rootPath to load rails from .agent/rails.
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS project_root TEXT;
