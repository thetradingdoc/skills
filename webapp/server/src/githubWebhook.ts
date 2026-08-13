import crypto from "crypto";
import { Router } from "express";
import * as path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { insertScanHistory, updateScanHistory } from "./scanHistory.js";
import { embedAndPersistNodes } from "../../../src/ai/nodeEmbeddings.js";
import { runViolationScan } from "./violationStore.js";
import { ARCH_RULESET_VERSION } from "../../../src/ai/critic.js";
import { runScanScript, scanProjectRoot } from "./runScanScript.js";
import { recordGithubArchitectureEvent } from "./githubArchEvents.js";
import {
  clearGithubInstallation,
  updateWorkspaceRepoMeta,
} from "./workspaceRepoMeta.js";
import { getInstallationToken, isGithubAppConfigured } from "./githubApp.js";
import { recordUsageEvent } from "./usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot =
  process.env.PROJECT_ROOT?.trim() || scanProjectRoot || path.resolve(__dirname, "../../..");

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET?.trim() || null;

/** Webhook scans are free attribution (cost 0); Import still consumes scan credits. */
const WEBHOOK_SCAN_COST_CENTS = 0;
const WEBHOOK_TASKS_MAX = 5;

const router = Router();

function verifySignature(payload: Buffer, signature: string): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Exported for unit tests — same HMAC check the webhook route uses. */
export function verifyGithubWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string | null = WEBHOOK_SECRET
): boolean {
  if (!secret || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Classify GitHub delivery before requiring repository.full_name.
 * Installation events often omit a top-level repository — must not 400.
 */
export function classifyGithubWebhookEvent(
  event: string | undefined
): "scan" | "installation_passthrough" | "ignored" {
  if (event === "push" || event === "pull_request") return "scan";
  if (event === "installation" || event === "installation_repositories") {
    return "installation_passthrough";
  }
  return "ignored";
}

function fullNameFromPayload(payload: Record<string, unknown>): string | null {
  const repo = payload.repository as { full_name?: string } | undefined;
  const name = repo?.full_name;
  return typeof name === "string" ? name : null;
}

function installationIdFromPayload(payload: Record<string, unknown>): number | null {
  const inst = payload.installation as { id?: number } | undefined;
  const id = Number(inst?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

type GithubCommit = {
  id?: string;
  message?: string;
  url?: string;
  author?: { name?: string; username?: string; email?: string };
  added?: string[];
  removed?: string[];
  modified?: string[];
};

async function fetchPullRequestChangedPaths(
  fullName: string,
  prNumber: number,
  installationId: number | null
): Promise<string[]> {
  if (!installationId || !isGithubAppConfigured()) return [];
  try {
    const { token } = await getInstallationToken(installationId);
    const paths: string[] = [];
    let page = 1;
    while (page <= 10) {
      const res = await fetch(
        `https://api.github.com/repos/${fullName}/pulls/${prNumber}/files?per_page=100&page=${page}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
      if (!res.ok) {
        console.warn("[githubWebhook] PR files fetch failed:", res.status);
        break;
      }
      const files = (await res.json()) as Array<{ filename?: string }>;
      for (const f of files) {
        if (typeof f.filename === "string") paths.push(f.filename);
      }
      if (files.length < 100) break;
      page += 1;
    }
    return paths;
  } catch (e) {
    console.warn(
      "[githubWebhook] PR changed_paths fetch error:",
      e instanceof Error ? e.message : e
    );
    return [];
  }
}

/** Everything the PM bridge needs out of a push/pull_request payload, in one place. */
async function archEventInputFromPayload(
  event: string,
  payload: Record<string, unknown>,
  opts?: { fullName?: string | null; installationId?: number | null }
): Promise<{
  eventType: "push" | "pull_request";
  changedPaths: string[];
  authorLogin: string | null;
  message: string | null;
  githubUrl: string | null;
  prNumber: number | null;
} | null> {
  if (event === "push") {
    const commits = Array.isArray(payload.commits) ? (payload.commits as GithubCommit[]) : [];
    const headCommit = payload.head_commit as GithubCommit | undefined;
    const changedPaths = new Set<string>();
    for (const c of commits) {
      for (const p of [...(c.added ?? []), ...(c.removed ?? []), ...(c.modified ?? [])]) {
        if (typeof p === "string") changedPaths.add(p);
      }
    }
    const last = headCommit ?? commits[commits.length - 1];
    const pusher = payload.pusher as { name?: string } | undefined;
    return {
      eventType: "push",
      changedPaths: Array.from(changedPaths),
      authorLogin: last?.author?.username ?? last?.author?.name ?? pusher?.name ?? null,
      message: last?.message ?? null,
      githubUrl: last?.url ?? null,
      prNumber: null,
    };
  }
  if (event === "pull_request") {
    const pr = payload.pull_request as
      | { number?: number; title?: string; html_url?: string; user?: { login?: string } }
      | undefined;
    if (!pr) return null;
    const prNumber = typeof pr.number === "number" ? pr.number : null;
    let changedPaths: string[] = [];
    if (prNumber != null && opts?.fullName) {
      changedPaths = await fetchPullRequestChangedPaths(
        opts.fullName,
        prNumber,
        opts.installationId ?? null
      );
    }
    return {
      eventType: "pull_request",
      changedPaths,
      authorLogin: pr.user?.login ?? null,
      message: pr.title ?? null,
      githubUrl: pr.html_url ?? null,
      prNumber,
    };
  }
  return null;
}

async function handleInstallationLifecycle(
  event: string,
  payload: Record<string, unknown>
): Promise<{ cleared?: number; action?: string }> {
  if (!supabaseAdmin) return {};
  const installationId = installationIdFromPayload(payload);
  if (!installationId) return {};

  if (event === "installation") {
    const action = String(payload.action ?? "");
    if (action === "deleted" || action === "suspend") {
      const cleared = await clearGithubInstallation(supabaseAdmin, installationId);
      const { clearInstallationTokenCache } = await import("./githubApp.js");
      clearInstallationTokenCache(installationId);
      return { cleared, action };
    }
    return { action };
  }

  if (event === "installation_repositories") {
    const action = String(payload.action ?? "");
    const removed = payload.repositories_removed as Array<{ full_name?: string }> | undefined;
    if (action === "removed" && Array.isArray(removed) && removed.length) {
      for (const r of removed) {
        const name = typeof r.full_name === "string" ? r.full_name.trim() : "";
        if (!name) continue;
        await supabaseAdmin
          .from("workspaces")
          .update({ github_installation_id: null })
          .eq("github_full_name", name)
          .eq("github_installation_id", installationId);
      }
    }
    return { action };
  }
  return {};
}

/** Optional Tasks enqueue from matched architecture nodes (Phase 3). */
async function enqueueGithubTasks(opts: {
  workspaceId: string;
  matchedNodeIds: string[];
  sha: string | null;
  message: string | null;
  authorLogin: string | null;
}): Promise<number> {
  if (!supabaseAdmin || opts.matchedNodeIds.length === 0) return 0;
  const nodes = opts.matchedNodeIds.slice(0, WEBHOOK_TASKS_MAX);
  let created = 0;
  for (const nodeId of nodes) {
    const sourcePath = `github:${opts.sha ?? "nosha"}:${nodeId}`;
    const title = opts.message
      ? `Review change on ${nodeId}: ${opts.message.slice(0, 80)}`
      : `Review GitHub change on ${nodeId}`;
    const { error } = await supabaseAdmin.from("todos").insert({
      workspace_id: opts.workspaceId,
      title,
      status: "todo",
      source: "github",
      source_path: sourcePath,
      source_node_id: nodeId,
      context: opts.authorLogin ? `Author: @${opts.authorLogin}` : null,
    });
    if (!error) created += 1;
    else if (!/unique|duplicate/i.test(error.message)) {
      console.warn("[githubWebhook] todo enqueue:", error.message);
    }
  }
  return created;
}

/** GitHub webhook: push and pull_request events trigger architecture scan for linked workspace. */
router.post("/", async (req, res) => {
  if (!WEBHOOK_SECRET) {
    res.status(503).json({ error: "GitHub webhook not configured." });
    return;
  }
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}), "utf-8");
  if (!verifySignature(body, sig ?? "")) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  const event = req.headers["x-github-event"] as string | undefined;
  const kind = classifyGithubWebhookEvent(event);

  if (kind === "installation_passthrough") {
    const result = await handleInstallationLifecycle(event ?? "", payload);
    res.status(200).json({ ok: true, ignored: false, event: event ?? null, ...result });
    return;
  }

  if (kind === "ignored") {
    res.status(200).json({ ok: true, ignored: true, event: event ?? null });
    return;
  }

  const fullName = fullNameFromPayload(payload);
  if (!fullName) {
    res.status(400).json({ error: "Repository full_name not found" });
    return;
  }

  const installationId = installationIdFromPayload(payload);

  let ref: string | undefined;
  let commitSha: string | undefined;
  if (event === "push") {
    ref = payload.ref as string | undefined;
    commitSha = payload.after as string | undefined;
  } else {
    const pr = payload.pull_request as { head?: { ref?: string; sha?: string } } | undefined;
    ref = pr?.head?.ref;
    commitSha = pr?.head?.sha;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth not configured" });
    return;
  }

  const { findWorkspaceIdByGithubFullName } = await import("./workspaceRepoMeta.js");
  const workspaceId = await findWorkspaceIdByGithubFullName(supabaseAdmin, fullName, {
    installationId,
  });

  if (!workspaceId) {
    res.status(200).json({ ok: true, noWorkspace: true });
    return;
  }

  const repoUrl = `https://github.com/${fullName}`;
  const branch = typeof ref === "string" ? ref.replace(/^refs\/heads\//, "") : undefined;

  const scanHistoryId = await insertScanHistory({
    workspaceId,
    status: "started",
    branch: branch ?? null,
    commitSha: commitSha ?? null,
    ref: ref ?? null,
    trigger: "webhook",
  });

  let nodeCount = 0;
  try {
    const scanArgs = ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId];
    const { graph } = runScanScript(scanArgs, projectRoot);

    const { data: graphInsert, error: gErr } = await supabaseAdmin
      .from("graphs")
      .insert({
        workspace_id: workspaceId,
        graph_json: graph,
        repo_url: repoUrl,
      })
      .select("id")
      .single();

    if (gErr) throw gErr;

    await updateWorkspaceRepoMeta(supabaseAdmin, workspaceId, {
      repo_url: repoUrl,
      github_full_name: fullName,
      ...(installationId ? { github_installation_id: installationId } : {}),
    });

    embedAndPersistNodes(
      graph as import("../../../src/types.js").ArchGraph,
      workspaceId,
      supabaseAdmin,
      process.env.OPENAI_API_KEY?.trim()
    ).catch(() => {});

    runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch(() => {});

    const archEventInput = await archEventInputFromPayload(event!, payload, {
      fullName,
      installationId,
    });
    let matchedNodeIds: string[] = [];
    if (archEventInput) {
      const recorded = await recordGithubArchitectureEvent(supabaseAdmin, {
        workspaceId,
        eventType: archEventInput.eventType,
        sha: commitSha ?? null,
        branch: branch ?? null,
        prNumber: archEventInput.prNumber,
        authorLogin: archEventInput.authorLogin,
        message: archEventInput.message,
        changedPaths: archEventInput.changedPaths,
        githubUrl: archEventInput.githubUrl,
      }).catch((e) => {
        console.warn(
          "[githubWebhook] recordGithubArchitectureEvent failed:",
          e instanceof Error ? e.message : e
        );
        return null;
      });
      matchedNodeIds = (recorded as { matched_node_ids?: string[] } | null)?.matched_node_ids ?? [];

      void enqueueGithubTasks({
        workspaceId,
        matchedNodeIds,
        sha: commitSha ?? null,
        message: archEventInput.message,
        authorLogin: archEventInput.authorLogin,
      }).catch(() => {});
    }

    // Attribution only — does not consume scan_credits (policy: webhook free).
    const { data: wsOwner } = await supabaseAdmin
      .from("workspaces")
      .select("owner_id")
      .eq("id", workspaceId)
      .maybeSingle();
    void recordUsageEvent(supabaseAdmin, {
      workspaceId,
      userId: (wsOwner as { owner_id?: string } | null)?.owner_id ?? null,
      source: "scan",
      costCents: WEBHOOK_SCAN_COST_CENTS,
      metadata: {
        trigger: "webhook",
        event: event ?? null,
        full_name: fullName,
        policy: "webhook_scan_free",
      },
    });

    nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
    const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
    if (scanHistoryId) {
      await updateScanHistory(scanHistoryId, {
        status: "completed",
        node_count: nodeCount,
        edge_count: edgeCount,
        completed_at: new Date().toISOString(),
        graph_id: (graphInsert as { id?: string })?.id ?? null,
      });
    }

    res.status(200).json({
      ok: true,
      workspaceId,
      nodeCount,
      matchedNodeIds: matchedNodeIds.length,
      changedPaths: archEventInput?.changedPaths.length ?? 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (scanHistoryId) {
      await updateScanHistory(scanHistoryId, {
        status: "failed",
        error_message: msg,
        completed_at: new Date().toISOString(),
      });
    }
    console.error("[githubWebhook] scan failed:", msg);
    res.status(500).json({ error: msg });
  }
});

export { router as githubWebhookRoutes };
