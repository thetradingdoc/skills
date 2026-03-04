import type { LogicPathStep, Rail, RailState, RailTrigger } from "./types";
import { createRail, resumeRail, getRailsByJiraKey, loadTemplateForArchetype } from "./rail/manager";

export function triggerFromViolation(params: {
  rootPath: string;
  violationId: string;
  outcome: string;
  sessionId: string;
}): Rail {
  const trigger: RailTrigger = { source: "governance", violationId: params.violationId };
  const now = Date.now();
  const archetype = "governance-violation";
  const tmpl = loadTemplateForArchetype(params.rootPath, archetype);
  const logicPath = tmpl?.logicPath?.length ? tmpl.logicPath : [];
  const rail: Rail = {
    id: `rail-${params.violationId}-${now}`,
    version: 1,
    outcome: params.outcome,
    trigger,
    archetype,
    logicPath,
    state: "PRE_PLANNING" as RailState,
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
  return createRail(params.rootPath, rail);
}

export function triggerFromChat(params: {
  rootPath: string;
  userMessage: string;
  sessionId: string;
  archetype?: string;
}): Rail {
  const trigger: RailTrigger = {
    source: "chat",
    userMessage: params.userMessage,
    sessionId: params.sessionId,
  };
  const now = Date.now();
  const rail: Rail = {
    id: `rail-chat-${now}`,
    version: 1,
    outcome: params.userMessage,
    trigger,
    archetype: params.archetype,
    logicPath: [],
    state: "PRE_PLANNING" as RailState,
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
  return createRail(params.rootPath, rail);
}

export function triggerFromJira(params: {
  rootPath: string;
  jiraKey: string;
  changeType: "created" | "updated" | "assigned";
  outcome: string;
  sessionId: string;
}): Rail {
  // Look for existing active rails for this Jira key via the registry index.
  const existingRails = getRailsByJiraKey(params.rootPath, params.jiraKey);
  const active = existingRails.find(
    (r) => r.state !== "ARCHIVED" && r.state !== "FAILED"
  );
  if (active) {
    return resumeRail(params.rootPath, active);
  }
  const trigger: RailTrigger = {
    source: "jira",
    jiraKey: params.jiraKey,
    changeType: params.changeType,
  };
  const now = Date.now();
  const archetype = "ui-api-external";
  const tmpl = loadTemplateForArchetype(params.rootPath, archetype);
  const logicPath = tmpl?.logicPath?.length ? tmpl.logicPath : [];
  const rail: Rail = {
    id: `rail-jira-${params.jiraKey}-${now}`,
    version: 1,
    outcome: params.outcome,
    trigger,
    archetype,
    logicPath,
    state: "PRE_PLANNING" as RailState,
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
  return createRail(params.rootPath, rail);
}

/**
 * Dogfood rail for the Governance "View issues" button.
 * Outcome: Governance "View issues" button always shows live, filtered Jira data for the selected project.
 */
export function triggerGovernanceViewIssues(params: {
  rootPath: string;
  sessionId: string;
  projectKey?: string;
}): Rail {
  const trigger: RailTrigger = { source: "governance", violationId: "view-issues" };
  const now = Date.now();

  const logicPath: LogicPathStep[] = [
    { step: 1, layer: "UI", nodeId: "webview-ui/src/App.tsx", filePath: "webview-ui/src/App.tsx", action: "RENDER_VIEW_ISSUES_BUTTON" },
    { step: 2, layer: "UI", nodeId: "webview-ui/src/App.tsx#GovernancePanel", filePath: "webview-ui/src/App.tsx", action: "PASS_ACTIVE_PROJECT_ID" },
    { step: 3, layer: "API", nodeId: "src/extension.ts#fetchJiraTests", filePath: "src/extension.ts", action: "HANDLE_FETCH_JIRA_TESTS" },
    { step: 4, layer: "Service", nodeId: "src/jira/client.ts#searchIssues", filePath: "src/jira/client.ts", action: "CALL_JIRA_GET_ISSUES" },
    { step: 5, layer: "External", nodeId: "jira-cloud-api", filePath: "", action: "RETURN_FILTERED_ISSUES" },
    { step: 6, layer: "API", nodeId: "webview-ui/src/App.tsx#GovernancePanel", filePath: "webview-ui/src/App.tsx", action: "VERIFY_VIEW_ISSUES_DATA" },
  ];

  const rail: Rail = {
    id: `rail-governance-view-issues-${now}`,
    version: 1,
    outcome:
      'Governance "View issues" button always shows live, filtered Jira data for the selected project',
    trigger,
    archetype: "ui-api-external",
    logicPath,
    state: "AWAITING_HITL" as RailState,
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

  return createRail(params.rootPath, rail);
}

