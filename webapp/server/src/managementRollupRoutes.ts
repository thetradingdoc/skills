/**
 * P7 management rollup routes — read-only for all workspace members including viewers.
 */
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { requireWorkspaceAccess } from "./middleware/requireWorkspaceAccess.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { buildManagementRollup, type RollupNode } from "./managementRollup.js";

const router = Router();

async function loadGraphNodes(workspaceId: string): Promise<RollupNode[]> {
  if (!supabaseAdmin) return [];
  try {
    const { data: graphRow } = await supabaseAdmin
      .from("graphs")
      .select("graph_json")
      .eq("workspace_id", workspaceId)
      .not("graph_json", "is", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const g = (graphRow as { graph_json?: { nodes?: unknown[] } } | null)?.graph_json;
    if (g?.nodes && Array.isArray(g.nodes)) {
      return g.nodes.map((n: any) => ({
        id: n.id,
        label: n.label,
        domain: n.domain,
        layer: n.layer,
        path: n.path,
        files: n.files,
      }));
    }
  } catch {
    /* fall through */
  }
  return [];
}

async function loadGithubRepoMeta(workspaceId: string): Promise<{
  fullName: string | null;
  installationId: number | null;
}> {
  if (!supabaseAdmin) return { fullName: null, installationId: null };
  try {
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select("github_full_name, github_installation_id, repo_url")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error || !data) {
      const { loadWorkspaceRepoFields } = await import("./workspaceRepoMeta.js");
      const ws = await loadWorkspaceRepoFields(supabaseAdmin, workspaceId);
      const name = ws?.github_full_name;
      if (typeof name === "string" && name.trim()) return { fullName: name.trim(), installationId: null };
      const repoUrl = ws?.repo_url;
      if (typeof repoUrl === "string") {
        const m = repoUrl.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
        if (m?.[1]) return { fullName: m[1], installationId: null };
      }
      return { fullName: null, installationId: null };
    }
    const row = data as {
      github_full_name?: string | null;
      github_installation_id?: number | null;
      repo_url?: string | null;
    };
    let fullName =
      typeof row.github_full_name === "string" && row.github_full_name.trim()
        ? row.github_full_name.trim()
        : null;
    if (!fullName && typeof row.repo_url === "string") {
      const m = row.repo_url.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i);
      if (m?.[1]) fullName = m[1];
    }
    const installationId =
      typeof row.github_installation_id === "number" && row.github_installation_id > 0
        ? row.github_installation_id
        : null;
    return { fullName, installationId };
  } catch {
    return { fullName: null, installationId: null };
  }
}

async function buildWorkspaceRollup(opts: {
  workspaceId: string;
  nodes: RollupNode[];
  usageDays: number;
  pastDueDays: number;
}) {
  const { workspaceId, nodes, usageDays, pastDueDays } = opts;
  const since = new Date(Date.now() - usageDays * 86400000).toISOString();

  const [claimsRes, findingsRes, eventsRes, usageRes, githubMeta] = await Promise.all([
    supabaseAdmin!
      .from("section_claims")
      .select("id, kind, target_id, claimer_id")
      .eq("workspace_id", workspaceId),
    supabaseAdmin!
      .from("workspace_findings")
      .select("id, title, severity, state, agent_file, first_seen_at, node_id")
      .eq("workspace_id", workspaceId),
    supabaseAdmin!
      .from("github_architecture_events")
      .select("created_at, event_type, author_login, github_url, matched_node_ids, message")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabaseAdmin!
      .from("usage_events")
      .select("node_id, cost_cents")
      .eq("workspace_id", workspaceId)
      .gte("created_at", since),
    loadGithubRepoMeta(workspaceId),
  ]);

  const claims = claimsRes.data ?? [];
  const findings = findingsRes.error ? [] : findingsRes.data ?? [];
  const events = eventsRes.error ? [] : eventsRes.data ?? [];
  const usage = usageRes.error ? [] : usageRes.data ?? [];
  const githubFullName = githubMeta.fullName;
  const githubInstallationId = githubMeta.installationId;

  const claimerIds = [...new Set(claims.map((c: any) => c.claimer_id as string))];
  const nickByUser = new Map<string, string>();
  if (claimerIds.length) {
    const { data: profiles } = await supabaseAdmin!
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", claimerIds);
    for (const p of profiles ?? []) {
      if ((p as any).nickname) nickByUser.set((p as any).user_id, (p as any).nickname);
    }
  }

  const rollup = buildManagementRollup({
    nodes,
    claims: claims.map((c: any) => ({
      id: c.id as string,
      kind: c.kind,
      target_id: c.target_id,
      claimer_id: c.claimer_id,
      nickname: nickByUser.get(c.claimer_id) ?? null,
    })),
    findings: findings as any,
    events: events as any,
    usage: usage as any,
    usageDays,
    pastDueDays,
  });

  return {
    ...rollup,
    githubFullName,
    githubInstallationId,
    viewerSafe: true as const,
    migrationNotes: {
      findings: !!findingsRes.error,
      events: !!eventsRes.error,
      usage: !!usageRes.error,
    },
  };
}

router.get(
  "/workspaces/:workspaceId/rollup",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const usageDays = Math.min(90, Math.max(1, Number(req.query.days) || 30));
    const pastDueDays = Math.min(90, Math.max(1, Number(req.query.pastDueDays) || 14));

    try {
      const nodes = await loadGraphNodes(workspaceId);
      const payload = await buildWorkspaceRollup({ workspaceId, nodes, usageDays, pastDueDays });
      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

/** POST with graph body — useful when client has fresher design/scan graph than DB snapshot. */
router.post(
  "/workspaces/:workspaceId/rollup",
  requireUser,
  requireWorkspaceAccess,
  async (req, res) => {
    if (!supabaseAdmin) {
      res.status(503).json({ error: "Auth service not configured." });
      return;
    }
    const workspaceId = req.params.workspaceId;
    const usageDays = Math.min(90, Math.max(1, Number(req.body?.days) || 30));
    const pastDueDays = Math.min(90, Math.max(1, Number(req.body?.pastDueDays) || 14));
    const bodyNodes = Array.isArray(req.body?.nodes) ? req.body.nodes : null;
    const nodes: RollupNode[] = bodyNodes
      ? bodyNodes.map((n: any) => ({
          id: n.id,
          label: n.label,
          domain: n.domain,
          layer: n.layer,
          path: n.path,
          files: n.files,
        }))
      : await loadGraphNodes(workspaceId);

    try {
      const payload = await buildWorkspaceRollup({ workspaceId, nodes, usageDays, pastDueDays });
      res.json(payload);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  }
);

export { router as managementRollupRoutes };
