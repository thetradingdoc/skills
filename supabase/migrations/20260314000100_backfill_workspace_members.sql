-- Backfill workspace_members: ensure every workspace has its owner as a member.
INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM workspaces
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_members wm
  WHERE wm.workspace_id = workspaces.id AND wm.user_id = workspaces.owner_id
)
ON CONFLICT (workspace_id, user_id) DO NOTHING;
