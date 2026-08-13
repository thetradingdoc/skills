import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceRole = "owner" | "editor" | "viewer";

export type WorkspaceAccessRow = {
  id: string;
  owner_id: string;
  archived_at?: string | null;
  /** Role of the requesting user in this workspace. */
  role: WorkspaceRole;
};

/**
 * Centralized workspace access check used by all workspace-scoped routes.
 * Returns the caller's role (owner if workspace owner, else workspace_members.role).
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
    try {
      await supabase.from("workspace_members").upsert(
        { workspace_id: workspaceId, user_id: userId, role: "owner" },
        { onConflict: "workspace_id,user_id", ignoreDuplicates: true }
      );
    } catch {
      /* non-fatal */
    }
    return { ...(ws as WorkspaceAccessRow), role: "owner" };
  }

  let member: { id: string; role: string } | null = null;
  try {
    const { data, error: memErr } = await supabase
      .from("workspace_members")
      .select("id, role")
      .eq("workspace_id", workspaceId)
      .eq("user_id", userId)
      .maybeSingle();
    if (!memErr) member = data as { id: string; role: string } | null;
  } catch {
    // workspace_members may not exist; deny non-owners
  }

  if (!member) {
    throw Object.assign(new Error("Workspace not found or access denied."), { statusCode: 404 });
  }
  if ((ws as { archived_at?: string | null }).archived_at) {
    throw Object.assign(new Error("Workspace is archived."), { statusCode: 403 });
  }
  const role = (member.role as WorkspaceRole) || "viewer";
  return { ...(ws as WorkspaceAccessRow), role };
}

/** Throws 403 if the caller's role is viewer (read-only). */
export function assertCanEdit(access: WorkspaceAccessRow): void {
  if (access.role === "viewer") {
    throw Object.assign(new Error("Viewers cannot edit this workspace."), { statusCode: 403 });
  }
}
