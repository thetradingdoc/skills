-- Add per-workspace Jira project key for tracking violations
-- Each workspace derives its key from repo URL; user can override

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS jira_project_key TEXT;
