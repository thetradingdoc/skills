import type { Request } from "express";
import { Router } from "express";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { optionalUser } from "./middleware/optionalUser.js";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { embedAndPersistNodes } from "../../../src/ai/nodeEmbeddings.js";
import { deriveProjectKey } from "./utils/deriveProjectKey.js";
import { runViolationScan } from "./violationStore.js";
import { ARCH_RULESET_VERSION } from "../../../src/ai/critic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot =
  process.env.PROJECT_ROOT?.trim() ||
  path.resolve(__dirname, "../../..");

const ANON_SCAN_LIMIT = Math.max(1, parseInt(process.env.ANON_SCAN_LIMIT ?? "2", 10));
const ANON_SCAN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** IP -> { count, firstAt } — resets when window expires */
const anonScanCounts = new Map<string, { count: number; firstAt: number }>();

function getAnonymousScanKey(req: Request): string {
  const forwarded = req.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

function checkAnonymousLimit(key: string): boolean {
  const now = Date.now();
  const entry = anonScanCounts.get(key);
  if (!entry) return true;
  if (now - entry.firstAt > ANON_SCAN_WINDOW_MS) {
    anonScanCounts.delete(key);
    return true;
  }
  return entry.count < ANON_SCAN_LIMIT;
}

function incrementAnonymousCount(key: string): void {
  const now = Date.now();
  const entry = anonScanCounts.get(key);
  if (!entry) {
    anonScanCounts.set(key, { count: 1, firstAt: now });
    return;
  }
  if (now - entry.firstAt > ANON_SCAN_WINDOW_MS) {
    anonScanCounts.set(key, { count: 1, firstAt: now });
    return;
  }
  entry.count += 1;
}

if (!fs.existsSync(path.join(projectRoot, "package.json"))) {
  console.warn(`[scan] projectRoot=${projectRoot} does not look like the repo root`);
}

const router = Router();

function repoNameFromUrl(url: string): string | null {
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

router.post("/scan", optionalUser, async (req, res) => {
  const { repoUrl, workspaceId: requestedWorkspaceId } = req.body as {
    repoUrl?: string;
    workspaceId?: string;
  };
  if (!repoUrl || typeof repoUrl !== "string") {
    res.status(400).json({ error: "repoUrl is required" });
    return;
  }

  const trimmed = repoUrl.trim();
  if (!trimmed.match(/github\.com[/:]/i)) {
    res.status(400).json({ error: "Use a GitHub URL, e.g. https://github.com/owner/repo" });
    return;
  }

  const isAnonymous = !req.user;
  const isSignedIn = !!req.user;

  if (process.env.METRICS_LOG === "1") {
    console.log("[scan] auth context", {
      hasUser: isSignedIn,
      hasAccessToken: !!req.accessToken,
      supabaseAdminConfigured: !!supabaseAdmin,
    });
  }

  // Invariant: if the client is signed in but the server has no Supabase admin client,
  // we MUST fail rather than silently degrading to anonymous behavior.
  if (isSignedIn && !supabaseAdmin) {
    res.status(503).json({
      error:
        "Auth service is not configured on the server. Signed-in scans cannot be persisted. " +
        "Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set for the webapp server.",
      workspaceId: null,
    });
    return;
  }
  if (isAnonymous) {
    const key = getAnonymousScanKey(req);
    if (!checkAnonymousLimit(key)) {
      res.status(403).json({
        error: "Sign up to continue scanning.",
        code: "SIGNUP_REQUIRED",
        limit: ANON_SCAN_LIMIT,
      });
      return;
    }
  }

  try {
    const result = execFileSync(
      "npx",
      ["tsx", "scripts/scan-repo.ts", trimmed, "--keep"],
      {
        cwd: projectRoot,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env },
      }
    );
    const graph = JSON.parse(result);

    if (isAnonymous) {
      const key = getAnonymousScanKey(req);
      incrementAnonymousCount(key);
    }

    const ownerId = req.user?.id;
    const defaultName = repoNameFromUrl(trimmed) ?? "Imported repository";

    // ── Signed-in path: MUST either persist or fail loudly ─────────────────
    if (ownerId && supabaseAdmin) {
      let workspaceId: string | null = null;
      let persistError: string | null = null;
      let jiraProjectKey: string | null = null;

      try {
        // Reuse existing workspace when requested and owned by this user.
        const candidate =
          typeof requestedWorkspaceId === "string" && requestedWorkspaceId.trim()
            ? requestedWorkspaceId.trim()
            : null;

        if (candidate) {
          const { data: ws, error: wsErr } = await supabaseAdmin
            .from("workspaces")
            .select("id")
            .eq("id", candidate)
            .eq("owner_id", ownerId)
            .maybeSingle();
          if (wsErr) throw wsErr;
          workspaceId = ws?.id ?? null;
        }

        // Otherwise, create a new workspace for this repo.
        if (!workspaceId) {
          const { data: ws, error: wsErr } = await supabaseAdmin
            .from("workspaces")
            .insert({ owner_id: ownerId, name: defaultName })
            .select("id")
            .single();
          if (wsErr) throw wsErr;
          workspaceId = ws?.id ?? null;
        }

        if (!workspaceId) {
          persistError = "Failed to obtain workspace id after insert.";
          throw new Error(persistError);
        }

        // Auto-derive Jira project key from repo URL if not set
        const { data: wsRow } = await supabaseAdmin
          .from("workspaces")
          .select("jira_project_key")
          .eq("id", workspaceId)
          .single();
        if (!wsRow?.jira_project_key && trimmed) {
          const key = deriveProjectKey(trimmed);
          await supabaseAdmin
            .from("workspaces")
            .update({ jira_project_key: key })
            .eq("id", workspaceId);
          jiraProjectKey = key;
        } else if (wsRow?.jira_project_key) {
          jiraProjectKey = wsRow.jira_project_key;
        }

        const { error: gErr } = await supabaseAdmin.from("graphs").insert({
          workspace_id: workspaceId,
          graph_json: graph,
          repo_url: trimmed,
        });
        if (gErr) throw gErr;

        // Fire-and-forget: embed nodes for semantic search (best-effort)
        embedAndPersistNodes(
          graph as import("../../../src/types.js").ArchGraph,
          workspaceId,
          supabaseAdmin,
          process.env.OPENAI_API_KEY?.trim()
        ).catch((e) => {
          if (process.env.METRICS_LOG === "1") {
            console.warn("[scan] node_embeddings failed:", e instanceof Error ? e.message : e);
          }
        });

        // Fire-and-forget: violation re-scan from graph (layer + drift)
        runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch((e) => {
          console.warn("[scan] violation scan failed:", e instanceof Error ? e.message : e);
        });
      } catch (e: any) {
        persistError = e?.message ? String(e.message) : String(e);
        console.error("[scan] workspace persistence failed:", {
          ownerId,
          requestedWorkspaceId,
          error: persistError,
        });
        res
          .status(500)
          .json({ error: persistError || "Failed to persist workspace.", workspaceId: null });
        return;
      }

      // Success: signed-in scan with persisted workspace.
      res.json({ ...graph, workspaceId, jiraProjectKey, persistError: null });
      return;
    }

    // ── Anonymous / misconfigured path: return graph only ──────────────────
    const anonError = !ownerId
      ? "Sign up to save your workspaces."
      : "Auth service not configured.";
    res.json({ ...graph, workspaceId: null, persistError: anonError });
  } catch (err: unknown) {
    const spawnErr = err as { stderr?: Buffer; code?: string };
    let message = "Scan failed";

    if (spawnErr.code === "ENOENT") {
      message = "Cannot find npx. Ensure Node.js and npm are installed and on PATH.";
    } else if (spawnErr.stderr) {
      message = Buffer.isBuffer(spawnErr.stderr)
        ? spawnErr.stderr.toString("utf-8").trim()
        : String(spawnErr.stderr).trim();
    } else if (err instanceof Error) {
      message = err.message;
    }

    res.status(500).json({ error: message || "Scan failed" });
  }
});

/** Re-scan workspace — fetches repo_url from latest graph, re-runs scan, updates graph. */
router.post("/scan/refresh", requireUser, async (req, res) => {
  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth service not configured." });
    return;
  }
  const ownerId = req.user!.id;
  const { workspaceId } = req.body as { workspaceId?: string };
  if (!workspaceId || typeof workspaceId !== "string") {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }
  const { data: ws, error: wsErr } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", ownerId)
    .single();
  if (wsErr || !ws) {
    res.status(404).json({ error: "Workspace not found or access denied." });
    return;
  }
  const { data: graphRow, error: gErr } = await supabaseAdmin
    .from("graphs")
    .select("repo_url")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (gErr || !graphRow?.repo_url) {
    res.status(404).json({ error: "No graph or repo_url for this workspace." });
    return;
  }
  const repoUrl = (graphRow.repo_url as string).trim();
  if (!repoUrl.match(/github\.com[/:]/i)) {
    res.status(400).json({ error: "Workspace repo_url is not a GitHub URL." });
    return;
  }
  try {
    const result = execFileSync(
      "npx",
      ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep"],
      { cwd: projectRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, env: { ...process.env } }
    );
    const graph = JSON.parse(result);
    const { error: insErr } = await supabaseAdmin.from("graphs").insert({
      workspace_id: workspaceId,
      graph_json: graph,
      repo_url: repoUrl,
    });
    if (insErr) throw insErr;
    embedAndPersistNodes(
      graph as import("../../../src/types.js").ArchGraph,
      workspaceId,
      supabaseAdmin,
      process.env.OPENAI_API_KEY?.trim()
    ).catch(() => {});
    runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch(() => {});
    res.json({ ...graph, workspaceId });
  } catch (err: unknown) {
    const spawnErr = err as { stderr?: Buffer; code?: string };
    let message = "Re-scan failed";
    if (spawnErr.code === "ENOENT") message = "Cannot find npx.";
    else if (spawnErr.stderr) message = Buffer.isBuffer(spawnErr.stderr) ? spawnErr.stderr.toString("utf-8").trim() : String(spawnErr.stderr);
    else if (err instanceof Error) message = err.message;
    res.status(500).json({ error: message });
  }
});

export { router as scanRoutes };
