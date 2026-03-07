"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const child_process_1 = require("child_process");
/** Extract repo name from git remote (e.g. doclittle-platform from github.com/owner/doclittle-platform) */
function getRepoNameFromGit(workspaceRoot) {
    try {
        const proc = (0, child_process_1.spawnSync)("git", ["remote", "get-url", "origin"], {
            cwd: workspaceRoot,
            encoding: "utf-8",
            maxBuffer: 4096,
        });
        const url = proc.stdout?.trim();
        if (!url)
            return null;
        const match = url.match(/(?:github\.com[/:]|gitlab\.com[/:]|bitbucket\.org[/:])[\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
        return match?.[1] ?? null;
    }
    catch {
        return null;
    }
}
const scanner_1 = require("./analyzer/scanner");
const driftDetector_1 = require("./analyzer/driftDetector");
const enricher_v2_1 = require("./ai/enricher-v2");
const mockEnricher_1 = require("./ai/mockEnricher");
const manager_1 = require("./ai/manager");
const graphAnalyser_1 = require("./analysis/graphAnalyser");
const watcher_1 = require("./watcher");
const contextReader_1 = require("./analyzer/contextReader");
const archRulesReader_1 = require("./analyzer/archRulesReader");
const generateRules_1 = require("./ai/generateRules");
const contractScanner_1 = require("./agent/contractScanner");
const referenceScanner_1 = require("./agent/referenceScanner");
const envScanner_1 = require("./agent/envScanner");
const client_1 = require("./jira/client");
const manager_2 = require("./agent/rail/manager");
const archetypes_1 = require("./agent/rail/archetypes");
const collisions_1 = require("./agent/rail/collisions");
const registry_1 = require("./agent/rail/registry");
const orchestrator_1 = require("./agent/rail/orchestrator");
const executor_1 = require("./agent/rail/executor");
const entrypoints_1 = require("./agent/entrypoints");
const agent_1 = require("./agent");
const runVisualCritique_1 = require("./agent/runVisualCritique");
const captureScreenshot_1 = require("./agent/captureScreenshot");
const telemetry_1 = require("./agent/rail/telemetry");
const plannerContext_1 = require("./agent/plannerContext");
let panel;
let watcher;
let graph;
/** Proactive scan started on panel open; "ready" handler awaits this to avoid double scan. */
let buildPromise = null;
let cachedFindings = null;
let lastConversationTurns = [];
/** Stale Jira mismatches from last fetch; used by runGateCheck. */
let lastStaleJiraMismatches = [];
let lastPlaywrightPassed = true;
/** Mapping from AgentPlan task ids to Rail TaskIds for orchestration. */
const planTaskToRailTask = {};
function getOpenAiApiKey() {
    return (vscode.workspace.getConfiguration("archVisualizer").get("openaiApiKey") ||
        process.env.OPENAI_API_KEY) ?? undefined;
}
function getAnthropicApiKey() {
    return (vscode.workspace.getConfiguration("archVisualizer").get("anthropicApiKey") ||
        process.env.ANTHROPIC_API_KEY) ?? undefined;
}
function useMockEnricher() {
    if (process.env.ARCH_TEST_MODE === "1")
        return true;
    return !getAnthropicApiKey() && !getOpenAiApiKey();
}
function getAgentActive() {
    return vscode.workspace.getConfiguration("archVisualizer").get("agentActive", true);
}
async function setAgentActive(active) {
    await vscode.workspace.getConfiguration("archVisualizer").update("agentActive", active, vscode.ConfigurationTarget.Global);
}
/** SUSPEND all rails in active execution states when agent is turned off. */
function suspendAllActiveRails(rootPath) {
    const activeStates = new Set(["EXECUTING", "AWAITING_HITL", "VERIFYING", "SELF_CORRECTING", "MATERIALIZING"]);
    const rails = (0, manager_2.getAllRails)();
    for (const rail of rails) {
        if (activeStates.has(rail.state)) {
            (0, orchestrator_1.transitionRail)(rootPath, rail.id, "SUSPENDED");
        }
    }
    persistAndNotifyTasks(rootPath);
}
function getModuleDir(rootPath, nodeId) {
    return path.join(rootPath, /\.[a-z]+$/i.test(nodeId) ? path.dirname(nodeId) : nodeId);
}
function sendStagingAndRecovery(rootPath) {
    const staging = (0, agent_1.getStagingEntries)();
    if (staging.length > 0) {
        send({
            type: "agentStagingEntries",
            entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
        });
    }
    const recovered = (0, agent_1.loadSession)(rootPath);
    if (recovered)
        send({ type: "agentSessionRecovery", session: recovered });
}
/** Section 12.3: Clean stale sandboxes; 7-day rule for SUSPENDED, emit warning trace. */
function cleanStaleSandboxes(rootPath) {
    try {
        const rails = (0, manager_2.getAllRails)();
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        const activeIds = new Set(rails
            .filter((r) => {
            if (r.state === "ARCHIVED" || r.state === "FAILED")
                return false;
            if (r.state === "SUSPENDED") {
                const ageMs = now - (r.updatedAt ?? r.createdAt);
                return ageMs <= sevenDaysMs;
            }
            return true;
        })
            .map((r) => r.id));
        const sandboxesRoot = path.join(rootPath, ".agent", "sandboxes");
        if (!fs.existsSync(sandboxesRoot))
            return;
        const entries = fs.readdirSync(sandboxesRoot, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const dirName = entry.name;
            if (!dirName.startsWith("rail-"))
                continue;
            const railId = dirName.replace(/^rail-/, "");
            const fullPath = path.join(sandboxesRoot, dirName);
            const rail = rails.find((r) => r.id === railId || dirName === r.id);
            const keep = activeIds.has(railId) || activeIds.has(dirName);
            if (!keep) {
                const isSuspendedStale = rail?.state === "SUSPENDED" &&
                    (now - (rail.updatedAt ?? rail.createdAt)) > sevenDaysMs;
                if (isSuspendedStale) {
                    (0, agent_1.initTraceLogger)();
                    (0, agent_1.emitTrace)({
                        role: "manager",
                        type: "info",
                        message: `Sandbox removed: rail ${railId} was SUSPENDED > 7 days`,
                        railId,
                    });
                }
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                }
                catch {
                    /* best-effort */
                }
            }
        }
    }
    catch {
        /* sandbox cleanup is best-effort */
    }
}
function sendTasksSnapshot(rootPath) {
    try {
        (0, manager_2.loadRails)(rootPath);
        const rails = (0, manager_2.getAllRails)();
        const registry = (0, registry_1.loadRegistry)(rootPath);
        for (const rail of rails) {
            if (rail.state === "ARCHIVED" || rail.state === "FAILED")
                continue;
            const overlaps = (0, collisions_1.checkRailCollisions)(rail, registry, (id) => (0, manager_2.getRail)(rootPath, id));
            if (overlaps.length > 0) {
                (0, manager_2.updateRailPartial)(rootPath, rail.id, { overlaps });
            }
        }
        const railsToSend = (0, manager_2.getAllRails)();
        const tasks = (0, manager_2.getAllTasks)();
        const railTelemetry = (0, telemetry_1.getAllRailTelemetry)();
        const retryLimit = vscode.workspace.getConfiguration("archVisualizer").get("retryLimitCode") ?? 3;
        const session = (0, agent_1.loadSession)(rootPath);
        const telemetry = {};
        for (const rail of railsToSend) {
            const t = railTelemetry.find((x) => x.railId === rail.id);
            const railTasks = tasks.filter((task) => task.railId === rail.id);
            const total = railTasks.length || 1;
            const completed = railTasks.filter((tx) => tx.status === "completed").length;
            const pathSuccessRate = t?.pathSuccessRate ?? completed / total;
            let retryCount = 0;
            if (pendingPlanRailId === rail.id && session?.retryCounts) {
                for (const [planTaskId, count] of Object.entries(session.retryCounts)) {
                    const railTaskId = planTaskToRailTask[planTaskId];
                    if (railTaskId && railTasks.some((rt) => rt.id === railTaskId)) {
                        retryCount = Math.max(retryCount, count);
                    }
                }
            }
            telemetry[rail.id] = {
                tokenUsage: t?.tokenUsage ?? 0,
                critiqueLoopCount: t?.critiqueLoopCount ?? 0,
                pathSuccessRate,
                ...(rail.state === "SELF_CORRECTING" && { retryCount, retryLimit }),
            };
        }
        send({
            type: "tasksSnapshot",
            rails: railsToSend,
            tasks,
            telemetry,
        });
    }
    catch {
        /* best-effort */
    }
}
/**
 * Lightweight violation extraction for the VS Code dashboard.
 *
 * Note: The extension host deliberately does NOT depend on Supabase workspaceIds.
 * It derives violations directly from the in-memory ArchGraph for the current
 * VS Code workspace, while the webapp/server is responsible for any persisted
 * workspaceId → violations mapping.
 */
function deriveViolationsFromGraph(g) {
    if (!g)
        return [];
    const nodes = g.nodes ?? [];
    const edges = g.edges ?? [];
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const violations = [];
    for (const e of edges) {
        const src = e.source;
        const tgt = e.target;
        const srcNode = nodeMap.get(src);
        const tgtNode = nodeMap.get(tgt);
        const srcLayer = srcNode?.layer ?? "Unknown";
        const tgtLayer = tgtNode?.layer ?? "Unknown";
        if (e.isLayerViolation) {
            violations.push({
                type: "layer_violation",
                severity: "high",
                sourceNodeId: src,
                targetNodeId: tgt,
                description: `${srcLayer} (${src}) should not depend on ${tgtLayer} (${tgt}). Lower layers depend on higher.`,
                suggestedFix: "Invert the dependency or move the module to a higher layer.",
            });
        }
        if (e.isDrift) {
            violations.push({
                type: "drift",
                severity: "medium",
                sourceNodeId: src,
                targetNodeId: tgt,
                description: e.driftReason ??
                    `${src} depends on ${tgt} (violates architecture rules).`,
                suggestedFix: "Remove the forbidden dependency or update the architecture rules.",
            });
        }
    }
    return violations;
}
/** Section 11.1: Incremental task update. */
function sendTaskUpdate(taskId, update) {
    send({ type: "taskUpdate", taskId, update });
}
/** Section 11.1: Incremental rail update. */
function sendRailUpdate(railId, update) {
    send({ type: "railUpdate", railId, update });
}
/** Section 12.2: Persist and notify after rail/task mutations. */
function persistAndNotifyTasks(rootPath) {
    try {
        (0, manager_2.saveRails)(rootPath);
        sendTasksSnapshot(rootPath);
    }
    catch {
        /* best-effort */
    }
}
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand("arch-visualizer.open", () => openPanel(context)), vscode.commands.registerCommand("arch-visualizer.checkGates", () => runCheckGatesCommand()));
}
async function openPanel(context) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.[0]) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration("archVisualizer");
    const projectRoot = config.get("projectRoot") ?? ".";
    const fixturePath = process.env.ARCH_FIXTURE_PATH;
    const rootPath = fixturePath
        ? path.resolve(workspaceRoot, fixturePath)
        : path.join(workspaceRoot, projectRoot);
    if (panel) {
        buildPromise = null;
        panel.reveal(vscode.ViewColumn.Two);
        return;
    }
    panel = vscode.window.createWebviewPanel("archVisualizer", "Architecture Map", vscode.ViewColumn.Two, {
        enableScripts: true,
        localResourceRoots: [
            vscode.Uri.joinPath(context.extensionUri, "webview-ui", "dist"),
        ],
    });
    panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
    (0, agent_1.initStaging)(rootPath);
    (0, manager_2.loadRails)(rootPath);
    cleanStaleSandboxes(rootPath);
    buildPromise = buildAndSendGraph(rootPath);
    (0, agent_1.subscribeTrace)((entry) => {
        const ctx = (0, agent_1.getTraceContext)();
        const role = entry.stepType === "gate" || entry.stepType === "plan" ? "manager" : "executor";
        const eventType = entry.stepType === "error" ? "error" : ["read_file", "write_file", "run_lint", "run_vitest"].includes(entry.stepType) ? "tool_call" : "info";
        send({
            type: "agentTrace",
            entry: {
                id: entry.id,
                sessionId: entry.sessionId,
                timestamp: entry.timestamp,
                stepType: entry.stepType,
                input: entry.input,
                output: entry.output,
                decision: entry.decision,
                reasoning: entry.reasoning,
                llmCallCount: entry.llmCallCount,
                tokenUsage: entry.tokenUsage,
                railId: ctx.railId,
                role,
                eventType,
                metadata: ctx.logicPathStep || ctx.filePath
                    ? { logicPathStep: ctx.logicPathStep, filePath: ctx.filePath }
                    : undefined,
            },
        });
    });
    (0, agent_1.subscribeAgentTrace)((entry) => {
        send({
            type: "agentTrace",
            entry: {
                id: entry.id,
                sessionId: (0, agent_1.getSessionId)(),
                timestamp: new Date(entry.timestamp).toISOString(),
                stepType: entry.type,
                input: { message: entry.message },
                output: entry.taskId ? { taskId: entry.taskId } : {},
                decision: entry.message,
                railId: entry.railId,
                role: entry.role,
                eventType: entry.type,
                metadata: entry.metadata,
            },
        });
    });
    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.type === "ready") {
            await (buildPromise ?? buildAndSendGraph(rootPath));
            buildPromise = null;
            if (graph)
                send({ type: "graph", data: graph });
            sendStagingAndRecovery(rootPath);
            persistAndNotifyTasks(rootPath);
            send({ type: "agentActive", active: getAgentActive() });
        }
        if (msg.type === "refresh") {
            await buildAndSendGraph(rootPath);
            sendStagingAndRecovery(rootPath);
        }
        if (msg.type === "setAgentActive") {
            await setAgentActive(msg.active);
            if (!msg.active)
                suspendAllActiveRails(rootPath);
            send({ type: "agentActive", active: msg.active });
        }
        if (msg.type === "openTaskFile") {
            const fullPath = path.join(rootPath, msg.filePath.replace(/\\/g, "/"));
            if (fs.existsSync(fullPath)) {
                const uri = vscode.Uri.file(fullPath);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
            }
        }
        if (msg.type === "askAI" && graph) {
            if (!getAgentActive()) {
                send({ type: "aiResponse", answer: "[Agent paused] Enable the agent toggle to use AI features." });
                return;
            }
            const STALENESS_MS = 5 * 60 * 1000; // 5 minutes
            if (Date.now() - graph.generatedAt > STALENESS_MS) {
                await buildAndSendGraph(rootPath);
            }
            const g = graph;
            if (!cachedFindings) {
                cachedFindings = [
                    ...(0, contractScanner_1.scanContracts)(rootPath),
                    ...(0, referenceScanner_1.scanDocumentReferences)(rootPath),
                    ...(0, envScanner_1.scanEnvironmentGaps)(rootPath),
                ];
            }
            const findings = cachedFindings;
            if (Array.isArray(msg.history)) {
                lastConversationTurns = msg.history
                    .filter((m) => m &&
                    (m.role === "user" || m.role === "assistant") &&
                    typeof m.content === "string")
                    .slice(-4)
                    .map((m) => ({ role: m.role, content: m.content }));
            }
            const isEmptyGraph = !g.nodes || g.nodes.length === 0;
            const mode = isEmptyGraph ? "greenfield" : "analysis";
            const resolvedRootPath = mode === "analysis" && rootPath ? rootPath : null;
            if (useMockEnricher()) {
                const mockResult = await (0, mockEnricher_1.askAboutArchitecture)(msg.question, g, msg.nodeId, msg.history, undefined, findings);
                send({
                    type: "aiResponse",
                    answer: mockResult.answer,
                    ...(mockResult.graphCommand ? { graphCommand: mockResult.graphCommand } : {}),
                });
            }
            else {
                const result = await (0, manager_1.runArchitectureTask)({
                    question: msg.question,
                    graph: g,
                    nodeId: msg.nodeId,
                    history: msg.history,
                    mode,
                    apiKeyOpenAI: getOpenAiApiKey(),
                    apiKeyClaude: getAnthropicApiKey(),
                    findings,
                    rootPath: resolvedRootPath,
                    rail: pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) ?? undefined : undefined,
                });
                send({
                    type: "aiResponse",
                    answer: result.answer,
                    ...(result.graphCommand ? { graphCommand: result.graphCommand } : {}),
                    ...(result.violations ? { violations: result.violations } : {}),
                    ...((result.proposal)
                        ? { proposal: result.proposal }
                        : {}),
                });
            }
        }
        if (msg.type === "openInEditor") {
            const modulePath = getModuleDir(rootPath, msg.nodeId);
            const contextPath = path.join(modulePath, ".context.md");
            if (fs.existsSync(contextPath)) {
                const uri = vscode.Uri.file(contextPath);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
            }
            else {
                const uri = vscode.Uri.file(modulePath);
                await vscode.commands.executeCommand("revealInExplorer", uri);
            }
        }
        if (msg.type === "openFile") {
            const moduleDir = getModuleDir(rootPath, msg.nodeId);
            const filePath = path.join(moduleDir, msg.filePath);
            if (fs.existsSync(filePath)) {
                const uri = vscode.Uri.file(filePath);
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc, { preview: false });
            }
        }
        if (msg.type === "readFileContent") {
            const moduleDir = getModuleDir(rootPath, msg.nodeId);
            const fullPath = path.join(moduleDir, msg.filePath);
            try {
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, "utf-8");
                    send({ type: "fileContent", filePath: msg.filePath, content });
                }
                else {
                    send({ type: "fileContent", filePath: msg.filePath, content: null, error: "File not found" });
                }
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                send({ type: "fileContent", filePath: msg.filePath, content: null, error });
            }
        }
        if (msg.type === "writeContext") {
            try {
                const moduleDir = getModuleDir(rootPath, msg.nodeId);
                (0, contextReader_1.writeContextFile)({
                    modulePath: moduleDir,
                    layer: msg.layer,
                    description: msg.description,
                    role: msg.role,
                });
                send({ type: "writeContextResult", success: true });
                await buildAndSendGraph(rootPath);
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                send({ type: "writeContextResult", success: false, error });
            }
        }
        if (msg.type === "generateRules" && graph) {
            try {
                send({ type: "loading", message: "Generating rules..." });
                // Rules generation stays on OpenAI for cost reasons; Claude is used for live reasoning.
                const config = await (0, generateRules_1.generateArchRules)(graph, getOpenAiApiKey());
                const rules = config.rules.map((r) => ({
                    id: r.id,
                    description: r.description,
                    severity: r.severity,
                }));
                send({ type: "rulesPreview", rules, raw: JSON.stringify(config, null, 2) });
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                send({ type: "generateRulesResult", success: false, error });
            }
        }
        if (msg.type === "writeRules") {
            try {
                const config = JSON.parse(msg.raw);
                (0, archRulesReader_1.writeArchRules)(rootPath, config);
                send({ type: "generateRulesResult", success: true });
                await buildAndSendGraph(rootPath);
            }
            catch (err) {
                const error = err instanceof Error ? err.message : String(err);
                send({ type: "generateRulesResult", success: false, error });
            }
        }
        if (msg.type === "fetchJiraTests") {
            try {
                const config = (0, client_1.getJiraConfig)();
                if (!config) {
                    send({ type: "jiraIssuesError", error: "Jira not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)" });
                    return;
                }
                const cfg = vscode.workspace.getConfiguration("archVisualizer");
                const projectFromMsg = typeof msg.projectKey === "string" && msg.projectKey.trim()
                    ? msg.projectKey.trim()
                    : undefined;
                const projectFromConfig = (cfg.get("jiraProject") ?? "").trim() || undefined;
                const projectFromEnv = process.env.JIRA_PROJECT?.trim();
                const project = projectFromMsg ?? projectFromConfig ?? projectFromEnv;
                if (projectFromMsg && projectFromMsg !== projectFromConfig) {
                    void cfg.update("jiraProject", projectFromMsg, vscode.ConfigurationTarget.Workspace);
                }
                // Create a governance rail for the "View issues" flow so we can dogfood the Rails model.
                const governanceRail = (0, entrypoints_1.triggerGovernanceViewIssues)({
                    rootPath,
                    sessionId: "governance-view-issues",
                    projectKey: project,
                });
                let jql = process.env.JIRA_JQL?.trim() ||
                    (project
                        ? `project = ${project} AND resolution = Unresolved ORDER BY updated DESC`
                        : "resolution = Unresolved ORDER BY updated DESC");
                const explicitLabels = cfg.get("jiraLabels");
                const filterByRepo = msg.filterByRepo ?? cfg.get("jiraFilterByRepo") ?? true;
                let labelClause = "";
                if (filterByRepo) {
                    if (Array.isArray(explicitLabels) && explicitLabels.length > 0) {
                        const quoted = explicitLabels.map((l) => `'${String(l).replace(/'/g, "''")}'`).join(", ");
                        labelClause = ` AND labels in (${quoted})`;
                    }
                    else {
                        const repoName = getRepoNameFromGit(workspaceRoot);
                        if (repoName) {
                            labelClause = ` AND labels = '${repoName.replace(/'/g, "''")}'`;
                        }
                    }
                }
                if (labelClause) {
                    jql = /ORDER BY/i.test(jql)
                        ? jql.replace(/\s*ORDER BY\s+/i, `${labelClause} ORDER BY `)
                        : jql + labelClause;
                }
                const issues = await (0, client_1.searchIssues)(config, jql, 25, { includeDescription: true });
                const baseUrl = config.baseUrl.replace(/\/$/, "");
                const issuesWithFp = issues.map((i) => {
                    const { fingerprint, module: mod } = (0, agent_1.extractFingerprintFromDescription)(i.description);
                    return {
                        key: i.key,
                        summary: i.summary,
                        status: i.status,
                        storedFingerprint: fingerprint,
                        storedModule: mod,
                    };
                });
                let staleMismatches = [];
                if (graph) {
                    staleMismatches = (0, agent_1.detectStaleJira)(graph, issuesWithFp);
                }
                lastStaleJiraMismatches = staleMismatches;
                const repoName = getRepoNameFromGit(workspaceRoot);
                send({
                    // cast to any to allow sending projectKey until ExtToWebMessage is updated
                    type: "jiraIssues",
                    issues: issues.map((i) => ({ ...i, baseUrl })),
                    repoName,
                    staleMismatches: staleMismatches.length > 0 ? staleMismatches : undefined,
                    ...(project ? { projectKey: project } : {}),
                });
                // Section 13: Attach governance tasks (T3 and T6 HITL gates).
                if (governanceRail) {
                    const railId = governanceRail.id;
                    const now = Date.now();
                    (0, agent_1.initTraceLogger)();
                    (0, agent_1.setTraceContext)({ railId, taskId: undefined, logicPathStep: "1: UI - RENDER_VIEW_ISSUES_BUTTON", filePath: "webview-ui/src/App.tsx" });
                    (0, agent_1.emitTrace)({ role: "manager", type: "info", message: "Governance rail created", railId });
                    (0, agent_1.clearTraceContext)();
                    const t1 = { id: `${railId}-t1`, railId, kind: "code_change", description: "Render View Issues button", files: ["webview-ui/src/App.tsx"], autoCapable: true, status: "completed", agent: "executor", logicStep: 1, createdAt: now, resolvedAt: now };
                    const t2 = { id: `${railId}-t2`, railId, kind: "code_change", description: "Pass active project ID", files: ["webview-ui/src/App.tsx"], autoCapable: true, status: "completed", agent: "executor", logicStep: 2, createdAt: now, resolvedAt: now };
                    (0, manager_2.createTask)(t1);
                    (0, manager_2.createTask)(t2);
                    const t3 = {
                        id: `${railId}-t3`,
                        railId,
                        kind: "governance_sync",
                        description: "Confirm fetch Jira for project " + (project ?? "(all)"),
                        files: ["src/extension.ts"],
                        autoCapable: false,
                        status: "awaiting_hitl",
                        agent: "reviewer",
                        logicStep: 3,
                        hitlPrompt: "Approve to fetch Jira issues (already fetched). Confirm API call for " + (project ?? "all projects") + ".",
                        jiraKey: project ?? undefined,
                        createdAt: now,
                    };
                    (0, manager_2.createTask)(t3);
                    const t4 = { id: `${railId}-t4`, railId, kind: "governance_sync", description: "Call Jira GET issues", files: ["src/jira/client.ts"], autoCapable: true, status: "completed", agent: "executor", logicStep: 4, evidence: jql, jiraKey: project ?? undefined, createdAt: now, resolvedAt: now };
                    const t5 = { id: `${railId}-t5`, railId, kind: "governance_sync", description: "Return filtered issues", files: [], autoCapable: true, status: "completed", agent: "executor", logicStep: 5, evidence: `${issues.length} issues`, jiraKey: project ?? undefined, createdAt: now, resolvedAt: now };
                    (0, manager_2.createTask)(t4);
                    (0, manager_2.createTask)(t5);
                    const t6 = {
                        id: `${railId}-t6`,
                        railId,
                        kind: "verification",
                        description: 'Verify "View issues" shows live Jira data for project ' + (project ?? "(all)"),
                        files: ["webview-ui/src/App.tsx"],
                        autoCapable: false,
                        status: "awaiting_hitl",
                        agent: "reviewer",
                        logicStep: 6,
                        hitlPrompt: 'Open Governance panel and confirm "View issues" reflects latest Jira for ' + (project ?? "all") + ".",
                        jiraKey: project ?? undefined,
                        createdAt: now,
                    };
                    (0, manager_2.createTask)(t6);
                    persistAndNotifyTasks(rootPath);
                }
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                send({ type: "jiraIssuesError", error: message });
            }
        }
        if (msg.type === "jiraSettingsHelp") {
            vscode.window.showInformationMessage("Jira for the Architecture Map extension is configured via environment variables: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (and optional JIRA_PROJECT/JIRA_JQL). Update those and reload VS Code to change Jira settings.");
        }
        if (msg.type === "requestPlan") {
            handleRequestPlan(rootPath, msg.goal);
        }
        if (msg.type === "approveDesign") {
            try {
                const plan = convertDesignToPlan(msg.proposal);
                pendingPlan = plan;
                (0, agent_1.emitTrace)({
                    role: "manager",
                    type: "info",
                    message: "Design approved → created AgentPlan from proposal",
                    railId: pendingPlanRailId ?? undefined,
                });
                send({
                    type: "agentPlan",
                    plan: {
                        goal: plan.goal,
                        tasks: plan.tasks.map((t) => ({
                            id: t.id,
                            module: t.module,
                            layer: t.layer,
                            action: t.action,
                            expectedOutput: t.expectedOutput,
                        })),
                        dependencies: plan.dependencies,
                    },
                });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                vscode.window.showErrorMessage(`Failed to convert design to plan: ${message}`);
            }
        }
        if (msg.type === "agentPlanAction") {
            await handleAgentPlanAction(msg.action, msg.editFeedback, rootPath);
            runGateCheck(rootPath);
            const session = (0, agent_1.loadSession)(rootPath);
            if (session)
                send({ type: "agentSessionUpdate", session });
        }
        if (msg.type === "agentDiffApprove") {
            const r = (0, agent_1.commitStaging)(msg.paths, rootPath);
            if (r.success) {
                send({ type: "agentStagingEntries", entries: [] });
                checkJiraResolveAfterCommit(rootPath, msg.paths, graph);
                const session = (0, agent_1.loadSession)(rootPath);
                if (session && pendingPlan) {
                    setImmediate(async () => {
                        // If we have an associated plan rail, sync changed files into its sandbox and test there.
                        let sandboxDir;
                        if (pendingPlanRailId) {
                            sandboxDir = (0, executor_1.syncSandboxFromRoot)(rootPath, pendingPlanRailId, msg.paths ?? []);
                        }
                        const workingDir = sandboxDir ?? rootPath;
                        const lint = (0, agent_1.runLint)(rootPath, msg.paths, workingDir);
                        const vitest = (0, agent_1.runVitest)(rootPath, undefined, workingDir);
                        let passed = lint.passed && vitest.passed;
                        if (!passed) {
                            const errorOutput = [
                                !lint.passed ? `Lint errors:\n${JSON.stringify(lint.errors.slice(0, 20), null, 2)}` : "",
                                !vitest.passed
                                    ? `Vitest failures:\n${JSON.stringify(vitest.failures.slice(0, 10), null, 2)}`
                                    : "",
                            ]
                                .filter(Boolean)
                                .join("\n\n");
                            const curIndex = session.currentTaskIndex ?? 0;
                            const taskId = pendingPlan.tasks[curIndex]?.id;
                            if (taskId) {
                                session.retryCounts[taskId] = (session.retryCounts[taskId] ?? 0) + 1;
                                const railTaskId = planTaskToRailTask[taskId];
                                if (railTaskId && pendingPlanRailId) {
                                    (0, manager_2.updateTaskStatus)(railTaskId, "awaiting_hitl");
                                }
                            }
                            (0, agent_1.saveSession)(rootPath, session);
                            send({ type: "agentSessionUpdate", session });
                            runGateCheck(rootPath);
                            const railForFix = pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) : null;
                            const railTaskForFix = taskId ? (0, manager_2.getTask)(planTaskToRailTask[taskId] ?? "") : null;
                            const stepFix = railForFix?.logicPath?.[railTaskForFix?.logicStep ?? 0];
                            (0, agent_1.setTraceContext)({
                                railId: pendingPlanRailId ?? undefined,
                                taskId: planTaskToRailTask[taskId] ?? undefined,
                                logicPathStep: stepFix ? `${stepFix.step}: ${stepFix.layer} - ${stepFix.filePath}` : undefined,
                                filePath: stepFix?.filePath,
                            });
                            if (pendingPlanRailId) {
                                (0, manager_2.updateRailPartial)(rootPath, pendingPlanRailId, {
                                    lastCritique: {
                                        source: !lint.passed || !vitest.passed ? "test" : "unknown",
                                        message: errorOutput,
                                        createdAt: Date.now(),
                                    },
                                });
                            }
                            if (pendingPlanRailId && taskId) {
                                (0, manager_2.updateRailState)(rootPath, pendingPlanRailId, "SELF_CORRECTING");
                                const railTaskId = planTaskToRailTask[taskId];
                                if (railTaskId) {
                                    (0, manager_2.updateTaskStatus)(railTaskId, "executing");
                                }
                            }
                            const railForCtx = pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) : null;
                            const railTaskForCtx = taskId ? (0, manager_2.getTask)(planTaskToRailTask[taskId] ?? "") : null;
                            const step = railForCtx?.logicPath?.[railTaskForCtx?.logicStep ?? 0];
                            (0, agent_1.setTraceContext)({
                                railId: pendingPlanRailId ?? undefined,
                                taskId: planTaskToRailTask[taskId] ?? undefined,
                                logicPathStep: step ? `${step.step}: ${step.layer} - ${step.filePath}` : undefined,
                                filePath: step?.filePath,
                            });
                            const railForFixCtx = pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) : null;
                            const fix = await (0, agent_1.runTaskAtIndex)(pendingPlan, curIndex, rootPath, {
                                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                                conversationTurns: lastConversationTurns,
                                errorOutput,
                                rail: railForFixCtx ?? undefined,
                                railHistory: lastConversationTurns,
                            });
                            (0, agent_1.clearTraceContext)();
                            if (fix.hasStaging) {
                                const staging = (0, agent_1.getStagingEntries)();
                                send({
                                    type: "agentStagingEntries",
                                    entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                                });
                            }
                            if (pendingPlanRailId) {
                                (0, manager_2.updateRailState)(rootPath, pendingPlanRailId, "EXECUTING");
                            }
                        }
                        else {
                            // UI verification: Step 1 optional Playwright specs, Step 2 vision critique on every UI rail (no spec required).
                            const rail = pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) : null;
                            const hasUIStep = rail?.logicPath?.some((s) => s.layer === "UI") ?? true;
                            if (pendingPlanRailId && hasUIStep) {
                                const baseUrl = process.env.APP_URL ??
                                    process.env.PLAYWRIGHT_BASE_URL ??
                                    "http://localhost:3000";
                                const cfg = vscode.workspace.getConfiguration("archVisualizer");
                                const specs = cfg.get("playwrightSpecs") ?? [];
                                let pwResult;
                                // Step 1: optional human-authored Playwright specs
                                if (specs.length > 0) {
                                    pwResult = await (0, agent_1.runPlaywrightForRail)(pendingPlanRailId, rootPath, sandboxDir ?? rootPath, specs, baseUrl);
                                    lastPlaywrightPassed = pwResult.passed;
                                    passed = passed && pwResult.passed;
                                }
                                // Step 2: vision critique on every UI rail — no spec required; agent finds problems itself
                                try {
                                    const screenshotPath = pwResult?.failures?.[0]?.screenshotPath ??
                                        (await (0, captureScreenshot_1.captureScreenshot)(baseUrl, sandboxDir ?? rootPath, pendingPlanRailId));
                                    const violations = await (0, runVisualCritique_1.runVisualCritique)(screenshotPath, rail?.outcome ?? "");
                                    const high = violations.filter((v) => v.severity === "high");
                                    if (high.length > 0) {
                                        const visionFailures = high.map((v) => ({
                                            testName: `[VISUAL] ${v.element}`,
                                            error: `[VISUAL] ${v.violation}`,
                                            screenshotPath,
                                            domSnapshot: "",
                                            consoleErrors: [],
                                            networkFailures: [],
                                        }));
                                        if (pwResult) {
                                            pwResult.failures.unshift(...visionFailures);
                                            pwResult.passed = false;
                                        }
                                        else {
                                            pwResult = {
                                                passed: false,
                                                failures: visionFailures,
                                                spec: "(vision critique)",
                                                tracePath: "",
                                            };
                                        }
                                        lastPlaywrightPassed = false;
                                        passed = false;
                                    }
                                }
                                catch {
                                    // Vision critique is best-effort; never block the main flow.
                                }
                                if (pwResult && !pwResult.passed) {
                                    (0, telemetry_1.recordPlaywrightResult)(pendingPlanRailId, false);
                                    const curIndex = session.currentTaskIndex ?? 0;
                                    const taskId = pendingPlan.tasks[curIndex]?.id;
                                    const railTaskId = taskId ? planTaskToRailTask[taskId] : null;
                                    const touchedPaths = (0, agent_1.getSessionTouchedPaths)();
                                    const verificationOutput = {
                                        tool: "run_playwright_trace",
                                        passed: false,
                                        errors: (touchedPaths.length > 0 ? touchedPaths : [pwResult.spec]).slice(0, 1).map((fp) => ({
                                            filePath: fp,
                                            message: pwResult.failures[0]?.error ?? "Playwright failed",
                                            type: "runtime",
                                        })),
                                    };
                                    const classification = (0, agent_1.classifyFailure)(verificationOutput, {
                                        touchedPaths,
                                        plan: pendingPlan,
                                        retryCounts: session.retryCounts ?? {},
                                    });
                                    if (classification.route === "code_writer") {
                                        const errorOutput = `Playwright failures:\n${JSON.stringify(pwResult.failures.slice(0, 10), null, 2)}`;
                                        if (taskId) {
                                            session.retryCounts[taskId] = (session.retryCounts[taskId] ?? 0) + 1;
                                            if (railTaskId && pendingPlanRailId) {
                                                (0, manager_2.updateTaskStatus)(railTaskId, "executing");
                                            }
                                        }
                                        (0, agent_1.saveSession)(rootPath, session);
                                        send({ type: "agentSessionUpdate", session });
                                        if (pendingPlanRailId && taskId) {
                                            (0, manager_2.updateRailState)(rootPath, pendingPlanRailId, "SELF_CORRECTING");
                                            if (railTaskId)
                                                (0, manager_2.updateTaskStatus)(railTaskId, "executing");
                                        }
                                        const railForPwFix = pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) : null;
                                        const fix = await (0, agent_1.runTaskAtIndex)(pendingPlan, curIndex, rootPath, {
                                            apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                                            conversationTurns: lastConversationTurns,
                                            errorOutput,
                                            rail: railForPwFix ?? undefined,
                                            railHistory: lastConversationTurns,
                                        });
                                        if (fix.hasStaging) {
                                            const staging = (0, agent_1.getStagingEntries)();
                                            send({
                                                type: "agentStagingEntries",
                                                entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                                            });
                                        }
                                        if (pendingPlanRailId) {
                                            (0, manager_2.updateRailState)(rootPath, pendingPlanRailId, "EXECUTING");
                                        }
                                        (0, agent_1.clearTraceContext)();
                                        persistAndNotifyTasks(rootPath);
                                        return;
                                    }
                                    if (railTaskId) {
                                        (0, manager_2.updateTaskStatus)(railTaskId, "awaiting_hitl");
                                        const evidence = JSON.stringify({ failures: pwResult.failures, tracePath: pwResult.tracePath, spec: pwResult.spec }, null, 2);
                                        (0, manager_2.updateTaskEvidence)(railTaskId, evidence);
                                    }
                                    (0, manager_2.updateRailState)(rootPath, pendingPlanRailId, "AWAITING_HITL");
                                    persistAndNotifyTasks(rootPath);
                                    send({
                                        type: "playwrightHitl",
                                        railId: pendingPlanRailId,
                                        failures: pwResult.failures.map((f) => ({
                                            testName: f.testName,
                                            error: f.error,
                                            screenshotPath: f.screenshotPath,
                                        })),
                                        tracePath: pwResult.tracePath,
                                        spec: pwResult.spec,
                                    });
                                    return;
                                }
                            }
                            session.currentTaskIndex += 1;
                            (0, agent_1.saveSession)(rootPath, session);
                            send({ type: "agentSessionUpdate", session });
                            const completedIndex = (session.currentTaskIndex ?? 0) - 1;
                            const completedPlanTask = pendingPlan.tasks[completedIndex];
                            if (completedPlanTask && pendingPlanRailId) {
                                const railTaskId = planTaskToRailTask[completedPlanTask.id];
                                if (railTaskId) {
                                    (0, manager_2.updateTaskStatus)(railTaskId, "completed");
                                }
                            }
                            const nextPlanTask = pendingPlan.tasks[session.currentTaskIndex];
                            if (nextPlanTask && pendingPlanRailId) {
                                const nextRailTaskId = planTaskToRailTask[nextPlanTask.id];
                                if (nextRailTaskId) {
                                    (0, manager_2.updateTaskStatus)(nextRailTaskId, "executing");
                                }
                            }
                            else if (!nextPlanTask && pendingPlanRailId) {
                                // All plan tasks done, reviewer passed → VERIFYING → MATERIALIZING → ARCHIVED.
                                (0, manager_2.updateRailState)(rootPath, pendingPlanRailId, "VERIFYING");
                                const archived = (0, orchestrator_1.completeMaterializeAndArchive)(rootPath, pendingPlanRailId);
                                if (archived) {
                                    persistAndNotifyTasks(rootPath);
                                }
                            }
                            const nextIndex = session.currentTaskIndex;
                            const nextPlanTaskId = pendingPlan.tasks[nextIndex]?.id;
                            const nextRailTaskId = nextPlanTaskId ? planTaskToRailTask[nextPlanTaskId] : null;
                            const railForNext = pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) : null;
                            const railTaskForNext = nextRailTaskId ? (0, manager_2.getTask)(nextRailTaskId) : null;
                            const stepNext = railForNext?.logicPath?.[railTaskForNext?.logicStep ?? 0];
                            (0, agent_1.setTraceContext)({
                                railId: pendingPlanRailId ?? undefined,
                                taskId: nextRailTaskId ?? undefined,
                                logicPathStep: stepNext ? `${stepNext.step}: ${stepNext.layer} - ${stepNext.filePath}` : undefined,
                                filePath: stepNext?.filePath,
                            });
                            const next = await (0, agent_1.runTaskAtIndex)(pendingPlan, session.currentTaskIndex, rootPath, {
                                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                                conversationTurns: lastConversationTurns,
                                rail: railForNext ?? undefined,
                                railHistory: lastConversationTurns,
                            });
                            (0, agent_1.clearTraceContext)();
                            if (next.hasStaging) {
                                const staging = (0, agent_1.getStagingEntries)();
                                send({
                                    type: "agentStagingEntries",
                                    entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                                });
                            }
                        }
                    });
                }
            }
        }
        if (msg.type === "agentDiffReject") {
            (0, agent_1.rejectStaging)(msg.paths);
            send({ type: "agentStagingEntries", entries: [] });
            if (pendingPlanRailId) {
                (0, telemetry_1.recordCritiqueLoop)(pendingPlanRailId);
                const rail = (0, manager_2.getRail)(rootPath, pendingPlanRailId);
                if (rail && graph) {
                    const touchedPaths = (0, agent_1.getSessionTouchedPaths)();
                    const touchedNodeIds = touchedPaths
                        .flatMap((p) => graph.nodes.filter((n) => n.path === p || n.files?.some((f) => f === p)).map((n) => n.id))
                        .filter((id, i, arr) => arr.indexOf(id) === i);
                    const hi = (0, archetypes_1.computeHallucinationIndex)(rail.logicPath, touchedNodeIds);
                    (0, manager_2.updateRailPartial)(rootPath, pendingPlanRailId, { hallucinationIndex: hi });
                    const intendedIds = new Set(rail.logicPath.map((s) => s.nodeId));
                    const divergedNodeIds = touchedNodeIds.filter((id) => !intendedIds.has(id));
                    if (hi > 0.5) {
                        (0, agent_1.initTraceLogger)();
                        (0, agent_1.emitTrace)({
                            role: "reviewer",
                            type: "critic_feedback",
                            message: `Drift detected: hallucination index ${(hi * 100).toFixed(0)}% (intended vs touched nodes)`,
                            railId: pendingPlanRailId,
                            metadata: divergedNodeIds.length > 0 ? { divergedNodeIds } : undefined,
                        });
                    }
                }
                const result = (0, orchestrator_1.transitionRail)(rootPath, pendingPlanRailId, "SUSPENDED");
                if (result.ok)
                    persistAndNotifyTasks(rootPath);
            }
        }
        if (msg.type === "agentSessionRestore") {
            const recovered = (0, agent_1.loadSession)(rootPath);
            if (recovered) {
                pendingPlan = recovered.planState;
                const staging = (0, agent_1.getStagingEntries)();
                if (staging.length > 0) {
                    send({
                        type: "agentStagingEntries",
                        entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                    });
                }
            }
        }
        if (msg.type === "agentSessionDiscard") {
            (0, agent_1.deleteSession)(rootPath);
        }
        if (msg.type === "agentJiraResolveAction") {
            // Resolve = transition to Done; Keep/Dismiss = no-op (just close modal)
            if (msg.action === "resolve") {
                const config = (0, client_1.getJiraConfig)();
                if (config) {
                    (0, agent_1.updateJira)(config, msg.key, "archive").catch((err) => {
                        vscode.window.showErrorMessage(`Jira resolve failed: ${err instanceof Error ? err.message : err}`);
                    });
                }
            }
        }
        if (msg.type === "agentPartialPlanFailureAction") {
            // Abort = clear session; Revert = show message; Create Jira = would create issue
            if (msg.action === "abort") {
                (0, agent_1.deleteSession)(rootPath);
            }
            if (msg.action === "create_jira") {
                vscode.window.showInformationMessage("Create Jira for partial completion — not yet implemented.");
            }
        }
        if (msg.type === "agentCostGateAction") {
            const session = (0, agent_1.loadSession)(rootPath);
            if (msg.action === "abort") {
                (0, agent_1.deleteSession)(rootPath);
                persistAndNotifyTasks(rootPath);
            }
            if (msg.action === "extend" && session) {
                const amount = msg.amount ?? 20_000;
                const EXTEND_CEILING = 500_000;
                const baseTokenBudget = vscode.workspace.getConfiguration("archVisualizer").get("tokenBudgetSession") ?? 100_000;
                const baseLlmLimit = vscode.workspace.getConfiguration("archVisualizer").get("retryLimitSession") ?? 50;
                session.extendedTokenBudget = Math.min((session.extendedTokenBudget ?? 0) + amount, EXTEND_CEILING - baseTokenBudget);
                session.extendedLlmLimit = (session.extendedLlmLimit ?? 0) + 20;
                (0, agent_1.saveSession)(rootPath, session);
                send({ type: "agentSessionUpdate", session });
                persistAndNotifyTasks(rootPath);
                if (pendingPlanRailId) {
                    const rail = (0, manager_2.getRail)(rootPath, pendingPlanRailId);
                    if (rail?.state === "FAILED") {
                        (0, manager_2.updateRailState)(rootPath, pendingPlanRailId, "SUSPENDED");
                        persistAndNotifyTasks(rootPath);
                    }
                }
            }
            if (msg.action === "create_jira") {
                const config = (0, client_1.getJiraConfig)();
                if (config) {
                    const baseUrl = config.baseUrl.replace(/\/$/, "");
                    const url = `${baseUrl}/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent("[HITL] Token/LLM limit exceeded")}`;
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }
        }
        if (msg.type === "failRailHitlAction") {
            const { railId, action } = msg;
            if (action === "abandon") {
                (0, manager_2.failRail)(rootPath, railId, "User abandoned rail after HITL escalation");
                persistAndNotifyTasks(rootPath);
            }
            if (action === "create_jira") {
                const config = (0, client_1.getJiraConfig)();
                const rail = (0, manager_2.getRail)(rootPath, railId);
                if (!config || !rail) {
                    vscode.window.showErrorMessage(!config
                        ? "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN and reload."
                        : `Rail not found for Jira escalation: ${railId}`);
                }
                else {
                    const baseUrl = config.baseUrl.replace(/\/$/, "");
                    const summary = `[RAIL FAILED] ${rail.outcome ?? railId}`;
                    const url = `${baseUrl}/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(summary)}`;
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }
        }
        if (msg.type === "playwrightHitlAction") {
            const { railId, action } = msg;
            if (action === "suspend") {
                (0, orchestrator_1.transitionRail)(rootPath, railId, "SUSPENDED");
                persistAndNotifyTasks(rootPath);
            }
            if (action === "retry" && pendingPlan && pendingPlanRailId === railId) {
                const session = (0, agent_1.loadSession)(rootPath);
                if (session) {
                    const curIndex = session.currentTaskIndex ?? 0;
                    const taskId = pendingPlan.tasks[curIndex]?.id;
                    const railTaskId = taskId ? planTaskToRailTask[taskId] : null;
                    if (railTaskId)
                        (0, manager_2.updateTaskStatus)(railTaskId, "executing");
                    (0, manager_2.updateRailState)(rootPath, railId, "SELF_CORRECTING");
                    const railForRetryCtx = (0, manager_2.getRail)(rootPath, railId);
                    const railTaskForRetry = railTaskId ? (0, manager_2.getTask)(railTaskId) : null;
                    const stepRetry = railForRetryCtx?.logicPath?.[railTaskForRetry?.logicStep ?? 0];
                    (0, agent_1.setTraceContext)({
                        railId,
                        taskId: railTaskId ?? undefined,
                        logicPathStep: stepRetry ? `${stepRetry.step}: ${stepRetry.layer} - ${stepRetry.filePath}` : undefined,
                        filePath: stepRetry?.filePath,
                    });
                    const fix = await (0, agent_1.runTaskAtIndex)(pendingPlan, curIndex, rootPath, {
                        apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                        conversationTurns: lastConversationTurns,
                        errorOutput: "User chose Retry — re-running task.",
                        rail: railForRetryCtx ?? undefined,
                        railHistory: lastConversationTurns,
                    });
                    if (fix.hasStaging) {
                        const staging = (0, agent_1.getStagingEntries)();
                        send({ type: "agentStagingEntries", entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })) });
                    }
                    (0, agent_1.clearTraceContext)();
                    (0, manager_2.updateRailState)(rootPath, railId, "EXECUTING");
                    persistAndNotifyTasks(rootPath);
                }
            }
            if (action === "create_jira") {
                const config = (0, client_1.getJiraConfig)();
                if (config) {
                    const baseUrl = config.baseUrl.replace(/\/$/, "");
                    const url = `${baseUrl}/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent("Playwright UI test failure")}`;
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }
            if (action === "investigate" && msg.tracePath && fs.existsSync(msg.tracePath)) {
                const { spawn } = await import("child_process");
                spawn("npx", ["playwright", "show-trace", msg.tracePath], {
                    stdio: "ignore",
                    detached: true,
                    shell: true,
                });
            }
            else if (action === "investigate") {
                vscode.window.showWarningMessage("Trace file not found — cannot open Playwright trace viewer.");
            }
        }
        if (msg.type === "taskAction") {
            const { taskId, action } = msg;
            const task = (0, manager_2.getTask)(taskId);
            if (!task)
                return;
            if (action === "approve" && task.status === "awaiting_hitl") {
                (0, manager_2.updateTaskStatus)(taskId, "completed");
                const rail = (0, manager_2.getRail)(rootPath, task.railId);
                const railTasks = (0, manager_2.getTasksByRail)(task.railId);
                const nextPending = railTasks.find((t) => t.status === "pending");
                const stillAwaitingHitl = railTasks.find((t) => t.status === "awaiting_hitl" && t.id !== taskId);
                if (nextPending) {
                    (0, manager_2.updateTaskStatus)(nextPending.id, "executing");
                    (0, orchestrator_1.transitionRail)(rootPath, task.railId, "EXECUTING");
                }
                else if (task.kind === "verification") {
                    // Section 13: T6 verification approved → VERIFYING → MATERIALIZING → ARCHIVED
                    const toVerifying = (0, orchestrator_1.transitionRail)(rootPath, task.railId, "VERIFYING");
                    if (toVerifying.ok && toVerifying.rail) {
                        const archived = (0, orchestrator_1.completeMaterializeAndArchive)(rootPath, task.railId);
                        if (archived) {
                            (0, agent_1.emitTrace)({
                                role: "manager",
                                type: "info",
                                message: "Rail archived after verification approval",
                                railId: task.railId,
                            });
                        }
                    }
                }
                else if (stillAwaitingHitl) {
                    // Another HITL task still pending (e.g. T3 approved, T6 still awaiting)
                    (0, manager_2.updateRailState)(rootPath, task.railId, "AWAITING_HITL");
                }
                else {
                    (0, orchestrator_1.transitionRail)(rootPath, task.railId, "VERIFYING");
                }
                persistAndNotifyTasks(rootPath);
            }
            if (action === "reject" && task.status === "awaiting_hitl") {
                (0, manager_2.updateTaskStatus)(taskId, "rejected");
                persistAndNotifyTasks(rootPath);
            }
            if (action === "take_ownership" && task.status === "awaiting_hitl") {
                (0, manager_2.updateTaskEvidence)(taskId, "human_take_over");
                (0, manager_2.updateTaskStatus)(taskId, "completed");
                (0, agent_1.emitTrace)({
                    role: "manager",
                    type: "info",
                    message: `User took ownership of task ${taskId}`,
                    railId: task.railId,
                    taskId,
                });
                persistAndNotifyTasks(rootPath);
            }
        }
        if (msg.type === "railAction") {
            const { railId, action } = msg;
            if (action === "suspend") {
                (0, orchestrator_1.transitionRail)(rootPath, railId, "SUSPENDED");
                persistAndNotifyTasks(rootPath);
            }
            if (action === "resume") {
                const rail = (0, manager_2.getRail)(rootPath, railId);
                if (rail?.state === "SUSPENDED") {
                    (0, orchestrator_1.transitionRail)(rootPath, railId, "EXECUTING");
                    persistAndNotifyTasks(rootPath);
                }
            }
            if (action === "abandon") {
                (0, manager_2.failRail)(rootPath, railId, "User abandoned rail");
                persistAndNotifyTasks(rootPath);
            }
            if (action === "acknowledge_drift") {
                (0, manager_2.updateRailPartial)(rootPath, railId, { hallucinationAcknowledgedAt: Date.now() });
                persistAndNotifyTasks(rootPath);
            }
            if (action === "materialize") {
                const archived = (0, orchestrator_1.completeMaterializeAndArchive)(rootPath, railId);
                if (archived) {
                    (0, agent_1.emitTrace)({ role: "manager", type: "info", message: "Rail archived after materialize", railId });
                }
                persistAndNotifyTasks(rootPath);
            }
        }
        if (msg.type === "openPlaywrightScreenshot") {
            const absPath = path.isAbsolute(msg.path) ? msg.path : path.join(rootPath, msg.path);
            if (fs.existsSync(absPath)) {
                vscode.env.openExternal(vscode.Uri.file(absPath));
            }
            else {
                vscode.window.showWarningMessage(`Screenshot not found: ${absPath}`);
            }
        }
        if (msg.type === "agentJiraAddLabel") {
            const config = (0, client_1.getJiraConfig)();
            if (config) {
                (0, client_1.addLabel)(config, msg.key, msg.label).then((r) => {
                    send({ type: "agentJiraAddLabelResult", key: msg.key, label: msg.label, success: r.success, error: r.error });
                    if (!r.success) {
                        vscode.window.showErrorMessage(`Jira add label failed: ${r.error}`);
                    }
                });
            }
            else {
                send({ type: "agentJiraAddLabelResult", key: msg.key, label: msg.label, success: false, error: "Jira not configured" });
            }
        }
        if (msg.type === "agentJiraSyncAction") {
            const config = (0, client_1.getJiraConfig)();
            if (config) {
                const context = msg.action === "retag" && msg.newFingerprint && msg.newModule
                    ? { newFingerprint: msg.newFingerprint, newModule: msg.newModule }
                    : undefined;
                (0, agent_1.updateJira)(config, msg.key, msg.action, context).catch((err) => {
                    const m = err instanceof Error ? err.message : String(err);
                    vscode.window.showErrorMessage(`Jira update failed: ${m}`);
                });
            }
        }
        if (msg.type === "createViolationJira") {
            const config = (0, client_1.getJiraConfig)();
            if (!config) {
                vscode.window.showErrorMessage("Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN and reload.");
                return;
            }
            const v = msg.violation;
            const summary = `[${String(v.type ?? "VIOLATION").toUpperCase()}] ${String(v.description ?? "Architecture violation")}`;
            const baseUrl = config.baseUrl.replace(/\/$/, "");
            const url = `${baseUrl}/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(summary)}`;
            // Create or update a canonical rail representing "violations → create ticket".
            try {
                const violationId = String(v.id ?? v.sourceNodeId ?? summary);
                const outcome = `Create Jira ticket for violation ${violationId}`;
                const rail = (0, entrypoints_1.triggerFromViolation)({
                    rootPath,
                    violationId,
                    outcome,
                    sessionId: "violations-create-ticket",
                });
                const now = Date.now();
                const violationTask = {
                    id: `${rail.id}-violation`,
                    railId: rail.id,
                    kind: "governance_violation",
                    description: summary,
                    files: [],
                    autoCapable: false,
                    status: "completed",
                    agent: "reviewer",
                    logicStep: 1,
                    createdAt: now,
                    resolvedAt: now,
                };
                (0, manager_2.createTask)(violationTask);
                const syncTask = {
                    id: `${rail.id}-create-ticket`,
                    railId: rail.id,
                    kind: "governance_sync",
                    description: "Ensure violation is tracked in Jira (Create ticket flow).",
                    files: [],
                    autoCapable: false,
                    status: "awaiting_hitl",
                    agent: "reviewer",
                    logicStep: 2,
                    hitlPrompt: "Confirm that a Jira ticket was created for this violation and linked appropriately.",
                    createdAt: now,
                };
                (0, manager_2.createTask)(syncTask);
                persistAndNotifyTasks(rootPath);
            }
            catch {
                // If rail wiring fails, still open Jira as before.
            }
            vscode.env.openExternal(vscode.Uri.parse(url));
        }
        if (msg.type === "agentRuleProposalAction") {
            // Stub: would apply rule change on accept, replan on reject
            if (msg.action === "accept" && msg.editedRule) {
                // TODO: merge edited rule into .arch-rules.json
            }
        }
        if (msg.type === "agentExportTrace") {
            const json = JSON.stringify(msg.entries ?? [], null, 2);
            send({ type: "agentTraceExport", json });
        }
        if (msg.type === "runValidation") {
            try {
                send({ type: "loading", message: "Running validation..." });
                const projectRoot = path.resolve(__dirname, "../..");
                const args = ["tsx", "scripts/validate-local.ts", rootPath];
                if (msg.createJira)
                    args.push("--jira");
                const proc = (0, child_process_1.spawnSync)("npx", args, {
                    cwd: projectRoot,
                    encoding: "utf-8",
                    maxBuffer: 10 * 1024 * 1024,
                    env: { ...process.env },
                });
                const data = JSON.parse(proc.stdout?.trim() || "{}");
                send({ type: "validationResult", data });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                send({
                    type: "validationResult",
                    data: {
                        archPassed: false,
                        archViolations: [],
                        testsRun: false,
                        testsPassed: null,
                        testFailures: [{ file: "Error", name: message }],
                        jiraCreated: [],
                        jiraBaseUrl: null,
                    },
                });
            }
        }
    });
    panel.onDidDispose(() => {
        panel = undefined;
        watcher?.stop();
        watcher = undefined;
    });
    watcher = new watcher_1.ProjectWatcher();
    watcher.on("change", async () => {
        cachedFindings = null;
        if (panel) {
            send({ type: "loading", message: "Rescanning..." });
            await buildAndSendGraph(rootPath);
        }
    });
    watcher.start(rootPath);
}
async function buildAndSendGraph(rootPath) {
    try {
        send({ type: "loading", message: "Scanning files..." });
        if (!cachedFindings) {
            cachedFindings = [
                ...(0, contractScanner_1.scanContracts)(rootPath),
                ...(0, referenceScanner_1.scanDocumentReferences)(rootPath),
                ...(0, envScanner_1.scanEnvironmentGaps)(rootPath),
            ];
        }
        const findings = cachedFindings;
        let g = await (0, scanner_1.scanProject)(rootPath, findings);
        send({ type: "loading", message: "Checking for drift..." });
        g = (0, driftDetector_1.detectDrift)(g);
        send({ type: "loading", message: getAgentActive() ? "Enriching graph..." : "Enriching graph (heuristic only, agent paused)..." });
        g = await (0, enricher_v2_1.enrichGraph)(g, getAgentActive() ? getOpenAiApiKey() : undefined);
        g = (0, graphAnalyser_1.analyseGraph)(g);
        graph = g;
        send({ type: "graph", data: g });
        const violations = deriveViolationsFromGraph(g);
        if (violations.length > 0) {
            send({ type: "violations", violations });
        }
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
    }
}
function send(msg) {
    panel?.webview.postMessage(msg);
}
async function checkJiraResolveAfterCommit(rootPath, committedPaths, g) {
    const config = (0, client_1.getJiraConfig)();
    if (!config || !g)
        return;
    try {
        const project = process.env.JIRA_PROJECT?.trim();
        const jql = process.env.JIRA_JQL?.trim()
            || (project
                ? `project = ${project} AND resolution = Unresolved ORDER BY updated DESC`
                : "resolution = Unresolved ORDER BY updated DESC");
        const issues = await (0, client_1.searchIssues)(config, jql, 50, { includeDescription: true });
        const baseUrl = config.baseUrl.replace(/\/$/, "");
        const modules = new Set();
        for (const p of committedPaths) {
            const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
            if (parts.length >= 2)
                modules.add(parts.slice(0, 2).join("/"));
            else if (parts.length === 1)
                modules.add(parts[0]);
        }
        const toResolve = [];
        for (const i of issues) {
            const { module: mod } = (0, agent_1.extractFingerprintFromDescription)(i.description);
            if (mod && modules.has(mod)) {
                toResolve.push({ key: i.key, summary: i.summary, module: mod, baseUrl });
            }
        }
        if (toResolve.length > 0) {
            send({ type: "agentJiraResolvePrompt", issues: toResolve });
        }
    }
    catch {
        /* ignore */
    }
}
function runGateCheck(rootPath) {
    const config = vscode.workspace.getConfiguration("archVisualizer");
    const staging = (0, agent_1.getStagingEntries)();
    const hasStagingWrites = staging.length > 0;
    const session = (0, agent_1.loadSession)(rootPath);
    const touchedPaths = (0, agent_1.getSessionTouchedPaths)();
    let scopeViolation = false;
    let scopeViolationPath;
    if (hasStagingWrites && pendingPlan) {
        const allowedBases = pendingPlan.tasks.map((t) => t.module.replace(/\\/g, "/").replace(/\/$/, ""));
        for (const e of staging) {
            const norm = e.path.replace(/\\/g, "/");
            const inScope = allowedBases.some((base) => norm === base || norm.startsWith(base + "/"));
            if (!inScope) {
                scopeViolation = true;
                scopeViolationPath = e.path;
                break;
            }
        }
    }
    const retryCounts = session?.retryCounts ?? {};
    const retryCountTotal = Object.values(retryCounts).reduce((sum, v) => sum + (typeof v === "number" ? v : 0), 0);
    let railTokenUsage = 0;
    let railLlmCalls = 0;
    if (pendingPlanRailId) {
        const t = (0, telemetry_1.getRailTelemetry)(pendingPlanRailId);
        railTokenUsage = t.tokenUsage;
        railLlmCalls = t.llmCallCount;
    }
    const retryLimitCode = config.get("retryLimitCode") ?? 3;
    const retryLimitArch = config.get("retryLimitArch") ?? 2;
    const baseLlmLimit = config.get("retryLimitSession") ?? 50;
    const baseTokenBudget = config.get("tokenBudgetSession") ?? 100_000;
    const llmLimit = baseLlmLimit + (session?.extendedLlmLimit ?? 0);
    const tokenBudget = baseTokenBudget + (session?.extendedTokenBudget ?? 0);
    const ctx = {
        hasPlan: !!pendingPlan,
        planApproved: !!pendingPlan,
        hasStagingWrites,
        scopeViolation,
        scopeViolationPath,
        lintPassed: true,
        vitestPassed: true,
        playwrightPassed: lastPlaywrightPassed,
        retryCountCode: retryCountTotal,
        retryCountArch: 0,
        retryLimitCode,
        retryLimitArch,
        retryLimitSession: llmLimit,
        llmCallCount: railLlmCalls || (session?.llmCallCount ?? 0),
        tokenUsage: railTokenUsage || (session?.tokenUsage ?? 0),
        tokenBudget,
        costCapSession: config.get("costCapSession") ?? 0,
        touchedPaths,
        hasStaleJiraMismatch: lastStaleJiraMismatches.length > 0,
        hasPartialPlanFailure: false,
        hasRuleProposal: false,
        hasJiraResolvePrompt: false,
    };
    const gate = (0, agent_1.checkGates)(ctx);
    if (gate) {
        const reason = scopeViolation && scopeViolationPath
            ? `Scope violation: ${scopeViolationPath} not in plan`
            : `Gate: ${gate.gate}`;
        (0, agent_1.emitTrace)({
            role: "manager",
            type: "error",
            message: reason,
            railId: pendingPlanRailId ?? undefined,
            metadata: gate.metadata ?? {},
        });
        if (gate.gate === "token_budget_exceeded" || gate.gate === "session_llm_limit") {
            send({
                type: "agentCostGate",
                gate: gate.gate,
                tokenUsage: ctx.tokenUsage,
                tokenBudget: ctx.tokenBudget,
                llmCallCount: ctx.llmCallCount,
                llmLimit: ctx.retryLimitSession,
            });
        }
        if (pendingPlanRailId && (gate.gate === "session_llm_limit" || gate.gate === "test_failure" || gate.gate === "token_budget_exceeded")) {
            (0, manager_2.failRail)(rootPath, pendingPlanRailId, reason);
            persistAndNotifyTasks(rootPath);
        }
    }
    return gate;
}
const GATE_NEXT_STEPS = {
    plan_review: "Open Architecture Map and approve or reject the plan.",
    diff_preview: "Review staged changes in Architecture Map and approve or reject.",
    scope_violation: "Reject the out-of-scope file or adjust the plan.",
    test_failure: "Fix failing tests or abort the session.",
    token_budget_exceeded: "Extend token budget or abort the session.",
    cost_cap_exceeded: "Extend cost cap or abort the session.",
    session_llm_limit: "Extend LLM call limit or abort the session.",
    partial_plan_failure: "Create Jira issue or abort the session.",
    rule_proposal: "Accept or reject the proposed rule change.",
    jira_resolve_prompt: "Resolve or dismiss Jira issues in Architecture Map.",
    stale_jira_mismatch: "Sync Jira issues in Architecture Map.",
    runtime_failure_untouched: "Fix the failing test or abort the session.",
};
async function runCheckGatesCommand() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders?.[0]) {
        vscode.window.showInformationMessage("Check Gates: Open a workspace folder first.");
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration("archVisualizer");
    const projectRoot = config.get("projectRoot") ?? ".";
    const fixturePath = process.env.ARCH_FIXTURE_PATH;
    const rootPath = fixturePath
        ? path.resolve(workspaceRoot, fixturePath)
        : path.join(workspaceRoot, projectRoot);
    const gate = runGateCheck(rootPath);
    if (gate) {
        const nextStep = GATE_NEXT_STEPS[gate.gate] ?? "Open Architecture Map to proceed.";
        vscode.window.showInformationMessage(`Gate: ${gate.gate}. Next step: ${nextStep}`, "Open Architecture Map").then((choice) => {
            if (choice === "Open Architecture Map") {
                vscode.commands.executeCommand("arch-visualizer.open");
            }
        });
    }
    else {
        vscode.window.showInformationMessage("Check Gates: No gate fired. Agent can proceed.");
    }
}
let pendingPlan = null;
let pendingPlanRailId = null;
function convertDesignToPlan(proposal) {
    const tasks = proposal.nodes.map((node, i) => ({
        id: `T${i + 1}`,
        module: node.id,
        layer: node.layer,
        action: "create",
        expectedOutput: node.description || proposal.summary || `Implement ${node.label}`,
        proposedFiles: (node.files ?? []).map((f) => ({
            name: f.name,
            purpose: f.purpose,
            todos: f.todos ?? [],
        })),
    }));
    const dependencies = [];
    proposal.nodes.forEach((node, i) => {
        const connects = node.connectsTo ?? [];
        for (const targetId of connects) {
            const j = proposal.nodes.findIndex((n) => n.id === targetId);
            if (j !== -1 && j !== i) {
                dependencies.push([`T${j + 1}`, `T${i + 1}`]);
            }
        }
    });
    return {
        goal: proposal.summary || "Architecture design",
        tasks,
        dependencies,
    };
}
/** Phase 1: mock plan from goal. Uses graph modules when available. */
function createMockPlan(goal) {
    const modules = graph?.nodes.slice(0, 3).map((n) => n.path) ?? ["src/auth", "src/services"];
    const m1 = modules[0] ?? "src/auth";
    const m2 = modules[1] ?? "src/services";
    const plan = {
        goal,
        tasks: [
            { id: "T1", module: m1, layer: "Business Logic", action: "create", expectedOutput: `${goal} — step 1` },
            { id: "T2", module: m2, layer: "Business Logic", action: "modify", expectedOutput: `${goal} — step 2` },
        ],
        dependencies: [["T1", "T2"]],
    };
    return JSON.stringify(plan);
}
/** Section 10.3: Infer archetype from goal and available templates. */
function inferArchetypeForGoal(rootPath, goal) {
    const available = (0, manager_2.listTemplateArchetypes)(rootPath);
    if (available.length === 0)
        return undefined;
    const g = goal.toLowerCase();
    if (g.includes("ui") || g.includes("view") || g.includes("button") || g.includes("jira")) {
        return available.includes("ui-api-external") ? "ui-api-external" : available[0];
    }
    if (g.includes("auth") || g.includes("api") || g.includes("service")) {
        return available.includes("ui-api-external") ? "ui-api-external" : available[0];
    }
    return available[0];
}
/** Section 4.2: Build AgentPlan JSON from inferred logicPath (no template). */
function buildPlanFromLogicPath(goal, logicPath) {
    const tasks = logicPath.map((s, i) => ({
        id: `T${i + 1}`,
        module: s.filePath || `src/step-${i + 1}`,
        layer: s.layer || "Business Logic",
        action: i === 0 ? "create" : "modify",
        expectedOutput: `${goal} — step ${s.step}`,
    }));
    const dependencies = [];
    for (let i = 0; i < tasks.length - 1; i++) {
        dependencies.push([tasks[i].id, tasks[i + 1].id]);
    }
    return JSON.stringify({ goal, tasks, dependencies });
}
/** Section 10.3: Build AgentPlan JSON from template (logicPath + tasks). */
function buildPlanFromTemplate(goal, tmpl) {
    const modules = graph?.nodes.slice(0, 6).map((n) => n.path) ?? [];
    const tasks = tmpl.tasks.map((t, i) => {
        const module = tmpl.logicPath[i]?.filePath ?? modules[i] ?? `src/step-${i + 1}`;
        return {
            id: `T${i + 1}`,
            module,
            layer: "Business Logic",
            action: i === 0 ? "create" : "modify",
            expectedOutput: t.description || `${goal} — step ${i + 1}`,
        };
    });
    const dependencies = [];
    for (let i = 0; i < tasks.length - 1; i++) {
        dependencies.push([tasks[i].id, tasks[i + 1].id]);
    }
    const plan = { goal, tasks, dependencies };
    return JSON.stringify(plan);
}
function handleRequestPlan(rootPath, goal) {
    if (!getAgentActive()) {
        send({ type: "agentPlanValidationError", error: "[Agent paused] Enable the agent toggle to generate plans." });
        return;
    }
    const archetype = inferArchetypeForGoal(rootPath, goal);
    const plannerContext = (0, plannerContext_1.loadPlannerContext)(rootPath, archetype);
    let raw;
    let templateUsed = false;
    if (archetype) {
        const tmpl = (0, manager_2.loadTemplateForArchetype)(rootPath, archetype);
        if (tmpl && tmpl.tasks.length > 0) {
            raw = buildPlanFromTemplate(goal, tmpl);
            templateUsed = true;
        }
        else if (graph && (archetype === "ui-api-external" || archetype === "ui-api-persistence" || archetype === "governance-violation")) {
            const logicPath = (0, archetypes_1.inferLogicPath)(goal, graph, archetype);
            if (logicPath.length > 0) {
                raw = buildPlanFromLogicPath(goal, logicPath);
                templateUsed = true;
            }
            else {
                raw = createMockPlan(goal);
            }
        }
        else {
            raw = createMockPlan(goal);
        }
    }
    else {
        raw = createMockPlan(goal);
    }
    const result = (0, agent_1.validatePlan)(raw, rootPath);
    if (result.valid && result.plan) {
        pendingPlan = result.plan;
        const warnings = archetype ? (0, manager_2.getAntiPatternWarnings)(rootPath, archetype) : [];
        try {
            const rail = (0, entrypoints_1.triggerFromChat)({
                rootPath,
                userMessage: goal,
                sessionId: "agent-plan",
                archetype,
            });
            pendingPlanRailId = rail.id;
            if (templateUsed && archetype) {
                const tmpl = (0, manager_2.loadTemplateForArchetype)(rootPath, archetype);
                if (tmpl?.logicPath?.length) {
                    (0, manager_2.updateRailPartial)(rootPath, rail.id, { logicPath: tmpl.logicPath });
                }
                else if (graph && (archetype === "ui-api-external" || archetype === "ui-api-persistence" || archetype === "governance-violation")) {
                    const lp = (0, archetypes_1.inferLogicPath)(goal, graph, archetype);
                    if (lp.length > 0)
                        (0, manager_2.updateRailPartial)(rootPath, rail.id, { logicPath: lp });
                }
            }
            const intentSummary = `${result.plan.goal} — ${rail.outcome}`;
            (0, manager_2.updateRailPartial)(rootPath, rail.id, { intentSummary });
            (0, manager_2.updateRailState)(rootPath, rail.id, "AWAITING_APPROVAL");
            for (let i = 0; i < result.plan.tasks.length; i++) {
                const t = result.plan.tasks[i];
                const task = {
                    id: `rail-task-${t.id}`,
                    railId: rail.id,
                    kind: "code_change",
                    description: t.expectedOutput,
                    files: [],
                    autoCapable: true,
                    status: "pending",
                    agent: "executor",
                    logicStep: i + 1,
                    createdAt: Date.now(),
                };
                (0, manager_2.createTask)(task);
                planTaskToRailTask[t.id] = task.id;
            }
        }
        catch {
            pendingPlanRailId = null;
        }
        send({
            type: "agentPlan",
            plan: {
                goal: result.plan.goal,
                tasks: result.plan.tasks.map((t) => ({
                    id: t.id,
                    module: t.module,
                    layer: t.layer,
                    action: t.action,
                    expectedOutput: t.expectedOutput,
                })),
                dependencies: result.plan.dependencies,
                ...(warnings.length > 0 ? { warnings } : {}),
            },
        });
    }
    else {
        send({ type: "agentPlanValidationError", error: result.error ?? "Validation failed" });
    }
}
async function handleAgentPlanAction(action, _editFeedback, rootPath) {
    if (action === "approve") {
        (0, agent_1.initTraceLogger)();
        (0, agent_1.clearSessionTouchedPaths)();
        (0, agent_1.emitTrace)({
            role: "manager",
            type: "info",
            message: "Plan approved → running first task",
            railId: pendingPlanRailId ?? undefined,
        });
        if (pendingPlan) {
            const session = (0, agent_1.createEmptySession)(pendingPlan);
            session.activeGate = null;
            (0, agent_1.saveSession)(rootPath, session);
            if (pendingPlanRailId && pendingPlan.tasks[0]) {
                const firstTaskId = planTaskToRailTask[pendingPlan.tasks[0].id];
                if (firstTaskId) {
                    (0, manager_2.updateTaskStatus)(firstTaskId, "executing");
                }
                void (0, orchestrator_1.transitionRail)(rootPath, pendingPlanRailId, "EXECUTING", {
                    planApproved: true,
                });
            }
            const railForFirst = pendingPlanRailId ? (0, manager_2.getRail)(rootPath, pendingPlanRailId) : null;
            const result = await (0, agent_1.runFirstTask)(pendingPlan, rootPath, {
                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                conversationTurns: lastConversationTurns,
                rail: railForFirst ?? undefined,
                railHistory: lastConversationTurns,
            });
            if (result.hasStaging) {
                const staging = (0, agent_1.getStagingEntries)();
                send({
                    type: "agentStagingEntries",
                    entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                });
            }
        }
    }
    if (action === "reject") {
        if (pendingPlanRailId) {
            (0, telemetry_1.recordCritiqueLoop)(pendingPlanRailId);
            const result = (0, orchestrator_1.transitionRail)(rootPath, pendingPlanRailId, "SUSPENDED");
            if (result.ok)
                persistAndNotifyTasks(rootPath);
        }
    }
}
function getWebviewHtml(webview, extensionUri) {
    const dist = vscode.Uri.joinPath(extensionUri, "webview-ui", "dist");
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, "index.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, "index.css"));
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <link rel="stylesheet" href="${styleUri}" />
  <style>body,#root{width:100vw;height:100vh;margin:0;padding:0;background:#0d1117}</style>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}
function deactivate() {
    watcher?.stop();
}
