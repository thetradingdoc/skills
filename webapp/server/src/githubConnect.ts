/**
 * GitHub Connect: OAuth initiation and repo listing for "Connect from GitHub" flow.
 * Enables users to link workspaces to repositories via GitHub OAuth.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { assertWorkspaceAccess } from "./workspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const APP_URL = process.env.APP_URL?.trim() || "http://localhost:5174";

/** Initiate GitHub OAuth for connect-repo flow. Redirects to Supabase OAuth. */
router.get("/auth/github-connect", requireUser, (req, res) => {
  const workspaceId = String(req.query.workspaceId ?? "").trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }
  if (!SUPABASE_URL) {
    res.status(503).json({ error: "Auth not configured." });
    return;
  }
  const redirectTo = `${APP_URL}?github-connect=1&workspaceId=${encodeURIComponent(workspaceId)}`;
  const authorizeUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=github&redirect_to=${encodeURIComponent(redirectTo)}&response_type=code&scope=read:user user:email repo`;
  res.redirect(302, authorizeUrl);
});

/** List user's GitHub repos. Requires provider_token from client (obtained after GitHub OAuth). */
router.get(
  "/github/repos",
  requireUser,
  async (req, res) => {
    const workspaceId = String(req.query.workspaceId ?? "").trim();
    const state = String(req.query.state ?? "").trim();
    const githubToken = (req.headers["x-github-token"] as string)?.trim();
    if (!githubToken) {
      res.status(400).json({ error: "X-GitHub-Token header required. Sign in with GitHub to get repo access." });
      return;
    }
    if (!workspaceId || !state) {
      res.status(400).json({ error: "workspaceId and state query params required." });
      return;
    }
    try {
      await assertWorkspaceAccess(supabaseAdmin!, workspaceId, req.user!.id);
    } catch {
      res.status(404).json({ error: "Workspace not found or access denied." });
      return;
    }
    try {
      const ghRes = await fetch("https://api.github.com/user/repos?per_page=100&sort=updated", {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${githubToken}`,
        },
      });
      if (!ghRes.ok) {
        const txt = await ghRes.text();
        res.status(502).json({ error: `GitHub API error: ${ghRes.status} ${txt.slice(0, 200)}` });
        return;
      }
      const data = (await ghRes.json()) as Array<{ full_name: string; id: number; private?: boolean }>;
      res.json({
        repos: data.map((r) => ({ full_name: r.full_name, id: r.id, private: !!r.private })),
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to fetch repos." });
    }
  }
);

export { router as githubConnectRoutes };
