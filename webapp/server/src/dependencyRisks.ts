import express from "express";
import { execFileSync } from "child_process";
import * as path from "path";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { assertWorkspaceAccess } from "./workspaceAccess.js";
import { ensureProjectRoot } from "./cloneRepo.js";
import type { ArchGraph } from "../../../src/types.js";

const router = express.Router();

/**
 * Ingest a dependency risk report (from npm audit, Snyk, etc.) for a workspace.
 * The client is responsible for running the scanner and POSTing its JSON output.
 */
router.post("/workspaces/:workspaceId/dependency-risks", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const { tool, source, report } = req.body as {
    tool?: string;
    source?: string | null;
    report?: unknown;
  };
  if (!tool || typeof tool !== "string") {
    res.status(400).json({ error: "tool is required (e.g. 'npm-audit', 'snyk')." });
    return;
  }
  if (report == null || typeof report !== "object") {
    res.status(400).json({ error: "report (JSON object) is required." });
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("workspace_dependency_risks")
    .insert({
      workspace_id: workspaceId,
      tool,
      source: source ?? null,
      report_json: report,
    })
    .select("id, workspace_id, created_at, tool, source")
    .single();

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(201).json({ risk: data });
});

/**
 * List recent dependency risk reports for a workspace (for the UI to aggregate into a supply-chain view).
 */
router.get("/workspaces/:workspaceId/dependency-risks", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  const limit = Math.min(parseInt(String(req.query.limit ?? 10), 10) || 10, 50);
  const { data, error } = await supabaseAdmin
    .from("workspace_dependency_risks")
    .select("id, workspace_id, created_at, tool, source, report_json")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.json({ risks: data ?? [] });
});

/**
 * Run npm audit in the workspace's project root and persist the report.
 * Requires workspace to have a cloned repo or valid project_root.
 */
router.post("/workspaces/:workspaceId/run-npm-audit", requireUser, async (req, res) => {
  const workspaceId = req.params.workspaceId;
  try {
    await assertWorkspaceAccess(supabaseAdmin, workspaceId, req.user?.id);
  } catch (e) {
    const err = e as { message: string; statusCode?: number };
    res.status(err.statusCode ?? 500).json({ error: err.message });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }

  // Get latest graph and repo_url for project root
  const { data: graphRow, error: gErr } = await supabaseAdmin
    .from("graphs")
    .select("graph_json, repo_url")
    .eq("workspace_id", workspaceId)
    .not("graph_json", "is", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (gErr || !graphRow?.graph_json) {
    res.status(404).json({ error: "No graph for this workspace. Scan first." });
    return;
  }

  const graph = graphRow.graph_json as ArchGraph;
  const repoUrl = (graphRow.repo_url as string | null)?.trim() ?? null;
  const { rootPath, error: rootErr } = await ensureProjectRoot(workspaceId, graph, repoUrl);

  if (!rootPath || rootErr) {
    res.status(400).json({
      error: rootErr ?? "Could not resolve project root. Ensure repo is cloned or project_root is set.",
    });
    return;
  }

  const packageJsonPath = path.join(rootPath, "package.json");
  try {
    const fs = await import("fs");
    if (!fs.existsSync(packageJsonPath)) {
      res.status(400).json({ error: "No package.json in project root." });
      return;
    }
  } catch {
    res.status(500).json({ error: "Could not access project files." });
    return;
  }

  let auditJson: unknown;
  try {
    const out = execFileSync("npm", ["audit", "--json"], {
      cwd: rootPath,
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, CI: "1" },
    });
    auditJson = JSON.parse(out);
  } catch (runErr: unknown) {
    const err = runErr as { status?: number; stderr?: Buffer; stdout?: Buffer };
    // npm audit exits 1 when vulnerabilities exist; we still want the report
    let raw = "";
    if (err.stdout) raw = Buffer.isBuffer(err.stdout) ? err.stdout.toString("utf-8") : String(err.stdout);
    if (!raw && err.stderr)
      raw = Buffer.isBuffer(err.stderr) ? err.stderr.toString("utf-8") : String(err.stderr);
    try {
      auditJson = raw ? JSON.parse(raw) : { error: "npm audit failed", metadata: { vulnerabilities: 0 } };
    } catch {
      res.status(500).json({ error: "npm audit failed or produced invalid JSON." });
      return;
    }
  }

  const { error: insErr } = await supabaseAdmin.from("workspace_dependency_risks").insert({
    workspace_id: workspaceId,
    tool: "npm-audit",
    source: "package.json",
    report_json: auditJson,
  });

  if (insErr) {
    res.status(500).json({ error: insErr.message });
    return;
  }

  res.status(201).json({
    ok: true,
    message: "npm audit completed and report saved.",
    report: auditJson,
  });
});

export { router as dependencyRisksRoutes };

