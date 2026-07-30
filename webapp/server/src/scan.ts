import type { Request } from "express";
import { Router } from "express";
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
import { upsertSystemModel } from "./systemModelRoutes.js";
import {
  insertScanHistory,
  updateScanHistory,
} from "./scanHistory.js";
import { runScanScript } from "./runScanScript.js";

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
  // A local directory is scanned in place. Editing a clone of your own repo
  // is backwards, and this is the path you want when working on code that is
  // already on disk.
  const isLocalDir =
    !trimmed.match(/^https?:/i) &&
    fs.existsSync(trimmed) &&
    fs.statSync(trimmed).isDirectory();
  if (!isLocalDir && !trimmed.match(/github\.com[/:]/i)) {
    res.status(400).json({ error: "Use a GitHub URL or a local directory path" });
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

  let workspaceIdForScan: string | null = null;
  const ownerId = req.user?.id;
  const defaultName = repoNameFromUrl(trimmed) ?? "Imported repository";

  if (ownerId && supabaseAdmin) {
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
        .is("archived_at", null)
        .maybeSingle();
      if (!wsErr && ws?.id) workspaceIdForScan = ws.id;
    }
    if (!workspaceIdForScan) {
      // Reuse an existing workspace for this repo rather than creating a new
      // one on every scan. Without this each scan produced a fresh workspace,
      // so findings and decisions were written to one and read back from the
      // next — and the scan diff never had a previous scan to compare against.
      const { data: existing } = await supabaseAdmin
        .from("workspaces")
        .select("id")
        .eq("owner_id", ownerId)
        .eq("name", defaultName)
        .is("archived_at", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (existing?.id) {
        workspaceIdForScan = existing.id;
      } else {
      const { data: ws, error: wsErr } = await supabaseAdmin
        .from("workspaces")
        .insert({ owner_id: ownerId, name: defaultName })
        .select("id")
        .single();
      if (!wsErr && ws?.id) workspaceIdForScan = ws.id;
      }
    }
  }

  const scanArgs = ["tsx", "scripts/scan-repo.ts", trimmed, "--keep"];
  if (workspaceIdForScan) {
    scanArgs.push("--workspace-id", workspaceIdForScan);
  }

  let scanHistoryId: string | null = null;
  if (ownerId && workspaceIdForScan && supabaseAdmin) {
    scanHistoryId = await insertScanHistory({
      workspaceId: workspaceIdForScan,
      status: "started",
      trigger: "manual",
    });
  }

  try {
    const { graph, bytes } = runScanScript(scanArgs);
    console.log(`[scan] live payload size confirmed: ${bytes} bytes`);

    if (isAnonymous) {
      const key = getAnonymousScanKey(req);
      incrementAnonymousCount(key);
    }

    // ── Signed-in path: MUST either persist or fail loudly ─────────────────
    if (ownerId && supabaseAdmin) {
      const workspaceId = workspaceIdForScan;
      let persistError: string | null = null;
      let jiraProjectKey: string | null = null;

      try {
        if (!workspaceId) {
          persistError = "Failed to obtain workspace id.";
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

        const { data: graphInsert, error: gErr } = await supabaseAdmin
          .from("graphs")
          .insert({
            workspace_id: workspaceId,
            graph_json: graph,
            repo_url: trimmed,
          })
          .select("id")
          .single();
        if (gErr) throw gErr;

        const githubFullName = repoNameFromUrl(trimmed);
        await supabaseAdmin
          .from("workspaces")
          .update({
            repo_url: trimmed,
            github_full_name: githubFullName,
          })
          .eq("id", workspaceId);

        if (scanHistoryId) {
          const nodeCount = Array.isArray((graph as { nodes?: unknown[] }).nodes)
            ? (graph as { nodes?: unknown[] }).nodes!.length
            : 0;
          const edgeCount = Array.isArray((graph as { edges?: unknown[] }).edges)
            ? (graph as { edges?: unknown[] }).edges!.length
            : 0;
          await updateScanHistory(scanHistoryId, {
            status: "completed",
            node_count: nodeCount,
            edge_count: edgeCount,
            completed_at: new Date().toISOString(),
            graph_id: (graphInsert as { id: string })?.id ?? null,
          });
        }

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
        if (scanHistoryId) {
          await updateScanHistory(scanHistoryId, {
            status: "failed",
            error_message: persistError,
            completed_at: new Date().toISOString(),
          });
        }
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
      res.json({ ...graph, repoUrl: trimmed, workspaceId, jiraProjectKey, persistError: null });
      return;
    }

    // ── Anonymous / misconfigured path: return graph only ──────────────────
    const anonError = !ownerId
      ? "Sign up to save your workspaces."
      : "Auth service not configured.";
    res.json({ ...graph, repoUrl: trimmed, workspaceId: null, persistError: anonError });
  } catch (err: unknown) {
    if (scanHistoryId) {
      const msg = err instanceof Error ? err.message : String(err);
      void updateScanHistory(scanHistoryId, {
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString(),
      });
    }
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
  const scanHistoryId = await insertScanHistory({
    workspaceId,
    status: "started",
    trigger: "manual",
  });

  const scanArgs = ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId];
  try {
    const { graph } = runScanScript(scanArgs);
    const { error: insErr } = await supabaseAdmin.from("graphs").insert({
      workspace_id: workspaceId,
      graph_json: graph,
      repo_url: repoUrl,
    });
    if (insErr) throw insErr;
    const githubFullName = repoNameFromUrl(repoUrl);
    await supabaseAdmin
      .from("workspaces")
      .update({ repo_url: repoUrl, github_full_name: githubFullName })
      .eq("id", workspaceId);
    const { data: gRow } = await supabaseAdmin
      .from("graphs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    const graphId = (gRow as { id?: string })?.id ?? null;
    if (scanHistoryId) {
      const nodeCount = Array.isArray((graph as { nodes?: unknown[] }).nodes) ? (graph as { nodes?: unknown[] }).nodes!.length : 0;
      const edgeCount = Array.isArray((graph as { edges?: unknown[] }).edges) ? (graph as { edges?: unknown[] }).edges!.length : 0;
      await updateScanHistory(scanHistoryId, {
        status: "completed",
        node_count: nodeCount,
        edge_count: edgeCount,
        completed_at: new Date().toISOString(),
        graph_id: graphId,
      });
    }
    const graphTyped = graph as import("../../../src/types.js").ArchGraph;
    upsertSystemModel(workspaceId, graphTyped, graphId ?? undefined).catch((e) => console.warn("[scan] SystemModel upsert:", e));
    embedAndPersistNodes(
      graphTyped,
      workspaceId,
      supabaseAdmin,
      process.env.OPENAI_API_KEY?.trim()
    ).catch(() => {});
    runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch(() => {});
    res.json({ ...graph, workspaceId });
  } catch (err: unknown) {
    if (scanHistoryId) {
      const msg = err instanceof Error ? err.message : String(err);
      void updateScanHistory(scanHistoryId, {
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString(),
      });
    }
    const spawnErr = err as { stderr?: Buffer; code?: string };
    let message = "Re-scan failed";
    if (spawnErr.code === "ENOENT") message = "Cannot find npx.";
    else if (spawnErr.stderr) message = Buffer.isBuffer(spawnErr.stderr) ? spawnErr.stderr.toString("utf-8").trim() : String(spawnErr.stderr);
    else if (err instanceof Error) message = err.message;
    res.status(500).json({ error: message });
  }
});

export { router as scanRoutes };
