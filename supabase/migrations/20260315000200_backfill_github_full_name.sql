-- Backfill github_full_name from repo_url for existing workspaces.
UPDATE workspaces
SET github_full_name = (
  (regexp_match(repo_url, 'github\.com[/:]([^/]+/[^/.]+?)(?:\.git)?/?$', 'i'))[1]
)
WHERE repo_url IS NOT NULL
  AND (github_full_name IS NULL OR github_full_name = '')
  AND repo_url ~ 'github\.com[/:]';
