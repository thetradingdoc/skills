/**
 * Rails API — expose Rail registry for Board view and task detail.
 * Requires rootPath (project root where .agent/rails lives) or workspaceId.
 * When workspaceId is provided, resolves rootPath from workspace.project_root if set.
 */
import { Router } from "express";
import * as path from "path";
import { optionalUser } from "./middleware/optionalUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { getAllRails, getRail, loadRails, } from "../../../src/agent/rail/manager.js";
const router = Router();
function resolveRootPath(raw) {
    if (!raw || typeof raw !== "string" || raw.trim() === "") {
        return { error: "rootPath query is required." };
    }
    const root = path.resolve(raw.trim());
    const baseDir = process.env.PROJECTS_BASE_DIR?.trim();
    if (baseDir) {
        const baseNorm = path.resolve(baseDir);
        if (!root.startsWith(baseNorm + path.sep) && root !== baseNorm) {
            return { error: "rootPath must be within the allowed projects directory." };
        }
    }
    return { root };
}
async function resolveRootFromWorkspace(workspaceId, ownerId) {
    if (!supabaseAdmin)
        return null;
    try {
        const { data, error } = await supabaseAdmin
            .from("workspaces")
            .select("project_root")
            .eq("id", workspaceId)
            .eq("owner_id", ownerId)
            .maybeSingle();
        if (error || !data)
            return null;
        const pr = data.project_root;
        return typeof pr === "string" && pr.trim() ? path.resolve(pr.trim()) : null;
    }
    catch {
        return null;
    }
}
router.get("/rails", optionalUser, async (req, res) => {
    const rootPath = req.query.rootPath?.trim();
    const workspaceId = req.query.workspaceId?.trim();
    let resolved;
    if (rootPath) {
        resolved = resolveRootPath(rootPath);
    }
    else if (workspaceId && req.user?.id) {
        const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
        resolved = root ? { root } : { error: "Workspace has no project_root. Set project_root or pass rootPath." };
    }
    else {
        resolved = { error: "rootPath or workspaceId (with auth) is required." };
    }
    if ("error" in resolved) {
        res.status(400).json({ error: resolved.error });
        return;
    }
    try {
        loadRails(resolved.root);
        const rails = getAllRails();
        res.json({
            rails: rails.map((r) => ({
                id: r.id,
                outcome: r.outcome,
                state: r.state,
                archetype: r.archetype,
                logicPath: r.logicPath,
                sessionId: r.sessionId,
                jiraKeys: r.jiraKeys ?? [],
                updatedAt: r.updatedAt,
                createdAt: r.createdAt,
                lastCritique: r.lastCritique ?? null,
                hallucinationIndex: r.hallucinationIndex ?? null,
                acceptanceCriteria: r.acceptanceCriteria ?? null,
                tasks: (r.tasks ?? []).map((t) => ({
                    id: t.id,
                    kind: t.kind,
                    description: t.description,
                    status: t.status,
                    createdAt: t.createdAt,
                })),
            })),
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: msg });
    }
});
router.get("/rails/:railId", optionalUser, async (req, res) => {
    const rootPath = req.query.rootPath?.trim();
    const workspaceId = req.query.workspaceId?.trim();
    let resolved;
    if (rootPath) {
        resolved = resolveRootPath(rootPath);
    }
    else if (workspaceId && req.user?.id) {
        const root = await resolveRootFromWorkspace(workspaceId, req.user.id);
        resolved = root ? { root } : { error: "Workspace has no project_root." };
    }
    else {
        resolved = { error: "rootPath or workspaceId (with auth) is required." };
    }
    if ("error" in resolved) {
        res.status(400).json({ error: resolved.error });
        return;
    }
    const railId = req.params.railId;
    if (!railId) {
        res.status(400).json({ error: "railId is required." });
        return;
    }
    try {
        loadRails(resolved.root);
        const rail = getRail(resolved.root, railId);
        if (!rail) {
            res.status(404).json({ error: "Rail not found." });
            return;
        }
        res.json({
            id: rail.id,
            outcome: rail.outcome,
            state: rail.state,
            archetype: rail.archetype,
            logicPath: rail.logicPath,
            sessionId: rail.sessionId,
            jiraKeys: rail.jiraKeys ?? [],
            updatedAt: rail.updatedAt,
            createdAt: rail.createdAt,
            lastCritique: rail.lastCritique ?? null,
            hallucinationIndex: rail.hallucinationIndex ?? null,
            acceptanceCriteria: rail.acceptanceCriteria ?? null,
            tasks: rail.tasks ?? [],
            traces: rail.traces ?? null,
            telemetry: rail.telemetry ?? null,
        });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: msg });
    }
});
export { router as railsRoutes };
