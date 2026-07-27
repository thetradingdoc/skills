-- GitHub integration: store repo identifiers for webhook matching and API use.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS github_full_name TEXT,
  ADD COLUMN IF NOT EXISTS github_repo_id BIGINT;

-- github_full_name = "owner/repo" for easy webhook lookups
CREATE INDEX IF NOT EXISTS workspaces_github_full_name_idx ON workspaces(github_full_name)
  WHERE github_full_name IS NOT NULL;
