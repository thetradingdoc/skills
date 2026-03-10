import { Router } from "express";
import { searchIssues, addLabel, listProjects, getIssue, type JiraIssue } from "../../../src/jira/client.js";
import { detectStaleJira, extractFingerprintFromDescription } from "../../../src/agent/staleJiraDetector.js";
import type { ArchGraph } from "../../../src/types.js";
import { requireUser } from "./middleware/requireUser.js";
import { getUserJiraConfig, getUserJiraConfigWithSource, JiraDecryptError } from "./jiraConfig.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { markViolationResolvedFromJira } from "./violationStore.js";
import { isValidProjectKey } from "./utils/deriveProjectKey.js";

const router = Router();

/** Per-user: returns whether this user has Jira connected (DB or env fallback). */
router.get("/jira-status", requireUser, async (req, res) => {
  try {
    const result = await getUserJiraConfigWithSource(req.user!.id);
    if (!result) {
      res.json({ configured: false });
      return;
    }
    res.json({
      configured: true,
      project: result.config.project ?? undefined,
      source: result.source,
    });
  } catch (e) {
    if (e instanceof JiraDecryptError) {
      res.status(400).json({
        configured: false,
        error: "jira_decrypt_failed",
        message: e.message,
      });
      return;
    }
    res.json({ configured: false });
  }
});

function isJiraOpen(status: string): boolean {
  return !/done|resolved|closed|complete/i.test(status);
}

/** Sync violation policy_state from Jira: if a tracked ticket is resolved/closed, mark violation resolved. */
async function syncViolationsFromJiraStatus(
  workspaceId: string,
  config: { baseUrl: string; email: string; apiToken: string }
): Promise<void> {
  if (!supabaseAdmin) return;
  const { data: rows } = await supabaseAdmin
    .from("violations")
    .select("id, jira_key")
    .eq("workspace_id", workspaceId)
    .in("policy_state", ["tracked", "regressed"])
    .not("jira_key", "is", null);
  const violations = (rows ?? []) as Array<{ id: string; jira_key: string }>;
  for (const v of violations) {
    const key = v.jira_key?.trim();
    if (!key) continue;
    try {
      const issue = await getIssue(config, key);
      if (issue && !isJiraOpen(issue.status)) {
        await markViolationResolvedFromJira(supabaseAdmin, v.id, issue.status);
      }
    } catch {
      /* skip on API error */
    }
  }
}

function repoNameFromUrl(url: string): string | null {
  const m = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:][\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m?.[1] ?? null;
}

