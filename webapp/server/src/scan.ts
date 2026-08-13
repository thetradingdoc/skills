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
import { consumeScanCredit, getEntitlement } from "./entitlements.js";
import { reconcileDesignToScan, type ReconciliationResult } from "./designReconcile.js";
import { recordGithubArchitectureEvent } from "./githubArchEvents.js";
import type { ArchGraph } from "../../../src/types.js";
import { execFileSync } from "child_process";
import { updateWorkspaceRepoMeta } from "./workspaceRepoMeta.js";
import { readBlankoTarget, tradingApiUrl } from "../../../scripts/lib/blanko-target.js";

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

/**
 * Best-effort commit metadata for the directory a scan just ran against.
 * A scan of a local directory (or a fresh clone kept around by --keep) is a
 * git repo more often than not; when it is, recording it as a lightweight
 * "scan" event gives the PM bridge a data point even outside the webhook
 * path. Returns null rather than throwing when git isn't available or the
 * directory isn't a repo — this is a nice-to-have, not a scan requirement.
 */
function readGitCommitMetadata(
  repoDir: string
): { sha: string; branch: string | null; authorLogin: string | null; message: string | null } | null {
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();
    if (!sha) return null;
    let branch: string | null = null;
    try {
      branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim() || null;
    } catch {
      /* detached HEAD or unavailable */
    }
    let authorLogin: string | null = null;
    let message: string | null = null;
    try {
      const log = execFileSync("git", ["log", "-1", "--pretty=%an%x1f%s"], { cwd: repoDir, encoding: "utf-8" }).trim();
      const [author, msg] = log.split("\x1f");
      authorLogin = author || null;
      message = msg || null;
    } catch {
      /* not fatal — the sha alone is still worth recording */
    }
    return { sha, branch, authorLogin, message };
  } catch {
    return null;
  }
}

/**
 * Find the most recent design graph for a workspace — a saved graph with an
 * empty projectRoot (see `isDesignGraph` on the client) that predates the
 * scan currently being persisted. Used to reconcile "what we designed" vs
 * "what actually got built" when a design workspace is later linked to a repo.
 */
