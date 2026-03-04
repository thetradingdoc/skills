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
const agent_1 = require("./agent");
let panel;
let watcher;
let graph;
/** Proactive scan started on panel open; "ready" handler awaits this to avoid double scan. */
let buildPromise = null;
let cachedFindings = null;
let lastConversationTurns = [];
/** Stale Jira mismatches from last fetch; used by runGateCheck. */
let lastStaleJiraMismatches = [];
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
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand("arch-visualizer.open", () => openPanel(context)));
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
    buildPromise = buildAndSendGraph(rootPath);
    (0, agent_1.subscribeTrace)((entry) => {
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
        }
        if (msg.type === "refresh") {
            await buildAndSendGraph(rootPath);
            sendStagingAndRecovery(rootPath);
        }
        if (msg.type === "askAI" && graph) {
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
            const result = useMockEnricher()
                ? await (0, mockEnricher_1.askAboutArchitecture)(msg.question, g, msg.nodeId, msg.history, undefined, findings)
                : await (0, manager_1.runArchitectureTask)({
                    question: msg.question,
                    graph: g,
                    nodeId: msg.nodeId,
                    history: msg.history,
                    mode,
                    apiKeyOpenAI: getOpenAiApiKey(),
                    apiKeyClaude: getAnthropicApiKey(),
                    findings,
                    rootPath: resolvedRootPath,
                });
            send({
                type: "aiResponse",
                answer: result.answer,
                ...(result.graphCommand ? { graphCommand: result.graphCommand } : {}),
                ...((result.proposal)
                    ? { proposal: result.proposal }
                    : {}),
            });
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
                const project = process.env.JIRA_PROJECT?.trim();
                let jql = process.env.JIRA_JQL?.trim()
                    || (project
                        ? `project = ${project} AND resolution = Unresolved ORDER BY updated DESC`
                        : "resolution = Unresolved ORDER BY updated DESC");
                const cfg = vscode.workspace.getConfiguration("archVisualizer");
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
                    type: "jiraIssues",
                    issues: issues.map((i) => ({ ...i, baseUrl })),
                    repoName,
                    staleMismatches: staleMismatches.length > 0 ? staleMismatches : undefined,
                });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                send({ type: "jiraIssuesError", error: message });
            }
        }
        if (msg.type === "requestPlan") {
            handleRequestPlan(rootPath, msg.goal);
        }
        if (msg.type === "approveDesign") {
            try {
                const plan = convertDesignToPlan(msg.proposal);
                pendingPlan = plan;
                // Log to Output channel via trace for now
                (0, agent_1.emitTrace)("plan", { source: "design_approval" }, { plan }, "Design approved → created AgentPlan from proposal");
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
                        const lint = (0, agent_1.runLint)(rootPath, msg.paths);
                        const vitest = (0, agent_1.runVitest)(rootPath);
                        const passed = lint.passed && vitest.passed;
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
                            }
                            (0, agent_1.saveSession)(rootPath, session);
                            send({ type: "agentSessionUpdate", session });
                            runGateCheck(rootPath);
                            const fix = await (0, agent_1.runTaskAtIndex)(pendingPlan, curIndex, rootPath, {
                                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                                conversationTurns: lastConversationTurns,
                                errorOutput,
                            });
                            if (fix.hasStaging) {
                                const staging = (0, agent_1.getStagingEntries)();
                                send({
                                    type: "agentStagingEntries",
                                    entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                                });
                            }
                        }
                        else {
                            session.currentTaskIndex += 1;
                            (0, agent_1.saveSession)(rootPath, session);
                            send({ type: "agentSessionUpdate", session });
                            const next = await (0, agent_1.runTaskAtIndex)(pendingPlan, session.currentTaskIndex, rootPath, {
                                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                                conversationTurns: lastConversationTurns,
                            });
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
        send({ type: "loading", message: "Enriching graph..." });
        g = await (0, enricher_v2_1.enrichGraph)(g, getOpenAiApiKey());
        g = (0, graphAnalyser_1.analyseGraph)(g);
        graph = g;
        send({ type: "graph", data: g });
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
    const ctx = {
        hasPlan: !!pendingPlan,
        planApproved: !!pendingPlan,
        hasStagingWrites,
        scopeViolation,
        scopeViolationPath,
        lintPassed: true,
        vitestPassed: true,
        playwrightPassed: true,
        retryCountCode: retryCountTotal,
        retryCountArch: 0,
        retryLimitCode: config.get("retryLimitCode") ?? 3,
        retryLimitArch: config.get("retryLimitArch") ?? 2,
        retryLimitSession: config.get("retryLimitSession") ?? 50,
        llmCallCount: session?.llmCallCount ?? 0,
        tokenUsage: session?.tokenUsage ?? 0,
        tokenBudget: config.get("tokenBudgetSession") ?? 100_000,
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
        (0, agent_1.emitTrace)("gate", { gate: gate.gate }, gate.metadata ?? {}, reason);
    }
}
let pendingPlan = null;
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
function handleRequestPlan(rootPath, goal) {
    const raw = createMockPlan(goal);
    const result = (0, agent_1.validatePlan)(raw, rootPath);
    if (result.valid && result.plan) {
        pendingPlan = result.plan;
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
        (0, agent_1.emitTrace)("plan", { goal: "user approved" }, {}, "Plan approved → running first task");
        if (pendingPlan) {
            const session = (0, agent_1.createEmptySession)(pendingPlan);
            session.activeGate = null;
            (0, agent_1.saveSession)(rootPath, session);
            const result = await (0, agent_1.runFirstTask)(pendingPlan, rootPath, {
                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                conversationTurns: lastConversationTurns,
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
