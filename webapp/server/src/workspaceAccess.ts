import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceAccessRow = {
  id: string;
  owner_id: string;
  archived_at?: string | null;
};

/**
 * Centralized workspace access check used by all workspace-scoped routes.
 * Ensures the current user owns the workspace and it is not archived.
 */
export async function assertWorkspaceAccess(
  supabase: SupabaseClient | null,
  workspaceId: string | null | undefined,
  userId: string | null | undefined
): Promise<WorkspaceAccessRow> {
  if (!supabase) {
    throw Object.assign(new Error("Auth service not configured."), { statusCode: 503 });
  }
  if (!workspaceId) {
    throw Object.assign(new Error("workspaceId is required"), { statusCode: 400 });
  }
  if (!userId) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }

  const { data: ws, error } = await supabase
    .from("workspaces")
    .select("id, owner_id, archived_at")
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw Object.assign(new Error(error.message), { statusCode: 500 });
  }
  if (!ws) {
    throw Object.assign(new Error("Workspace not found."), { statusCode: 404 });
  }

  const isOwner = (ws as { owner_id: string }).owner_id === userId;
  if (isOwner) {
    if ((ws as { archived_at?: string | null }).archived_at) {
      throw Object.assign(new Error("Workspace is archived."), { statusCode: 403 });
    }
    // Lazy backfill: ensure owner exists in workspace_members (handles pre-migration workspaces)
    try {
      await supabase.from("workspace_members").upsert(
        { workspace_id: workspaceId, user_id: userId, role: "owner" },
        { onConflict: "workspace_id,user_id", ignoreDuplicates: true }
      );
    } catch {
      /* non-fatal: owner access already granted above */
    }
    return ws as WorkspaceAccessRow;
  }

  // Non-owner: require workspace_members row. On query error (e.g. table missing pre-migration),
  // deny non-owners (owner already returned above).
  let member: { id: string } | null = null;
  try {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!error) member = data;
  } catch {
    // workspace_members may not exist; deny non-owners
  }

  if (!member) {
    throw Object.assign(new Error("Workspace not found or access denied."), { statusCode: 404 });
  }
  const data = ws;
  if ((data as { archived_at?: string | null }).archived_at) {
    throw Object.assign(new Error("Workspace is archived."), { statusCode: 403 });
  }
  return data as WorkspaceAccessRow;
}

