/**
 * P6 LLMOps routes — eval runs, runtime traces, node refs, shape drift.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { requireCanEdit } from "./middleware/requireCanEdit.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { computeAgentShapeDrift, driftSummary } from "./llmopsDrift.js";

const router = Router();

function migrationSoft(res: any, empty: Record<string, unknown>) {
  res.json({ ...empty, migrationPending: true });
}

router.get(
  "/workspaces/:workspaceId/nodes/:nodeId/llmops",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const { workspaceId, nodeId } = req.params;
    try {
      const [evals, traces, refs] = await Promise.all([
        supabaseAdmin
          .from("eval_runs")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("node_id", nodeId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("runtime_traces")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("node_id", nodeId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabaseAdmin
          .from("node_llmops_refs")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("node_id", nodeId)
          .maybeSingle(),
      ]);

      const missing =
        /does not exist|schema cache|eval_runs|runtime_traces|node_llmops/i.test(
          evals.error?.message ?? ""
        ) ||
        /does not exist|schema cache/i.test(traces.error?.message ?? "") ||
        /does not exist|schema cache/i.test(refs.error?.message ?? "");

      if (missing) {
        migrationSoft(res, {
          nodeId,
          evalRuns: [],
          traces: [],
          refs: null,
          latestEval: null,
        });
        return;
      }

      if (evals.error) {
        res.status(500).json({ error: evals.error.message });
        return;
      }
      if (traces.error) {
        res.status(500).json({ error: traces.error.message });
        return;
      }

      const evalRuns = evals.data ?? [];
      res.json({
        nodeId,
        evalRuns,
        traces: traces.data ?? [],
        refs: refs.data ?? null,
        latestEval: evalRuns[0] ?? null,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

router.post(
  "/workspaces/:workspaceId/eval-runs",
  requireUser,
  requireWorkspaceAccess,
  requireCanEdit,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const nodeId = String(req.body?.nodeId || "").trim();
    const status = String(req.body?.status || "").trim();
    if (!nodeId) {
      res.status(400).json({ error: "nodeId is required" });
      return;
    }
    if (!["pass", "fail", "error"].includes(status)) {
      res.status(400).json({ error: "status must be pass|fail|error" });
      return;
    }
    const { data, error } = await supabaseAdmin
      .from("eval_runs")
      .insert({
        workspace_id: req.params.workspaceId,
        node_id: nodeId,
        suite: req.body?.suite ?? null,
        status,
        score: req.body?.score != null ? Number(req.body.score) : null,
        threshold: req.body?.threshold != null ? Number(req.body.threshold) : null,
        metrics: req.body?.metrics ?? null,
        run_url: req.body?.runUrl ?? null,
        commit_sha: req.body?.commitSha ?? null,
      })
      .select("*")
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ evalRun: data });
  }
);

router.post(
  "/workspaces/:workspaceId/runtime-traces",
  requireUser,
  requireWorkspaceAccess,
  requireCanEdit,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const nodeId = String(req.body?.nodeId || "").trim();
    if (!nodeId) {
      res.status(400).json({ error: "nodeId is required" });
      return;
    }
    const status = req.body?.status === "error" ? "error" : "ok";
    const { data, error } = await supabaseAdmin
      .from("runtime_traces")
      .insert({
        workspace_id: req.params.workspaceId,
        node_id: nodeId,
        trace_url: req.body?.traceUrl ?? null,
        summary: req.body?.summary ?? null,
        latency_ms: req.body?.latencyMs != null ? Number(req.body.latencyMs) : null,
        status,
      })
      .select("*")
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ trace: data });
  }
);

router.put(
  "/workspaces/:workspaceId/nodes/:nodeId/llmops-ref",
  requireUser,
  requireWorkspaceAccess,
  requireCanEdit,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const { workspaceId, nodeId } = req.params;
    const { data, error } = await supabaseAdmin
      .from("node_llmops_refs")
      .upsert(
        {
          workspace_id: workspaceId,
          node_id: nodeId,
          prompt_ref: req.body?.promptRef ?? null,
          config_ref: req.body?.configRef ?? null,
          memory_node_id: req.body?.memoryNodeId ?? null,
          eval_node_id: req.body?.evalNodeId ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,node_id" }
      )
      .select("*")
      .maybeSingle();
    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ refs: data });
  }
);

router.post(
  "/workspaces/:workspaceId/llmops/drift",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const nodes = Array.isArray(req.body?.nodes) ? req.body.nodes : [];
    const edges = Array.isArray(req.body?.edges) ? req.body.edges : [];

    try {
      const agentIds = nodes
        .filter((n: any) => {
          const kind = String(n.kind ?? "").toLowerCase();
          const layer = String(n.layer ?? "").toLowerCase();
          const label = String(n.label ?? "").toLowerCase();
          return kind === "agent" || layer === "reasoning" || /\bagent\b|\brag\b/.test(label);
        })
        .map((n: any) => n.id as string);

      let evalRuns: any[] = [];
      let traces: any[] = [];
      if (agentIds.length > 0) {
        const [ev, tr] = await Promise.all([
          supabaseAdmin
            .from("eval_runs")
            .select("node_id, status, created_at")
            .eq("workspace_id", workspaceId)
            .in("node_id", agentIds)
            .order("created_at", { ascending: false })
            .limit(200),
          supabaseAdmin
            .from("runtime_traces")
            .select("node_id, status")
            .eq("workspace_id", workspaceId)
            .in("node_id", agentIds)
            .order("created_at", { ascending: false })
            .limit(200),
        ]);
        if (
          /does not exist|schema cache/i.test(ev.error?.message ?? "") ||
          /does not exist|schema cache/i.test(tr.error?.message ?? "")
        ) {
          // Still compute topology drift without live runs
          const drifts = computeAgentShapeDrift(nodes, edges, [], []);
          res.json({ drifts, summary: driftSummary(drifts), migrationPending: true });
          return;
        }
        evalRuns = ev.data ?? [];
        traces = tr.data ?? [];
      }

      const drifts = computeAgentShapeDrift(nodes, edges, evalRuns, traces);
      res.json({ drifts, summary: driftSummary(drifts) });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

export { router as llmopsRoutes };