export async function getWorkspaceProjectKey(
  workspaceId: string | null
): Promise<string | null> {
  if (!workspaceId || !supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("jira_project_key")
    .eq("id", workspaceId)
    .maybeSingle();
  return (data as { jira_project_key?: string | null })?.jira_project_key ?? null;
}

/** Load latest graph for workspace from Supabase. TODO: revisit if large graphs become a bottleneck. */
export async function getGraphByWorkspaceId(
  workspaceId: string | null
): Promise<ArchGraph | null> {
  if (!workspaceId || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("graphs")
    .select("graph_json")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.graph_json) return null;
  return data.graph_json as ArchGraph;
}

/** List Jira projects the user can access (for project key dropdown). */
router.get("/jira-projects", requireUser, async (req, res) => {
  try {
    const config = await getUserJiraConfig(req.user!.id);
    if (!config) {
      res.status(400).json({
        error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app.",
      });
      return;
    }
    const projects = await listProjects(config);
    res.json({ projects });
  } catch (err: unknown) {
    if (err instanceof JiraDecryptError) {
      res.status(400).json({ error: err.message, code: "jira_decrypt_failed" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

async function userOwnsWorkspace(workspaceId: string | null, userId: string): Promise<boolean> {
  if (!workspaceId || !supabaseAdmin) return !workspaceId;
  const { data } = await supabaseAdmin
    .from("workspaces")
    .select("id")
    .eq("id", workspaceId)
    .eq("owner_id", userId)
    .single();
  return !!data;
}

router.get("/jira-issues", requireUser, async (req, res) => {
  try {
    const config = await getUserJiraConfig(req.user!.id);
    if (!config) {
      res.status(400).json({
        error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app.",
      });
      return;
    }
    const workspaceId = (typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : null) || null;
    if (workspaceId && !(await userOwnsWorkspace(workspaceId, req.user!.id))) {
      res.status(403).json({ error: "Workspace not found or access denied." });
      return;
    }
    const projectKeyOverride = (typeof req.query.projectKey === "string" ? req.query.projectKey.trim().toUpperCase() : null) || null;
    const project =
      (projectKeyOverride && isValidProjectKey(projectKeyOverride))
        ? projectKeyOverride
        : (await getWorkspaceProjectKey(workspaceId)) ?? config.project ?? null;
    if (!project) {
      res.status(422).json({
        error: "project_key_required",
        message: "Set a project key in the sidebar to fetch Jira issues.",
      });
      return;
    }
    let jql = `project = "${project}" AND resolution = Unresolved ORDER BY updated DESC`;
    const filterByRepo = req.query.filterByRepo !== "false" && req.query.filterByRepo !== "0";
    const repoUrl = typeof req.query.repoUrl === "string" ? req.query.repoUrl.trim() : "";
    const repoName = repoUrl ? repoNameFromUrl(repoUrl) : null;
    if (filterByRepo && repoName) {
      // repoName is safe for JQL injection — the capture group only allows \w, '.', '-'
      const labelClause = ` AND labels = '${repoName.replace(/'/g, "''")}'`;
      jql = /ORDER BY/i.test(jql)
        ? jql.replace(/\s*ORDER BY\s+/i, `${labelClause} ORDER BY `)
        : jql + labelClause;
    }
    const includeStaleDetection = req.query.includeStaleDetection === "true" || req.query.includeStaleDetection === "1";
    const issues = await searchIssues(config, jql, 25, {
      includeDescription: includeStaleDetection,
    });
    let staleMismatches: Array<{ key: string; summary: string; reason: string; storedModule: string | null }> | undefined;
    if (includeStaleDetection && workspaceId) {
      const graph = await getGraphByWorkspaceId(workspaceId);
      if (graph) {
        const issuesWithFp = issues.map((i) => {
          const { fingerprint, module: mod } = extractFingerprintFromDescription(i.description);
          return {
            key: i.key,
            summary: i.summary,
            status: i.status,
            storedFingerprint: fingerprint,
            storedModule: mod,
          };
        });
        const mismatches = detectStaleJira(graph, issuesWithFp);
        staleMismatches = mismatches.map((m) => ({
          key: m.key,
          summary: m.summary,
          reason: m.reason,
          storedModule: m.storedModule,
        }));
      }
    }
    if (workspaceId) {
      setImmediate(() => {
        syncViolationsFromJiraStatus(workspaceId, config).catch((err) =>
          console.warn("[jira] syncViolationsFromJiraStatus failed:", err instanceof Error ? err.message : err)
        );
      });
    }
    res.json({
      issues: issues.map((i: JiraIssue) => ({
        key: i.key,
        summary: i.summary,
        status: i.status,
        type: i.type,
        priority: i.priority,
        baseUrl: config.baseUrl.replace(/\/$/, ""),
        labels: i.labels,
      })),
      repoName: repoName ?? undefined,
      ...(staleMismatches && staleMismatches.length > 0 ? { staleMismatches } : {}),
    });
  } catch (err: unknown) {
    if (err instanceof JiraDecryptError) {
      res.status(400).json({ error: err.message, code: "jira_decrypt_failed" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

router.post("/jira-add-label", requireUser, async (req, res) => {
  try {
    const config = await getUserJiraConfig(req.user!.id);
    if (!config) {
      res.status(400).json({ error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app." });
      return;
    }
    const { issueKey, label } = req.body as { issueKey?: string; label?: string };
    if (!issueKey || !label) {
      res.status(400).json({ error: "issueKey and label required" });
      return;
    }
    if (label.length > 255) {
      res.status(400).json({ error: "label too long (max 255 chars)" });
      return;
    }
    const result = await addLabel(config, issueKey, label);
    if (!result.success) {
      res.status(500).json({ error: result.error ?? "Failed to add label" });
      return;
    }
    res.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof JiraDecryptError) {
      res.status(400).json({ error: err.message, code: "jira_decrypt_failed" });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export { router as jiraRoutes };
