import { Router } from "express";
import { searchIssues, addLabel, listProjects } from "../../../src/jira/client.js";
import { requireUser } from "./middleware/requireUser.js";
import { getUserJiraConfig, getUserJiraConfigWithSource } from "./jiraConfig.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { isValidProjectKey } from "./utils/deriveProjectKey.js";
const router = Router();
/** Per-user: returns whether this user has Jira connected (DB or env fallback). */
router.get("/jira-status", requireUser, async (req, res) => {
    try {
        const result = await getUserJiraConfigWithSource(req.user.id);
        if (!result) {
            res.json({ configured: false });
            return;
        }
        res.json({
            configured: true,
            project: result.config.project ?? undefined,
            source: result.source,
        });
    }
    catch {
        res.json({ configured: false });
    }
});
function repoNameFromUrl(url) {
    const m = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:][\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
    return m?.[1] ?? null;
}
export async function getWorkspaceProjectKey(workspaceId) {
    if (!workspaceId || !supabaseAdmin)
        return null;
    const { data } = await supabaseAdmin
        .from("workspaces")
        .select("jira_project_key")
        .eq("id", workspaceId)
        .maybeSingle();
    return data?.jira_project_key ?? null;
}
/** List Jira projects the user can access (for project key dropdown). */
router.get("/jira-projects", requireUser, async (req, res) => {
    try {
        const config = await getUserJiraConfig(req.user.id);
        if (!config) {
            res.status(400).json({
                error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app.",
            });
            return;
        }
        const projects = await listProjects(config);
        res.json({ projects });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});
async function userOwnsWorkspace(workspaceId, userId) {
    if (!workspaceId || !supabaseAdmin)
        return !workspaceId;
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
        const config = await getUserJiraConfig(req.user.id);
        if (!config) {
            res.status(400).json({
                error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app.",
            });
            return;
        }
        const workspaceId = (typeof req.query.workspaceId === "string" ? req.query.workspaceId.trim() : null) || null;
        if (workspaceId && !(await userOwnsWorkspace(workspaceId, req.user.id))) {
            res.status(403).json({ error: "Workspace not found or access denied." });
            return;
        }
        const projectKeyOverride = (typeof req.query.projectKey === "string" ? req.query.projectKey.trim().toUpperCase() : null) || null;
        const project = (projectKeyOverride && isValidProjectKey(projectKeyOverride))
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
        const issues = await searchIssues(config, jql, 25);
        res.json({
            issues: issues.map((i) => ({
                key: i.key,
                summary: i.summary,
                status: i.status,
                type: i.type,
                priority: i.priority,
                baseUrl: config.baseUrl.replace(/\/$/, ""),
                labels: i.labels,
            })),
            repoName: repoName ?? undefined,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});
router.post("/jira-add-label", requireUser, async (req, res) => {
    try {
        const config = await getUserJiraConfig(req.user.id);
        if (!config) {
            res.status(400).json({ error: "Jira is not connected. Use the Governance panel to connect your Jira account in the web app." });
            return;
        }
        const { issueKey, label } = req.body;
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});
export { router as jiraRoutes };
