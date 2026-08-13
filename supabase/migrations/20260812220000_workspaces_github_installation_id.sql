-- Collaborate Gate B: store GitHub App installation on workspaces.
-- Shared installs: multiple workspaces may share the same github_installation_id.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS github_installation_id BIGINT;

CREATE INDEX IF NOT EXISTS workspaces_github_installation_id_idx
  ON workspaces(github_installation_id)
  WHERE github_installation_id IS NOT NULL;

COMMENT ON COLUMN workspaces.github_installation_id IS
  'GitHub App installation id (Blanko-Lab). Shared across workspaces in the same org/user install.';
