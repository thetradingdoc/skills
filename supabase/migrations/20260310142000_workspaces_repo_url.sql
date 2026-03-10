-- Workspaces: add repo_url for scan/connect persistence.
-- When set, represents the canonical repo URL for this workspace (from scan or save).

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS repo_url text;