async function findPriorDesignGraph(
  workspaceId: string,
  excludeGraphId?: string | null
): Promise<ArchGraph | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("graphs")
    .select("id, graph_json, updated_at")
    .eq("workspace_id", workspaceId)
    .not("graph_json", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  for (const row of (data ?? []) as Array<{ id: string; graph_json: unknown }>) {
    if (excludeGraphId && row.id === excludeGraphId) continue;
    const g = row.graph_json as ArchGraph | null;
    if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) continue;
    const isDesign = !(g.projectRoot && g.projectRoot.trim());
    if (isDesign) return g;
  }
  return null;
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
  } else if (req.user?.id) {
    const ent = await getEntitlement(req.user.id);
    if (!ent.canScan) {
      res.status(403).json({
        error: ent.reason ?? "Upgrade to continue scanning.",
        code: ent.code ?? "UPGRADE_REQUIRED",
        plan: ent.plan,
        status: ent.status,
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

  // Local dirs: scan in place. GitHub: pass --workspace-id for stable clone path.
  const scanArgs = ["tsx", "scripts/scan-repo.ts", trimmed, "--keep"];
  if (!isLocalDir && workspaceIdForScan) {
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
      let reconciliation: ReconciliationResult | undefined;

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

        const scannedRoot =
          typeof (graph as { projectRoot?: string }).projectRoot === "string"
            ? (graph as { projectRoot: string }).projectRoot.trim()
            : isLocalDir
              ? path.resolve(trimmed)
              : "";
        const fullName = repoNameFromUrl(trimmed);
        const meta = await updateWorkspaceRepoMeta(supabaseAdmin, workspaceId, {
          repo_url: trimmed,
          project_root: scannedRoot || null,
          github_full_name: fullName,
        });
        if (!meta.ok) {
          console.warn("[scan] workspace repo meta update failed:", meta.error);
          throw new Error(meta.error);
        }

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

        // Fire-and-forget: lightweight PM-bridge event when the scanned dir is a git repo.
        const commitMeta = readGitCommitMetadata((graph as ArchGraph).projectRoot ?? "");
        if (commitMeta) {
          recordGithubArchitectureEvent(supabaseAdmin, {
            workspaceId,
            eventType: "scan",
            sha: commitMeta.sha,
            branch: commitMeta.branch,
            authorLogin: commitMeta.authorLogin,
            message: commitMeta.message,
            githubUrl: repoNameFromUrl(trimmed) ? `https://github.com/${repoNameFromUrl(trimmed)}/commit/${commitMeta.sha}` : null,
          }).catch((e) => {
            console.warn("[scan] recordGithubArchitectureEvent failed:", e instanceof Error ? e.message : e);
          });
        }

        // If this workspace previously held a design (empty projectRoot) graph,
        // reconcile it against the freshly scanned repo so the response tells
        // the user what was planned-and-built, planned-but-missing, and
        // built-but-unplanned.
        try {
          const priorDesign = await findPriorDesignGraph(
            workspaceId,
            (graphInsert as { id?: string } | null)?.id ?? null
          );
          if (priorDesign) {
            reconciliation = reconcileDesignToScan(priorDesign, graph as ArchGraph);
          }
        } catch (e) {
          console.warn("[scan] design reconciliation failed:", e instanceof Error ? e.message : e);
        }
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
      if (req.user?.id) {
        void consumeScanCredit(req.user.id);
      }
      res.json({
        ...graph,
        repoUrl: trimmed,
        workspaceId,
        jiraProjectKey,
        persistError: null,
        reconciliation,
      });
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
  // Mirror POST /api/scan: allow an existing local directory OR a GitHub URL.
  const isLocalDir =
    !repoUrl.match(/^https?:/i) &&
    fs.existsSync(repoUrl) &&
    fs.statSync(repoUrl).isDirectory();
  if (!isLocalDir && !repoUrl.match(/github\.com[/:]/i)) {
    res.status(400).json({
      error: "Workspace repo_url must be a GitHub URL or an existing local directory path",
    });
    return;
  }
  const scanHistoryId = await insertScanHistory({
    workspaceId,
    status: "started",
    trigger: "manual",
  });

  // Local dirs: scan in place (no --workspace-id clone). GitHub: keep stable clone path.
  const scanArgs = isLocalDir
    ? ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep"]
    : ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId];
  try {
    const { graph } = runScanScript(scanArgs);
    const { error: insErr } = await supabaseAdmin.from("graphs").insert({
      workspace_id: workspaceId,
      graph_json: graph,
      repo_url: repoUrl,
    });
    if (insErr) throw insErr;
    const scannedRoot =
      typeof (graph as { projectRoot?: string }).projectRoot === "string"
        ? (graph as { projectRoot: string }).projectRoot.trim()
        : isLocalDir
          ? path.resolve(repoUrl)
          : "";
    const fullName = repoNameFromUrl(repoUrl);
    const meta = await updateWorkspaceRepoMeta(supabaseAdmin, workspaceId, {
      repo_url: repoUrl,
      project_root: scannedRoot || null,
      github_full_name: fullName,
    });
    if (!meta.ok) {
      console.warn("[scan/refresh] workspace repo meta update failed:", meta.error);
      throw new Error(meta.error);
    }
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

    const commitMeta = readGitCommitMetadata(graphTyped.projectRoot ?? "");
    if (commitMeta) {
      recordGithubArchitectureEvent(supabaseAdmin, {
        workspaceId,
        eventType: "scan",
        sha: commitMeta.sha,
        branch: commitMeta.branch,
        authorLogin: commitMeta.authorLogin,
        message: commitMeta.message,
        githubUrl: repoNameFromUrl(repoUrl) ? `https://github.com/${repoNameFromUrl(repoUrl)}/commit/${commitMeta.sha}` : null,
      }).catch((e) => {
        console.warn("[scan/refresh] recordGithubArchitectureEvent failed:", e instanceof Error ? e.message : e);
      });
    }

    let reconciliation: ReconciliationResult | undefined;
    try {
      const priorDesign = await findPriorDesignGraph(workspaceId, graphId);
      if (priorDesign) {
        reconciliation = reconcileDesignToScan(priorDesign, graphTyped);
      }
    } catch (e) {
      console.warn("[scan/refresh] design reconciliation failed:", e instanceof Error ? e.message : e);
    }

    res.json({ ...graph, workspaceId, reconciliation });
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

/** D2 helper: expose .blanko-target local path when it exists on disk. */
router.get("/blanko-target", (_req, res) => {
  try {
    const t = readBlankoTarget(projectRoot);
    const local = t.local && fs.existsSync(t.local) ? t.local : null;
    const scanClone = t.scanClone && fs.existsSync(t.scanClone) ? t.scanClone : null;
    res.json({
      local,
      scanClone,
      tradingApiUrl: tradingApiUrl(),
      exists: !!(local || scanClone),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/**
 * Static≠live strip: probe trading middleware /health (default :4100).
 * Not vendor credit balances — runtime liveness only.
 */
router.get("/trading-runtime-health", optionalUser, async (_req, res) => {
  const base = tradingApiUrl().replace(/\/$/, "");
  const url = `${base}/health`;
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    const text = await r.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* */
    }
    res.json({
      ok: r.ok,
      status: r.status,
      url,
      latencyMs: Date.now() - started,
      body: json ?? text.slice(0, 200),
      note: "Live probe of trading middleware /health — not LLM vendor credits.",
    });
  } catch (e) {
    res.json({
      ok: false,
      status: 0,
      url,
      latencyMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
      note: "Live probe of trading middleware /health — not LLM vendor credits.",
    });
  }
});

/**
 * Live vendor key probes for Platforms strip.
 * Reads Anthropic/Groq keys from trading middleware .env (blanko-target local)
 * or process.env. Returns auth liveness + rate-limit remaining when vendors expose it.
 * Full $ balance requires vendor billing admin APIs (not available with standard API keys).
 */
router.get("/trading-vendor-credits", optionalUser, async (_req, res) => {
  const keys = loadTradingLlmKeys(projectRoot);
  let [anthropic, groq] = await Promise.all([
    probeAnthropicKey(keys.anthropic),
    probeGroqKey(keys.groq),
  ]);
  // If trading .env Anthropic is rejected, try Blanko root .env once.
  if (anthropic.configured && !anthropic.ok && anthropic.status === 401) {
    try {
      const blankoEnv = path.join(projectRoot, ".env");
      if (fs.existsSync(blankoEnv)) {
        const parsed = parseDotEnv(fs.readFileSync(blankoEnv, "utf8"));
        const alt = parsed.ANTHROPIC_API_KEY?.trim();
        if (alt && alt !== keys.anthropic) {
          const retry = await probeAnthropicKey(alt);
          if (retry.ok) {
            anthropic = { ...retry, detail: `${retry.detail} (blanko .env)` };
          }
        }
      }
    } catch {
      /* keep trading result */
    }
  }
  res.json({
    source: keys.source,
    primary: keys.primary,
    anthropic,
    groq,
    note:
      "Live API-key auth + rate-limit remaining when vendors send headers. Dollar balances need vendor billing/admin APIs.",
  });
});

function loadTradingLlmKeys(root: string): {
  anthropic: string;
  groq: string;
  primary: string;
  source: string;
} {
  const fromEnv = (k: string) => process.env[k]?.trim() || "";
  let anthropic = fromEnv("ANTHROPIC_API_KEY");
  let groq = fromEnv("GROQ_API_KEY");
  let primary = fromEnv("KELLY_PRIMARY_PROVIDER") || "anthropic";
  let source = anthropic || groq ? "process.env" : "none";
  try {
    const t = readBlankoTarget(root);
    const local = t.local && fs.existsSync(t.local) ? t.local : null;
    if (local) {
      const envPath = path.join(local, "middleware-platform", ".env");
      if (fs.existsSync(envPath)) {
        const parsed = parseDotEnv(fs.readFileSync(envPath, "utf8"));
        if (parsed.ANTHROPIC_API_KEY) anthropic = parsed.ANTHROPIC_API_KEY;
        if (parsed.GROQ_API_KEY) groq = parsed.GROQ_API_KEY;
        if (parsed.KELLY_PRIMARY_PROVIDER) primary = parsed.KELLY_PRIMARY_PROVIDER;
        source = envPath;
      }
    }
    // Fall back to Blanko root .env if trading keys empty
    const blankoEnv = path.join(root, ".env");
    if (fs.existsSync(blankoEnv)) {
      const parsed = parseDotEnv(fs.readFileSync(blankoEnv, "utf8"));
      if (!anthropic && parsed.ANTHROPIC_API_KEY) {
        anthropic = parsed.ANTHROPIC_API_KEY;
        source = `${source}+blanko:.env`;
      }
      if (!groq && parsed.GROQ_API_KEY) {
        groq = parsed.GROQ_API_KEY;
        source = `${source}+blanko:.env`;
      }
    }
  } catch {
    /* keep process.env */
  }
  return { anthropic, groq, primary, source };
}

function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || !s.includes("=")) continue;
    const i = s.indexOf("=");
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    // API keys pasted with spaces/newlines still auth-fail as 401 — strip interior ws.
    if (/_API_KEY$|_TOKEN$|_SECRET$/i.test(k)) {
      v = v.replace(/\s+/g, "");
    }
    out[k] = v;
  }
  return out;
}

type VendorProbe = {
  configured: boolean;
  ok: boolean;
  status: number;
  remainingRequests?: number | null;
  remainingTokens?: number | null;
  detail?: string;
};

async function probeAnthropicKey(key: string): Promise<VendorProbe> {
  if (!key) return { configured: false, ok: false, status: 0, detail: "missing key" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    // No token burn — list models is auth-only.
    const r = await fetch("https://api.anthropic.com/v1/models", {
      method: "GET",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const remReq = headerInt(r.headers, "anthropic-ratelimit-requests-remaining");
    const remTok = headerInt(r.headers, "anthropic-ratelimit-tokens-remaining");
    // 200 OK; some accounts return 404 on /models with a valid key — treat as auth ok.
    const ok = r.ok || r.status === 404;
    return {
      configured: true,
      ok,
      status: r.status,
      remainingRequests: remReq,
      remainingTokens: remTok,
      detail: ok ? (r.ok ? "auth ok" : `auth ok (HTTP ${r.status})`) : `HTTP ${r.status}`,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      status: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeGroqKey(key: string): Promise<VendorProbe> {
  if (!key) return { configured: false, ok: false, status: 0, detail: "missing key" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const remReq = headerInt(r.headers, "x-ratelimit-remaining-requests");
    const remTok = headerInt(r.headers, "x-ratelimit-remaining-tokens");
    return {
      configured: true,
      ok: r.ok,
      status: r.status,
      remainingRequests: remReq,
      remainingTokens: remTok,
      detail: r.ok ? "auth ok" : `HTTP ${r.status}`,
    };
  } catch (e) {
    return {
      configured: true,
      ok: false,
      status: 0,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

function headerInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Dev-only flag for client chat bypass alignment (BK-CHAT-006). */
router.get("/dev-flags", (_req, res) => {
  res.json({
    chatDevBypass: process.env.CHAT_DEV_BYPASS === "1",
  });
});

export { router as scanRoutes };
