import { Router } from "express";
import * as path from "path";
import { fileURLToPath } from "url";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { runScanScript, scanProjectRoot } from "./runScanScript.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot =
  process.env.PROJECT_ROOT?.trim() || scanProjectRoot || path.resolve(__dirname, "../../..");

const router = Router();

interface ArchGraphLike {
  nodes?: Array<{ id: string; label?: string; layer?: string }>;
  edges?: Array<{ source?: string; target?: string }>;
}

function computeDiff(base: ArchGraphLike, head: ArchGraphLike) {
  const baseNodeIds = new Set((base.nodes ?? []).map((n) => n.id));
  const headNodeIds = new Set((head.nodes ?? []).map((n) => n.id));
  const baseEdgeKeys = new Set(
    (base.edges ?? []).map((e) => `${e.source ?? ""}->${e.target ?? ""}`)
  );
  const headEdgeKeys = new Set(
    (head.edges ?? []).map((e) => `${e.source ?? ""}->${e.target ?? ""}`)
  );

  const nodesAdded = (head.nodes ?? []).filter((n) => !baseNodeIds.has(n.id));
  const nodesRemoved = (base.nodes ?? []).filter((n) => !headNodeIds.has(n.id));
  const edgesAdded = (head.edges ?? []).filter(
    (e) => !baseEdgeKeys.has(`${e.source ?? ""}->${e.target ?? ""}`)
  );
  const edgesRemoved = (base.edges ?? []).filter(
    (e) => !headEdgeKeys.has(`${e.source ?? ""}->${e.target ?? ""}`)
  );

  return {
    nodesAdded: nodesAdded.map((n) => ({ id: n.id, label: n.label, layer: n.layer })),
    nodesRemoved: nodesRemoved.map((n) => ({ id: n.id, label: n.label, layer: n.layer })),
    edgesAdded: edgesAdded.map((e) => ({ source: e.source, target: e.target })),
    edgesRemoved: edgesRemoved.map((e) => ({ source: e.source, target: e.target })),
    summary: {
      nodesAdded: nodesAdded.length,
      nodesRemoved: nodesRemoved.length,
      edgesAdded: edgesAdded.length,
      edgesRemoved: edgesRemoved.length,
    },
  };
}

/** Compute architecture diff between two branches. */
router.get(
  "/workspaces/:workspaceId/diff",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    const workspaceId = req.params.workspaceId!;
    const base = (req.query.base as string)?.trim() || "main";
    const head = (req.query.head as string)?.trim();
    if (!head) {
      res.status(400).json({ error: "head branch or ref is required" });
      return;
    }

    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth not configured." });
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
      res.status(404).json({ error: "No repo linked to this workspace." });
      return;
    }

    const repoUrl = (graphRow.repo_url as string).trim();
    if (!repoUrl.match(/github\.com[/:]/i)) {
      res.status(400).json({ error: "Workspace repo is not a GitHub URL." });
      return;
    }

    try {
      const { graph: graphBase } = runScanScript(
        ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId, "--branch", base],
        projectRoot
      ) as { graph: ArchGraphLike };

      const { graph: graphHead } = runScanScript(
        ["tsx", "scripts/scan-repo.ts", repoUrl, "--keep", "--workspace-id", workspaceId, "--branch", head],
        projectRoot
      ) as { graph: ArchGraphLike };

      const diff = computeDiff(graphBase as ArchGraphLike, graphHead as ArchGraphLike);
      res.json({ base, head, diff });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Diff failed: ${msg}` });
    }
  }
);

export { router as repoDiffRoutes };
