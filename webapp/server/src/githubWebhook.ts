import crypto from "crypto";
import { Router } from "express";
import { execFileSync } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { insertScanHistory, updateScanHistory } from "./scanHistory.js";
import { embedAndPersistNodes } from "../../../src/ai/nodeEmbeddings.js";
import { runViolationScan } from "./violationStore.js";
import { ARCH_RULESET_VERSION } from "../../../src/ai/critic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot =
  process.env.PROJECT_ROOT?.trim() || path.resolve(__dirname, "../../..");

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET?.trim() || null;

const router = Router();

function verifySignature(payload: Buffer, signature: string): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function fullNameFromPayload(payload: Record<string, unknown>): string | null {
  const repo = payload.repository as { full_name?: string } | undefined;
  const name = repo?.full_name;
  return typeof name === "string" ? name : null;
}

/** GitHub webhook: push and pull_request events trigger architecture scan for linked workspace. */
router.post("/", async (req, res) => {
  if (!WEBHOOK_SECRET) {
    res.status(503).json({ error: "GitHub webhook not configured." });
    return;
  }
  const sig = req.headers["x-hub-signature-256"] as string | undefined;
  // req.body is Buffer when using express.raw(); otherwise we can't verify
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
  const event = req.headers["x-github-event"] as string;
  const fullName = fullNameFromPayload(payload);

  if (!fullName) {
    res.status(400).json({ error: "Repository full_name not found" });
    return;
  }

  let ref: string | undefined;
  let commitSha: string | undefined;
  if (event === "push") {
    ref = payload.ref as string | undefined;
    commitSha = payload.after as string | undefined;
  } else if (event === "pull_request") {
    const pr = payload.pull_request as { head?: { ref?: string; sha?: string } } | undefined;
    ref = pr?.head?.ref;
    commitSha = pr?.head?.sha;
  } else {
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  if (!supabaseAdmin) {
    res.status(503).json({ error: "Auth not configured" });
    return;
  }

  const { data: ws } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("github_full_name", fullName)
    .is("archived_at", null)
    .maybeSingle();

  if (!ws) {
    res.status(200).json({ ok: true, noWorkspace: true });
    return;
  }

  const workspaceId = (ws as { id: string }).id;
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

  try {
    const scanArgs = ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId];
    const result = execFileSync("npx", scanArgs, {
      cwd: projectRoot,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });
    const graph = JSON.parse(result);

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

    await supabaseAdmin
      .from("workspaces")
      .update({ repo_url: repoUrl, github_full_name: fullName })
      .eq("id", workspaceId);

    embedAndPersistNodes(
      graph as import("../../../src/types.js").ArchGraph,
      workspaceId,
      supabaseAdmin,
      process.env.OPENAI_API_KEY?.trim()
    ).catch(() => {});

    runViolationScan(supabaseAdmin, workspaceId, graph, ARCH_RULESET_VERSION).catch(() => {});

    if (scanHistoryId) {
      const nodeCount = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
      const edgeCount = Array.isArray(graph.edges) ? graph.edges.length : 0;
      await updateScanHistory(scanHistoryId, {
        status: "completed",
        node_count: nodeCount,
        edge_count: edgeCount,
        completed_at: new Date().toISOString(),
        graph_id: (graphInsert as { id?: string })?.id ?? null,
      });
    }

    res.status(200).json({ ok: true, workspaceId, nodeCount: nodeCount ?? 0 });
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
