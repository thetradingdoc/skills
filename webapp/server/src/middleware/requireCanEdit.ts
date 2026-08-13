import type { Request, Response, NextFunction } from "express";

/**
 * Rejects viewers on write routes. Must run after requireWorkspaceAccess,
 * which attaches req.workspace.role.
 */
export function requireCanEdit(req: Request, res: Response, next: NextFunction): void {
  const role = (req as Request & { workspace?: { role?: string } }).workspace?.role;
  if (role === "viewer") {
    res.status(403).json({ error: "Viewers cannot edit this workspace." });
    return;
  }
  next();
}
