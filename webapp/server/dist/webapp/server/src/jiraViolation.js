import * as crypto from "crypto";
import { Router } from "express";
import { requireUser } from "./middleware/requireUser.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { createIssue, getIssue } from "../../../src/jira/client.js";
import { markViolationTracked, buildViolationFingerprint } from "./violationStore.js";
import { getUserJiraConfig } from "./jiraConfig.js";
import { ARCH_RULESET_VERSION } from "../../../src/ai/critic.js";
const router = Router();
function computeModuleFingerprint(path, files) {
    const payload = `${path}:${files.length}:${[...files].sort().join(",")}`;
    return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
function triagePriority(severity) {
    const map = {
        critical: "Highest",
        high: "High",
        medium: "Medium",
        low: "Low",
    };
    return map[severity] ?? "Medium";
}
function repoNameFromPath(projectRoot) {
    if (!projectRoot)
        return null;
    const parts = projectRoot.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] ?? null;
}
function isJiraOpen(status) {
    return !/done|resolved|closed|complete/i.test(status);
}
async function getWorkspaceProjectKey(workspaceId) {
    if (!workspaceId || !supabaseAdmin)
        return null;
    const { data } = await supabaseAdmin
        .from("workspaces")
        .select("jira_project_key")
        .eq("id", workspaceId)
        .single();
    return data?.jira_project_key ?? null;
}
router.post("/jira-violation", requireUser, async (req, res) => {
    const config = await getUserJiraConfig(req.user.id);
    if (!config) {
        res.status(400).json({
            error: "Jira not connected. Click Connect Jira above to connect your account.",
        });
        return;
    }
    const { violationId, violation, projectRoot, projectName, workspaceId, archModulePath, archModuleFiles } = req.body;
    const userId = req.user.id;
    if (workspaceId && supabaseAdmin) {
        const { data: ws, error } = await supabaseAdmin
            .from("workspaces")
            .select("id")
            .eq("id", workspaceId)
            .eq("owner_id", userId)
            .single();
        if (error || !ws) {
            res.status(403).json({ error: "Workspace not found or access denied." });
            return;
        }
    }
    const projectKey = (await getWorkspaceProjectKey(workspaceId ?? null)) ?? config.project ?? null;
    if (!projectKey) {
        res.status(422).json({
            error: "project_key_required",
            message: "Set a project key in the sidebar to track violations in Jira.",
        });
        return;
    }
    let storedId = null;
    let existingJiraKey = null;
    let vType;
    let vSeverity;
    let vSourceNodeId;
    let vTargetNodeId;
    let vDescription;
    let vSuggestedFix;
    if (violationId && supabaseAdmin) {
        const { data: row, error } = await supabaseAdmin
            .from("violations")
            .select("*")
            .eq("id", violationId)
            .single();
        if (error || !row) {
            res.status(404).json({ error: "Violation not found" });
            return;
        }
        storedId = row.id;
        existingJiraKey = row.jira_key ?? null;
        vType = row.type;
        vSeverity = row.severity;
        vSourceNodeId = row.source_node_id;
        vTargetNodeId = row.target_node_id ?? undefined;
        vDescription = row.description ?? undefined;
        vSuggestedFix = row.suggested_fix ?? undefined;
    }
    else if (violation) {
        vType = violation.type;
        vSeverity = violation.severity;
        vSourceNodeId = violation.sourceNodeId;
        vTargetNodeId = violation.targetNodeId;
        vDescription = violation.description;
        vSuggestedFix = violation.suggestedFix;
    }
    else {
        res.status(400).json({ error: "violationId or violation is required" });
        return;
    }
    if (existingJiraKey) {
        try {
            const existing = await getIssue(config, existingJiraKey);
            if (existing && isJiraOpen(existing.status)) {
                res.json({
                    key: existingJiraKey,
                    existing: true,
                    status: existing.status,
                });
                return;
            }
        }
        catch {
            // ignore and fall through to create new ticket
        }
    }
    const repoName = repoNameFromPath(projectRoot ?? "");
    const labels = ["architecture", "littlelabs-auto"];
    if (repoName)
        labels.push(repoName);
    labels.push(`archNodeId:${vSourceNodeId}`.slice(0, 255));
    const summaryBase = vType.replace(/_/g, " ");
    const pathPart = vTargetNodeId
        ? `${vSourceNodeId} → ${vTargetNodeId}`
        : vSourceNodeId;
    const summary = `[ARCH] ${summaryBase}: ${pathPart}`;
    const modulePath = archModulePath ?? vSourceNodeId;
    const moduleFiles = Array.isArray(archModuleFiles) ? archModuleFiles : [];
    const fingerprint = modulePath && moduleFiles.length >= 0
        ? computeModuleFingerprint(modulePath, moduleFiles)
        : null;
    const descriptionLines = [
        "## Architecture Violation — LittleLabs",
        "",
        `**Type:** ${summaryBase}`,
        `**Severity:** ${vSeverity.toUpperCase()}`,
        `**Detected:** ${new Date().toISOString()}`,
        projectName ? `**Project:** ${projectName}` : "",
        projectRoot ? `**Root:** ${projectRoot}` : "",
        "",
        "### What was found",
        vDescription ?? "",
        "",
        "### Affected node(s)",
        `- Source: \`${vSourceNodeId}\``,
        vTargetNodeId ? `- Target: \`${vTargetNodeId}\`` : "",
        "",
        vSuggestedFix ? `### Suggested fix\n${vSuggestedFix}` : "",
        fingerprint ? `arch-fingerprint: ${fingerprint}` : "",
        `arch-module: ${modulePath}`,
        "",
        "---",
        "*Auto-generated by LittleLabs Architecture Intelligence*",
    ].filter(Boolean);
    const description = descriptionLines.join("\n");
    try {
        const issue = await createIssue({ baseUrl: config.baseUrl, email: config.email, apiToken: config.apiToken }, {
            projectKey,
            summary,
            description,
            labels,
            issueType: process.env.JIRA_ISSUE_TYPE ?? "Bug",
            priority: triagePriority(vSeverity),
        });
        if (storedId && supabaseAdmin) {
            await markViolationTracked(supabaseAdmin, storedId, issue.key, "To Do");
        }
        else if (!storedId && violation && workspaceId && supabaseAdmin) {
            const fp = buildViolationFingerprint({ type: vType, severity: vSeverity, sourceNodeId: vSourceNodeId, targetNodeId: vTargetNodeId }, ARCH_RULESET_VERSION);
            const { data: row } = await supabaseAdmin
                .from("violations")
                .select("id")
                .eq("workspace_id", workspaceId)
                .eq("fingerprint", fp)
                .eq("rules_version", ARCH_RULESET_VERSION)
                .maybeSingle();
            if (row?.id) {
                await markViolationTracked(supabaseAdmin, row.id, issue.key, "To Do");
            }
        }
        res.json({
            key: issue.key,
            url: `${config.baseUrl.replace(/\/$/, "")}/browse/${issue.key}`,
            existing: false,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
    }
});
export { router as jiraViolationRoutes };
