import type { Request, Response, NextFunction } from "express";
import { assertWorkspaceAccess } from "../workspaceAccess.js";
import { supabaseAdmin } from "../supabaseAdmin.js";

/**
 * Middleware that enforces workspace ownership for routes with :workspaceId param.
 * Use after requireUser. Calls assertWorkspaceAccess and attaches workspace to req.
 */
export async function requireWorkspaceAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const workspaceId = req.params.workspaceId as string | undefined;
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required" });
    return;
  }
  try {
    const ws = await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
    (req as Request & { workspace?: { id: string; owner_id: string; role?: string } }).workspace = {
      id: ws.id,
      owner_id: ws.owner_id,
      role: ws.role,
    };
    next();
  } catch (e) {
    const err = e as { message?: string; statusCode?: number };
    res.status(err.statusCode ?? 403).json({ error: err.message ?? "Access denied" });
  }
}
