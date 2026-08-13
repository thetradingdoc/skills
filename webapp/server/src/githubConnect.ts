/**
 * GitHub Connect + Blanko-Lab App install (Collaborate Gate B).
 * Supabase OAuth remains for user identity; App install is source of webhooks.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { assertWorkspaceAccess } from "./workspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import {
  buildAppInstallUrl,
  getAppPublicConfig,
  isGithubAppConfigured,
  listInstallationRepos,
} from "./githubApp.js";

const router = Router();

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const APP_URL = process.env.APP_URL?.trim() || "http://localhost:5174";

/**
 * Initiate GitHub OAuth for connect-repo flow (legacy / identity).
 * Prefer App install via GET /auth/github-app/install when configured.
 */
router.get("/auth/github-connect", (req, res) => {
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

/** Public App config for Connect UI (no secrets). */
router.get("/github/app/config", (_req, res) => {
  res.json(getAppPublicConfig());
});

/**
 * Start Blanko-Lab App install. Top-level navigation — no Bearer.
 * state query carries workspaceId through GitHub → callback.
 */
router.get("/auth/github-app/install", (req, res) => {
  const workspaceId = String(req.query.workspaceId ?? "").trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }
  if (!isGithubAppConfigured()) {
    res.status(503).json({
      error: "GitHub App not configured on server.",
      hint: "Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY (see docs/ops/ENV.md).",
    });
    return;
  }
  res.redirect(302, buildAppInstallUrl(workspaceId));
});

/**
 * After GitHub redirects back with installation_id + state=workspaceId.
 * Query: installation_id, setup_action, state (workspaceId).
 * Requires auth — client should open this after login with Bearer, or land on SPA first.
 */
router.post("/github/app/installations/bind", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = String(req.body?.workspaceId ?? req.body?.state ?? "").trim();
  const installationIdRaw = req.body?.installation_id ?? req.body?.installationId;
  const installationId = Number(installationIdRaw);
  if (!workspaceId || !Number.isFinite(installationId) || installationId <= 0) {
    res.status(400).json({ error: "workspaceId and installation_id required." });
    return;
  }
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user!.id);
  } catch {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const { error } = await supabaseAdmin
    .from("workspaces")
    .update({ github_installation_id: installationId })
    .eq("id", workspaceId);
  if (error) {
    // Column may be missing on old DBs
    if (/github_installation_id|PGRST204|schema cache/i.test(error.message)) {
      res.status(503).json({
        error: "github_installation_id column missing — apply migration 20260812220000.",
      });
      return;
    }
    res.status(500).json({ error: error.message });
    return;
  }
  res.json({ success: true, workspaceId, installation_id: installationId });
});

/** List repos visible to the workspace's GitHub App installation. */
router.get("/github/app/repos", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const workspaceId = String(req.query.workspaceId ?? "").trim();
  if (!workspaceId) {
    res.status(400).json({ error: "workspaceId required." });
    return;
  }
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user!.id);
  } catch {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }

  const { data: ws, error } = await supabaseAdmin
    .from("workspaces")
    .select("github_installation_id")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  const installationId = Number((ws as { github_installation_id?: number } | null)?.github_installation_id);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    res.status(400).json({
      error: "GitHub App not installed for this workspace.",
      code: "GITHUB_APP_NOT_INSTALLED",
    });
    return;
  }
  try {
    const repos = await listInstallationRepos(installationId);
    res.json({ repos, installation_id: installationId });
  } catch (e) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Failed to list repos." });
  }
});

/** List user's GitHub repos via OAuth provider token (secondary path). */
router.get("/github/repos", requireUser, async (req, res) => {
  const workspaceId = String(req.query.workspaceId ?? "").trim();
  const state = String(req.query.state ?? "").trim();
  const githubToken = (req.headers["x-github-token"] as string)?.trim();
  if (!githubToken) {
    res.status(400).json({
      error: "X-GitHub-Token header required. Sign in with GitHub to get repo access.",
    });
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
});

export { router as githubConnectRoutes };
