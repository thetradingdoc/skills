"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerFromViolation = triggerFromViolation;
exports.triggerFromChat = triggerFromChat;
exports.triggerFromJira = triggerFromJira;
exports.triggerGovernanceViewIssues = triggerGovernanceViewIssues;
const manager_1 = require("./rail/manager");
function triggerFromViolation(params) {
    const trigger = { source: "governance", violationId: params.violationId };
    const now = Date.now();
    const archetype = "governance-violation";
    const tmpl = (0, manager_1.loadTemplateForArchetype)(params.rootPath, archetype);
    const logicPath = tmpl?.logicPath?.length ? tmpl.logicPath : [];
    const rail = {
        id: `rail-${params.violationId}-${now}`,
        version: 1,
        outcome: params.outcome,
        trigger,
        archetype,
        logicPath,
        state: "PRE_PLANNING",
        activeAgent: null,
        tasks: [],
        jiraKeys: [],
        traceIds: [],
        overlaps: [],
        createdAt: now,
        updatedAt: now,
        createdBy: "agent",
        sessionId: params.sessionId,
    };
    return (0, manager_1.createRail)(params.rootPath, rail);
}
function triggerFromChat(params) {
    const trigger = {
        source: "chat",
        userMessage: params.userMessage,
        sessionId: params.sessionId,
    };
    const now = Date.now();
    const rail = {
        id: `rail-chat-${now}`,
        version: 1,
        outcome: params.userMessage,
        trigger,
        archetype: params.archetype,
        logicPath: [],
        state: "PRE_PLANNING",
        activeAgent: null,
        tasks: [],
        jiraKeys: [],
        traceIds: [],
        overlaps: [],
        createdAt: now,
        updatedAt: now,
        createdBy: "human",
        sessionId: params.sessionId,
    };
    return (0, manager_1.createRail)(params.rootPath, rail);
}
function triggerFromJira(params) {
    // Look for existing active rails for this Jira key via the registry index.
    const existingRails = (0, manager_1.getRailsByJiraKey)(params.rootPath, params.jiraKey);
    const active = existingRails.find((r) => r.state !== "ARCHIVED" && r.state !== "FAILED");
    if (active) {
        return (0, manager_1.resumeRail)(params.rootPath, active);
    }
    const trigger = {
        source: "jira",
        jiraKey: params.jiraKey,
        changeType: params.changeType,
    };
    const now = Date.now();
    const archetype = "ui-api-external";
    const tmpl = (0, manager_1.loadTemplateForArchetype)(params.rootPath, archetype);
    const logicPath = tmpl?.logicPath?.length ? tmpl.logicPath : [];
    const rail = {
        id: `rail-jira-${params.jiraKey}-${now}`,
        version: 1,
        outcome: params.outcome,
        trigger,
        archetype,
        logicPath,
        state: "PRE_PLANNING",
        activeAgent: null,
        tasks: [],
        jiraKeys: [params.jiraKey],
        traceIds: [],
        overlaps: [],
        createdAt: now,
        updatedAt: now,
        createdBy: "agent",
        sessionId: params.sessionId,
    };
    return (0, manager_1.createRail)(params.rootPath, rail);
}
/**
 * Dogfood rail for the Governance "View issues" button.
 * Outcome: Governance "View issues" button always shows live, filtered Jira data for the selected project.
 */
function triggerGovernanceViewIssues(params) {
    const trigger = { source: "governance", violationId: "view-issues" };
    const now = Date.now();
    const logicPath = [
        { step: 1, layer: "UI", nodeId: "webview-ui/src/App.tsx", filePath: "webview-ui/src/App.tsx", action: "RENDER_VIEW_ISSUES_BUTTON" },
        { step: 2, layer: "UI", nodeId: "webview-ui/src/App.tsx#GovernancePanel", filePath: "webview-ui/src/App.tsx", action: "PASS_ACTIVE_PROJECT_ID" },
        { step: 3, layer: "API", nodeId: "src/extension.ts#fetchJiraTests", filePath: "src/extension.ts", action: "HANDLE_FETCH_JIRA_TESTS" },
        { step: 4, layer: "Service", nodeId: "src/jira/client.ts#searchIssues", filePath: "src/jira/client.ts", action: "CALL_JIRA_GET_ISSUES" },
        { step: 5, layer: "External", nodeId: "jira-cloud-api", filePath: "", action: "RETURN_FILTERED_ISSUES" },
        { step: 6, layer: "API", nodeId: "webview-ui/src/App.tsx#GovernancePanel", filePath: "webview-ui/src/App.tsx", action: "VERIFY_VIEW_ISSUES_DATA" },
    ];
    const rail = {
        id: `rail-governance-view-issues-${now}`,
        version: 1,
        outcome: 'Governance "View issues" button always shows live, filtered Jira data for the selected project',
        trigger,
        archetype: "ui-api-external",
        logicPath,
        state: "AWAITING_HITL",
        activeAgent: "reviewer",
        tasks: [],
        jiraKeys: params.projectKey ? [params.projectKey] : [],
        traceIds: [],
        overlaps: [],
        createdAt: now,
        updatedAt: now,
        createdBy: "agent",
        sessionId: params.sessionId,
    };
    return (0, manager_1.createRail)(params.rootPath, rail);
}
