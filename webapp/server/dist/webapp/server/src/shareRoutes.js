import { Router } from "express";
import { nanoid } from "nanoid";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { requireUser } from "./middleware/requireUser.js";
if (!process.env.APP_URL) {
    console.warn("[shareRoutes] APP_URL not set — share links may have incorrect base URL");
}
const router = Router();
/** Create a share link — authenticated */
router.post("/workspaces/:workspaceId/share", requireUser, async (req, res) => {
    if (!supabaseAdmin) {
        res.status(503).json({ error: "Auth service not configured." });
        return;
    }
    const ownerId = req.user.id;
    const { workspaceId } = req.params;
    if (!workspaceId) {
        res.status(400).json({ error: "workspaceId required" });
        return;
    }
    const { data: ws, error: wsError } = await supabaseAdmin
        .from("workspaces")
        .select("id")
        .eq("id", workspaceId)
        .eq("owner_id", ownerId)
        .maybeSingle();
    if (wsError || !ws) {
        res.status(404).json({ error: "Workspace not found" });
        return;
    }
    const base = process.env.APP_URL ?? req.headers.origin ?? "";
    const { data: existing } = await supabaseAdmin
        .from("share_links")
        .select("slug")
        .eq("workspace_id", workspaceId)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (existing) {
        const shareUrl = `${base.replace(/\/$/, "")}/shared/${existing.slug}`;
        res.json({ url: shareUrl, slug: existing.slug });
        return;
    }
    const slug = nanoid(10);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const { data, error } = await supabaseAdmin
        .from("share_links")
        .insert({ workspace_id: workspaceId, slug, expires_at: expiresAt })
        .select("slug")
        .single();
    if (error) {
        res.status(500).json({ error: error.message });
        return;
    }
    const shareUrl = `${base.replace(/\/$/, "")}/shared/${data.slug}`;
    res.json({ url: shareUrl, slug: data.slug });
});
/** Load a shared view — no auth required */
router.get("/shared/:slug", async (req, res) => {
    if (!supabaseAdmin) {
        res.status(503).json({ error: "Auth service not configured." });
        return;
    }
    const { slug } = req.params;
    if (!slug) {
        res.status(400).json({ error: "slug required" });
        return;
    }
    const { data: link } = await supabaseAdmin
        .from("share_links")
        .select("workspace_id, expires_at")
        .eq("slug", slug)
        .maybeSingle();
    if (!link) {
        res.status(404).json({ error: "Link not found" });
        return;
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
        res.status(410).json({ error: "Link expired" });
        return;
    }
    const { data: graphRow } = await supabaseAdmin
        .from("graphs")
        .select("graph_json, repo_url")
        .eq("workspace_id", link.workspace_id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (!graphRow?.graph_json) {
        res.status(404).json({ error: "No graph for this link" });
        return;
    }
    res.json({
        graph: graphRow.graph_json,
        repoUrl: graphRow.repo_url ?? "",
    });
});
export { router as shareRoutes };
