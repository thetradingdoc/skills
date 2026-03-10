import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { spawnSync } from "child_process";

/** Extract repo name from git remote (e.g. doclittle-platform from github.com/owner/doclittle-platform) */
function getRepoNameFromGit(workspaceRoot: string): string | null {
  try {
    const proc = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd: workspaceRoot,
      encoding: "utf-8",
      maxBuffer: 4096,
    });
    const url = proc.stdout?.trim();
    if (!url) return null;
    const match = url.match(/(?:github\.com[/:]|gitlab\.com[/:]|bitbucket\.org[/:])[\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
import { scanProject } from "./analyzer/scanner";
import { detectDrift } from "./analyzer/driftDetector";
import { enrichGraph as enrichGraphV2 } from "./ai/enricher-v2";
import { askAboutArchitecture as askMock } from "./ai/mockEnricher";
import { runArchitectureTask } from "./ai/manager";
import { analyseGraph } from "./analysis/graphAnalyser";
import { ProjectWatcher } from "./watcher";
import { writeContextFile } from "./analyzer/contextReader";
import { writeArchRules } from "./analyzer/archRulesReader";
import { generateArchRules } from "./ai/generateRules";
import { ArchGraph, ContractFinding, ExtToWebMessage, CriticViolation } from "./types";
import { scanContracts } from "./agent/contractScanner";
import { scanDocumentReferences } from "./agent/referenceScanner";
import { scanEnvironmentGaps } from "./agent/envScanner";
import { getJiraConfig, searchIssues, addLabel } from "./jira/client";
import {
  loadRails,
  saveRails,
  getAllRails,
  getAllTasks,
  createTask,
  updateTaskStatus,
  updateTaskEvidence,
  updateRailState,
  updateRailPartial,
  suspendRail,
  failRail,
  getRail,
  getTasksByRail,
  getTask,
  loadTemplateForArchetype,
  listTemplateArchetypes,
  getAntiPatternWarnings,
} from "./agent/rail/manager";
import { inferLogicPath, computeHallucinationIndex } from "./agent/rail/archetypes";
import { checkRailCollisions } from "./agent/rail/collisions";
import { loadRegistry } from "./agent/rail/registry";
import {
  transitionRail,
  completeMaterializeAndArchive,
} from "./agent/rail/orchestrator";
import { getRailSandboxPath, syncSandboxFromRoot } from "./agent/rail/executor";
import { triggerFromChat, triggerGovernanceViewIssues, triggerFromViolation } from "./agent/entrypoints";
import {
  validatePlan,
  initTraceLogger,
  emitTrace,
  subscribeTrace,
  subscribeAgentTrace,
  getSessionId,
  getTraceContext,
  setTraceContext,
  clearTraceContext,
  clearSessionTouchedPaths,
  getSessionTouchedPaths,
  collectRecentReasoning,
  classifyFailure,
  initStaging,
  getStagingEntries,
  commitStaging,
  rejectStaging,
  loadSession,
  deleteSession,
  saveSession,
  createEmptySession,
  detectStaleJira,
  extractFingerprintFromDescription,
  updateJira,
  checkGates,
  diffGraph,
  computeIntentDriftScore,
  computeModuleSignals,
  runFirstTask,
  runNextTask,
  runTaskAtIndex,
  runLint,
  runVitest,
  runPlaywrightForRail,
} from "./agent";
import { runVisualCritique } from "./agent/runVisualCritique";
import { captureScreenshot } from "./agent/captureScreenshot";
import { recordPlaywrightResult, getRailTelemetry, recordCritiqueLoop, getAllRailTelemetry } from "./agent/rail/telemetry";
import type { AgentPlan, GateCondition, Task } from "./agent";
import { loadPlannerContext } from "./agent/plannerContext";

let panel: vscode.WebviewPanel | undefined;
let watcher: ProjectWatcher | undefined;
let graph: ArchGraph | undefined;
/** Proactive scan started on panel open; "ready" handler awaits this to avoid double scan. */
let buildPromise: Promise<void> | null = null;
let cachedFindings: ContractFinding[] | null = null;
let lastConversationTurns: Array<{ role: "user" | "assistant"; content: string }> = [];
/** Stale Jira mismatches from last fetch; used by runGateCheck. */
let lastStaleJiraMismatches: Array<{ key: string }> = [];
let lastPlaywrightPassed = true;
/** Mapping from AgentPlan task ids to Rail TaskIds for orchestration. */
const planTaskToRailTask: Record<string, string> = {};

function getOpenAiApiKey(): string | undefined {
  return (
    vscode.workspace.getConfiguration("archVisualizer").get<string>("openaiApiKey") ||
    process.env.OPENAI_API_KEY
  ) ?? undefined;
}

function getAnthropicApiKey(): string | undefined {
  return (
    vscode.workspace.getConfiguration("archVisualizer").get<string>("anthropicApiKey") ||
    process.env.ANTHROPIC_API_KEY
  ) ?? undefined;
}

function useMockEnricher(): boolean {
  if (process.env.ARCH_TEST_MODE === "1") return true;
  return !getAnthropicApiKey() && !getOpenAiApiKey();
}

function getAgentActive(): boolean {
  return vscode.workspace.getConfiguration("archVisualizer").get<boolean>("agentActive", true);
}

async function setAgentActive(active: boolean): Promise<void> {
  await vscode.workspace.getConfiguration("archVisualizer").update("agentActive", active, vscode.ConfigurationTarget.Global);
}

/** SUSPEND all rails in active execution states when agent is turned off. */
function suspendAllActiveRails(rootPath: string): void {
  const activeStates = new Set(["EXECUTING", "AWAITING_HITL", "VERIFYING", "SELF_CORRECTING", "MATERIALIZING"]);
  const rails = getAllRails();
  for (const rail of rails) {
    if (activeStates.has(rail.state)) {
      transitionRail(rootPath, rail.id, "SUSPENDED");
    }
  }
  persistAndNotifyTasks(rootPath);
}

function getModuleDir(rootPath: string, nodeId: string): string {
  return path.join(rootPath, /\.[a-z]+$/i.test(nodeId) ? path.dirname(nodeId) : nodeId);
}

function sendStagingAndRecovery(rootPath: string): void {
  const staging = getStagingEntries();
  if (staging.length > 0) {
    send({
      type: "agentStagingEntries",
      entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
    });
  }
  const recovered = loadSession(rootPath);
  if (recovered) send({ type: "agentSessionRecovery", session: recovered });
}

/** Section 12.3: Clean stale sandboxes; 7-day rule for SUSPENDED, emit warning trace. */
function cleanStaleSandboxes(rootPath: string): void {
  try {
    const rails = getAllRails();
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const activeIds = new Set(
      rails
        .filter((r) => {
          if (r.state === "ARCHIVED" || r.state === "FAILED") return false;
          if (r.state === "SUSPENDED") {
            const ageMs = now - (r.updatedAt ?? r.createdAt);
            return ageMs <= sevenDaysMs;
          }
          return true;
        })
        .map((r) => r.id)
    );

    const sandboxesRoot = path.join(rootPath, ".agent", "sandboxes");
    if (!fs.existsSync(sandboxesRoot)) return;
    const entries = fs.readdirSync(sandboxesRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirName = entry.name;
      if (!dirName.startsWith("rail-")) continue;
      const railId = dirName.replace(/^rail-/, "");
      const fullPath = path.join(sandboxesRoot, dirName);
      const rail = rails.find((r) => r.id === railId || dirName === r.id);
      const keep = activeIds.has(railId) || activeIds.has(dirName);
      if (!keep) {
        const isSuspendedStale =
          rail?.state === "SUSPENDED" &&
          (now - (rail.updatedAt ?? rail.createdAt)) > sevenDaysMs;
        if (isSuspendedStale) {
          initTraceLogger();
          emitTrace({
            role: "manager",
            type: "info",
            message: `Sandbox removed: rail ${railId} was SUSPENDED > 7 days`,
            railId,
          });
        }
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch {
          /* best-effort */
        }
      }
    }
  } catch {
    /* sandbox cleanup is best-effort */
  }
}
function sendTasksSnapshot(rootPath: string): void {
  try {
    loadRails(rootPath);
    const rails = getAllRails();
    const registry = loadRegistry(rootPath);
    for (const rail of rails) {
      if (rail.state === "ARCHIVED" || rail.state === "FAILED") continue;
      const overlaps = checkRailCollisions(rail, registry, (id) => getRail(rootPath, id));
      if (overlaps.length > 0) {
        updateRailPartial(rootPath, rail.id, { overlaps });
      }
    }
    const railsToSend = getAllRails();
    const tasks = getAllTasks();
    const railTelemetry = getAllRailTelemetry();
    const retryLimit = vscode.workspace.getConfiguration("archVisualizer").get<number>("retryLimitCode") ?? 3;
    const session = loadSession(rootPath);
    const telemetry: Record<string, { tokenUsage: number; critiqueLoopCount: number; pathSuccessRate: number; retryCount?: number; retryLimit?: number }> = {};
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
    } as any);
  } catch {
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
function deriveViolationsFromGraph(g: ArchGraph | undefined): CriticViolation[] {
  if (!g) return [];
  const nodes = g.nodes ?? [];
  const edges = g.edges ?? [];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const violations: CriticViolation[] = [];

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
        description:
          (e as { driftReason?: string }).driftReason ??
          `${src} depends on ${tgt} (violates architecture rules).`,
        suggestedFix: "Remove the forbidden dependency or update the architecture rules.",
      });
    }
  }

  return violations;
}

/** Section 11.1: Incremental task update. */
function sendTaskUpdate(taskId: string, update: Partial<Task>): void {
  send({ type: "taskUpdate", taskId, update } as any);
}

/** Section 11.1: Incremental rail update. */
function sendRailUpdate(railId: string, update: Partial<import("./agent").Rail>): void {
  send({ type: "railUpdate", railId, update } as any);
}

/** Section 12.2: Persist and notify after rail/task mutations. */
function persistAndNotifyTasks(rootPath: string): void {
  try {
    saveRails(rootPath);
    sendTasksSnapshot(rootPath);
  } catch {
    /* best-effort */
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("arch-visualizer.open", () => openPanel(context)),
    vscode.commands.registerCommand("arch-visualizer.checkGates", () => runCheckGatesCommand())
  );
}

async function openPanel(context: vscode.ExtensionContext) {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.[0]) {
    vscode.window.showErrorMessage("Open a workspace folder first.");
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const config = vscode.workspace.getConfiguration("archVisualizer");
  const projectRoot = config.get<string>("projectRoot") ?? ".";
  const fixturePath = process.env.ARCH_FIXTURE_PATH;
  const rootPath = fixturePath
    ? path.resolve(workspaceRoot, fixturePath)
    : path.join(workspaceRoot, projectRoot);

  if (panel) {
    buildPromise = null;
    panel.reveal(vscode.ViewColumn.Two);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    "archVisualizer",
    "Architecture Map",
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "webview-ui", "dist"),
      ],
    }
  );

  panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);

  initStaging(rootPath);
  loadRails(rootPath);
  cleanStaleSandboxes(rootPath);

  buildPromise = buildAndSendGraph(rootPath);

  subscribeTrace((entry) => {
    const ctx = getTraceContext();
    const role: "executor" | "reviewer" | "manager" =
      entry.stepType === "gate" || entry.stepType === "plan" ? "manager" : "executor";
    const eventType: "info" | "tool_call" | "critic_feedback" | "error" =
      entry.stepType === "error" ? "error" : ["read_file", "write_file", "run_lint", "run_vitest"].includes(entry.stepType) ? "tool_call" : "info";
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
        metadata:
          ctx.logicPathStep || ctx.filePath
            ? { logicPathStep: ctx.logicPathStep, filePath: ctx.filePath }
            : undefined,
      },
    });
  });
  subscribeAgentTrace((entry) => {
    send({
      type: "agentTrace",
      entry: {
        id: entry.id,
        sessionId: getSessionId(),
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
      if (graph) send({ type: "graph", data: graph });
      sendStagingAndRecovery(rootPath);
      persistAndNotifyTasks(rootPath);
      send({ type: "agentActive", active: getAgentActive() } as any);
    }
    if (msg.type === "refresh") {
      await buildAndSendGraph(rootPath);
      sendStagingAndRecovery(rootPath);
    }
    if (msg.type === "setAgentActive") {
      await setAgentActive(msg.active);
      if (!msg.active) suspendAllActiveRails(rootPath);
      send({ type: "agentActive", active: msg.active } as any);
    }
    if (msg.type === "openTaskFile") {
      const fullPath = path.join(rootPath, (msg.filePath as string).replace(/\\/g, "/"));
      if (fs.existsSync(fullPath)) {
        const uri = vscode.Uri.file(fullPath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
      }
    }
    if (msg.type === "askAI" && graph) {
      if (!getAgentActive()) {
        send({ type: "aiResponse", answer: "[Agent paused] Enable the agent toggle to use AI features." } as any);
        return;
      }
      const STALENESS_MS = 5 * 60 * 1000; // 5 minutes
      if (Date.now() - graph.generatedAt > STALENESS_MS) {
        await buildAndSendGraph(rootPath);
      }
      const g = graph;
      if (!cachedFindings) {
        cachedFindings = [
          ...scanContracts(rootPath),
          ...scanDocumentReferences(rootPath),
          ...scanEnvironmentGaps(rootPath),
        ];
      }
      const findings = cachedFindings;
      if (Array.isArray(msg.history)) {
        lastConversationTurns = msg.history
          .filter(
            (m: any) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string"
          )
          .slice(-4)
          .map((m: any) => ({ role: m.role, content: m.content }));
      }
      const isEmptyGraph = !g.nodes || g.nodes.length === 0;
      const mode = isEmptyGraph ? "greenfield" : "analysis";
      const resolvedRootPath = mode === "analysis" && rootPath ? rootPath : null;

      if (useMockEnricher()) {
        const mockResult = await askMock(
          msg.question,
          g,
          msg.nodeId,
          msg.history,
          undefined,
          findings
        );
        send({
          type: "aiResponse",
          answer: mockResult.answer,
          ...(mockResult.graphCommand ? { graphCommand: mockResult.graphCommand } : {}),
        });
      } else {
        const result = await runArchitectureTask({
          question: msg.question,
          graph: g,
          nodeId: msg.nodeId,
          history: msg.history,
          mode,
          apiKeyOpenAI: getOpenAiApiKey(),
          apiKeyClaude: getAnthropicApiKey(),
          findings,
          rootPath: resolvedRootPath,
          rail: pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) ?? undefined : undefined,
          ...(msg.pdfBase64 && typeof msg.pdfBase64 === "string"
            ? {
                pdfBase64: msg.pdfBase64,
                pdfFileName: typeof msg.pdfFileName === "string" ? msg.pdfFileName : "document.pdf",
              }
            : {}),
        });
        send({
          type: "aiResponse",
          answer: result.answer,
          ...(result.graphCommand ? { graphCommand: result.graphCommand } : {}),
          ...(result.violations ? { violations: result.violations } : {}),
          ...(((result as any).proposal)
            ? { proposal: (result as any).proposal }
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
      } else {
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
        } else {
          send({ type: "fileContent", filePath: msg.filePath, content: null, error: "File not found" });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        send({ type: "fileContent", filePath: msg.filePath, content: null, error });
      }
    }
    if (msg.type === "writeContext") {
      try {
        const moduleDir = getModuleDir(rootPath, msg.nodeId);
        writeContextFile({
          modulePath: moduleDir,
          layer: msg.layer,
          description: msg.description,
          role: msg.role,
        });
        send({ type: "writeContextResult", success: true });
        await buildAndSendGraph(rootPath);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        send({ type: "writeContextResult", success: false, error });
      }
    }
    if (msg.type === "generateRules" && graph) {
      try {
        send({ type: "loading", message: "Generating rules..." });
        // Rules generation stays on OpenAI for cost reasons; Claude is used for live reasoning.
        const config = await generateArchRules(graph, getOpenAiApiKey());
        const rules = config.rules.map((r) => ({
          id: r.id,
          description: r.description,
          severity: r.severity,
        }));
        send({ type: "rulesPreview", rules, raw: JSON.stringify(config, null, 2) });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        send({ type: "generateRulesResult", success: false, error });
      }
    }
    if (msg.type === "writeRules") {
      try {
        const config = JSON.parse(msg.raw);
        writeArchRules(rootPath, config);
        send({ type: "generateRulesResult", success: true });
        await buildAndSendGraph(rootPath);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        send({ type: "generateRulesResult", success: false, error });
      }
    }
    if (msg.type === "fetchJiraTests") {
      try {
        const config = getJiraConfig();
        if (!config) {
          send({ type: "jiraIssuesError", error: "Jira not configured (JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN)" });
          return;
        }
        const cfg = vscode.workspace.getConfiguration("archVisualizer");
        const projectFromMsg =
          typeof (msg as any).projectKey === "string" && (msg as any).projectKey.trim()
            ? (msg as any).projectKey.trim()
            : undefined;
        const projectFromConfig = (cfg.get<string>("jiraProject") ?? "").trim() || undefined;
        const projectFromEnv = process.env.JIRA_PROJECT?.trim();
        const project = projectFromMsg ?? projectFromConfig ?? projectFromEnv;
        if (projectFromMsg && projectFromMsg !== projectFromConfig) {
          void cfg.update("jiraProject", projectFromMsg, vscode.ConfigurationTarget.Workspace);
        }

        // Create a governance rail for the "View issues" flow so we can dogfood the Rails model.
        const governanceRail = triggerGovernanceViewIssues({
          rootPath,
          sessionId: "governance-view-issues",
          projectKey: project,
        });

        let jql =
          process.env.JIRA_JQL?.trim() ||
          (project
            ? `project = ${project} AND resolution = Unresolved ORDER BY updated DESC`
            : "resolution = Unresolved ORDER BY updated DESC");
        const explicitLabels = cfg.get<string[]>("jiraLabels");
        const filterByRepo = msg.filterByRepo ?? cfg.get<boolean>("jiraFilterByRepo") ?? true;
        let labelClause = "";
        if (filterByRepo) {
          if (Array.isArray(explicitLabels) && explicitLabels.length > 0) {
            const quoted = explicitLabels.map((l) => `'${String(l).replace(/'/g, "''")}'`).join(", ");
            labelClause = ` AND labels in (${quoted})`;
          } else {
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
        const issues = await searchIssues(config, jql, 25, { includeDescription: true });
        const baseUrl = config.baseUrl.replace(/\/$/, "");
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
        let staleMismatches: Array<{
          key: string;
          summary: string;
          storedFingerprint: string | null;
          storedModule: string | null;
          currentFingerprint: string | null;
          reason: "changed" | "orphaned" | "missing_stored";
        }> = [];
        if (graph) {
          staleMismatches = detectStaleJira(graph, issuesWithFp);
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
        } as any);

        // Section 13: Attach governance tasks (T3 and T6 HITL gates).
        if (governanceRail) {
          const railId = governanceRail.id;
          const now = Date.now();
          initTraceLogger();
          setTraceContext({ railId, taskId: undefined, logicPathStep: "1: UI - RENDER_VIEW_ISSUES_BUTTON", filePath: "webview-ui/src/App.tsx" });
          emitTrace({ role: "manager", type: "info", message: "Governance rail created", railId });
          clearTraceContext();

          const t1: Task = { id: `${railId}-t1`, railId, kind: "code_change", description: "Render View Issues button", files: ["webview-ui/src/App.tsx"], autoCapable: true, status: "completed", agent: "executor", logicStep: 1, createdAt: now, resolvedAt: now };
          const t2: Task = { id: `${railId}-t2`, railId, kind: "code_change", description: "Pass active project ID", files: ["webview-ui/src/App.tsx"], autoCapable: true, status: "completed", agent: "executor", logicStep: 2, createdAt: now, resolvedAt: now };
          createTask(t1);
          createTask(t2);

          const t3: Task = {
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
          createTask(t3);

          const t4: Task = { id: `${railId}-t4`, railId, kind: "governance_sync", description: "Call Jira GET issues", files: ["src/jira/client.ts"], autoCapable: true, status: "completed", agent: "executor", logicStep: 4, evidence: jql, jiraKey: project ?? undefined, createdAt: now, resolvedAt: now };
          const t5: Task = { id: `${railId}-t5`, railId, kind: "governance_sync", description: "Return filtered issues", files: [], autoCapable: true, status: "completed", agent: "executor", logicStep: 5, evidence: `${issues.length} issues`, jiraKey: project ?? undefined, createdAt: now, resolvedAt: now };
          createTask(t4);
          createTask(t5);

          const t6: Task = {
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
          createTask(t6);

          persistAndNotifyTasks(rootPath);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "jiraIssuesError", error: message });
      }
    }
    if (msg.type === "jiraSettingsHelp") {
      vscode.window.showInformationMessage(
        "Jira for the Architecture Map extension is configured via environment variables: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN (and optional JIRA_PROJECT/JIRA_JQL). Update those and reload VS Code to change Jira settings."
      );
    }
    if (msg.type === "requestPlan") {
      handleRequestPlan(rootPath, msg.goal);
    }
    if (msg.type === "approveDesign") {
      try {
        const plan = convertDesignToPlan(msg.proposal as ArchitectureProposal);
        pendingPlan = plan;
        emitTrace({
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to convert design to plan: ${message}`);
      }
    }
    if (msg.type === "agentPlanAction") {
      await handleAgentPlanAction(msg.action, msg.editFeedback, rootPath);
      runGateCheck(rootPath);
      const session = loadSession(rootPath);
      if (session) send({ type: "agentSessionUpdate" as any, session });
    }
    if (msg.type === "agentDiffApprove") {
      const r = commitStaging(msg.paths, rootPath);
      if (r.success) {
        send({ type: "agentStagingEntries", entries: [] });
        checkJiraResolveAfterCommit(rootPath, msg.paths, graph);
        const session = loadSession(rootPath);
        if (session && pendingPlan) {
          setImmediate(async () => {
            // Refresh graph snapshot after commit for diff_graph and drift metrics.
            await buildAndSendGraph(rootPath);

            // diff_graph: detect layer mismatches introduced by commit.
            if (graph && pendingPlan) {
              const dg = diffGraph(graph, pendingPlan);
              if (dg.delta.layerMismatches.length > 0 && pendingPlanRailId) {
                const msg0 = dg.delta.layerMismatches[0]?.violation ?? "Layer violation detected";
                updateRailPartial(rootPath, pendingPlanRailId, {
                  lastCritique: { source: "reviewer", message: msg0, createdAt: Date.now() },
                } as any);
                updateRailState(rootPath, pendingPlanRailId, "AWAITING_HITL");
                persistAndNotifyTasks(rootPath);
                return;
              }
            }

            // Drift metric: hallucination index (planned vs touched nodes).
            if (pendingPlanRailId && graph) {
              const rail = getRail(rootPath, pendingPlanRailId);
              if (rail) {
                const touchedPaths = getSessionTouchedPaths();
                const touchedNodeIds = touchedPaths
                  .flatMap((p) =>
                    graph!.nodes
                      .filter((n) => n.path === p || (n as any).files?.some((f: string) => f === p))
                      .map((n) => n.id)
                  )
                  .filter((id, i, arr) => arr.indexOf(id) === i);
                const hi = computeHallucinationIndex(rail.logicPath, touchedNodeIds);
                updateRailPartial(rootPath, pendingPlanRailId, { hallucinationIndex: hi });
                persistAndNotifyTasks(rootPath);
                if (hi > 0.5) {
                  // Automatic realign: suspend current rail and propose a new plan scoped to what was actually touched.
                  updateRailPartial(rootPath, pendingPlanRailId, {
                    lastCritique: {
                      source: "reviewer",
                      message: `Drift detected: hallucination index ${(hi * 100).toFixed(0)}%. Auto-generating a realigned plan.`,
                      createdAt: Date.now(),
                    },
                  } as any);
                  updateRailState(rootPath, pendingPlanRailId, "SUSPENDED");

                  const realignPlan = buildRealignPlanFromTouched(
                    pendingPlan?.goal ?? rail.outcome ?? "Realign plan",
                    touchedPaths
                  );
                  const newRail = triggerFromChat({
                    rootPath,
                    userMessage: realignPlan.goal,
                    sessionId: "agent-realign",
                    archetype: rail.archetype,
                  });
                  pendingPlan = realignPlan;
                  pendingPlanRailId = newRail.id;
                  updateRailPartial(rootPath, newRail.id, { intentSummary: `${realignPlan.goal} — ${newRail.outcome}` } as any);
                  updateRailState(rootPath, newRail.id, "AWAITING_APPROVAL");
                  for (let i = 0; i < realignPlan.tasks.length; i++) {
                    const t = realignPlan.tasks[i];
                    const task: Task = {
                      id: `rail-task-${t.id}`,
                      railId: newRail.id,
                      kind: "code_change",
                      description: t.expectedOutput,
                      files: [],
                      autoCapable: true,
                      status: "pending",
                      agent: "executor",
                      logicStep: i + 1,
                      createdAt: Date.now(),
                    };
                    createTask(task);
                    planTaskToRailTask[t.id] = task.id;
                  }
                  persistAndNotifyTasks(rootPath);
                  send({
                    type: "agentPlan",
                    plan: {
                      goal: realignPlan.goal,
                      tasks: realignPlan.tasks.map((t) => ({
                        id: t.id,
                        module: t.module,
                        layer: t.layer,
                        action: t.action,
                        expectedOutput: t.expectedOutput,
                      })),
                      dependencies: realignPlan.dependencies,
                    },
                  });
                  return;
                }
              }
            }

            // Intent drift detection from recent rail reasoning vs intentSummary.
            if (pendingPlanRailId) {
              const rail = getRail(rootPath, pendingPlanRailId);
              if (rail?.intentSummary) {
                const samples = collectRecentReasoning(pendingPlanRailId, 10).map((r) => r.message);
                const score = computeIntentDriftScore(rail.intentSummary, samples);
                updateRailPartial(rootPath, pendingPlanRailId, { intentDriftScore: score });
                if (score > 0.6) {
                  updateRailPartial(rootPath, pendingPlanRailId, {
                    lastCritique: {
                      source: "reviewer",
                      message: `Intent drift score ${(score * 100).toFixed(0)}% (plan/outcome vs recent reasoning).`,
                      createdAt: Date.now(),
                    },
                  } as any);
                  updateRailState(rootPath, pendingPlanRailId, "AWAITING_HITL");
                  persistAndNotifyTasks(rootPath);
                  return;
                }
              }
            }

            // If we have an associated plan rail, sync changed files into its sandbox and test there.
            let sandboxDir: string | undefined;
            if (pendingPlanRailId) {
              sandboxDir = syncSandboxFromRoot(rootPath, pendingPlanRailId, msg.paths ?? []);
            }
            const workingDir = sandboxDir ?? rootPath;
            const sandboxHash =
              sandboxDir && Array.isArray(msg.paths) && msg.paths.length > 0
                ? computeFilesHash(sandboxDir, msg.paths)
                : "";

            const lint = runLint(rootPath, msg.paths, workingDir);
            const vitest = runVitest(rootPath, undefined, workingDir);
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
              const taskId = pendingPlan!.tasks[curIndex]?.id;
              if (taskId) {
                session.retryCounts[taskId] = (session.retryCounts[taskId] ?? 0) + 1;
                const railTaskId = planTaskToRailTask[taskId];
                if (railTaskId && pendingPlanRailId) {
                  updateTaskStatus(railTaskId, "awaiting_hitl");
                }
              }
              saveSession(rootPath, session);
              send({ type: "agentSessionUpdate" as any, session });

              runGateCheck(rootPath);

              const retryLimitCode = vscode.workspace.getConfiguration("archVisualizer").get<number>("retryLimitCode") ?? 3;
              if (taskId && (session.retryCounts[taskId] ?? 0) >= retryLimitCode) {
                if (pendingPlanRailId) updateRailState(rootPath, pendingPlanRailId, "AWAITING_HITL");
                persistAndNotifyTasks(rootPath);
                return;
              }

              const railForFix = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
              const railTaskForFix = taskId ? getTask(planTaskToRailTask[taskId] ?? "") : null;
              const stepFix = railForFix?.logicPath?.[railTaskForFix?.logicStep ?? 0];
              setTraceContext({
                railId: pendingPlanRailId ?? undefined,
                taskId: planTaskToRailTask[taskId] ?? undefined,
                logicPathStep: stepFix ? `${stepFix.step}: ${stepFix.layer} - ${stepFix.filePath}` : undefined,
                filePath: stepFix?.filePath,
              });
              if (pendingPlanRailId) {
                updateRailPartial(rootPath, pendingPlanRailId, {
                  lastCritique: {
                    source: !lint.passed || !vitest.passed ? "test" : "unknown",
                    message: sandboxHash ? `${errorOutput}\n\nsandboxHash: ${sandboxHash}` : errorOutput,
                    createdAt: Date.now(),
                  },
                } as any);
              }

              if (pendingPlanRailId && taskId) {
                updateRailState(rootPath, pendingPlanRailId, "SELF_CORRECTING");
                const railTaskId = planTaskToRailTask[taskId];
                if (railTaskId) {
                  updateTaskStatus(railTaskId, "executing");
                }
              }

              const railForCtx = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
              const railTaskForCtx = taskId ? getTask(planTaskToRailTask[taskId] ?? "") : null;
              const step = railForCtx?.logicPath?.[railTaskForCtx?.logicStep ?? 0];
              setTraceContext({
                railId: pendingPlanRailId ?? undefined,
                taskId: planTaskToRailTask[taskId] ?? undefined,
                logicPathStep: step ? `${step.step}: ${step.layer} - ${step.filePath}` : undefined,
                filePath: step?.filePath,
              });
              const railForFixCtx = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
              const modSignals = getModuleSignalsForModule(graph, pendingPlan!.tasks[curIndex]?.module ?? "");
              const fix = await runTaskAtIndex(pendingPlan!, curIndex, rootPath, {
                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                conversationTurns: lastConversationTurns,
                errorOutput,
                rail: railForFixCtx ?? undefined,
                railHistory: lastConversationTurns,
                moduleSignals: modSignals,
              });
              clearTraceContext();
              if (fix.hasStaging) {
                const staging = getStagingEntries();
                send({
                  type: "agentStagingEntries",
                  entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                });
              }
              if (pendingPlanRailId) {
                updateRailState(rootPath, pendingPlanRailId, "EXECUTING");
              }
            } else {
              // UI verification: Step 1 optional Playwright specs, Step 2 vision critique on every UI rail (no spec required).
              const rail = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
              const hasUIStep = rail?.logicPath?.some((s) => s.layer === "UI") ?? true;
              if (pendingPlanRailId && hasUIStep) {
                const baseUrl =
                  process.env.APP_URL ??
                  process.env.PLAYWRIGHT_BASE_URL ??
                  "http://localhost:3000";
                const cfg = vscode.workspace.getConfiguration("archVisualizer");
                const specs = cfg.get<string[]>("playwrightSpecs") ?? [];
                let pwResult: Awaited<ReturnType<typeof runPlaywrightForRail>> | undefined;

                // Step 1: optional human-authored Playwright specs
                if (specs.length > 0) {
                  pwResult = await runPlaywrightForRail(
                    pendingPlanRailId,
                    rootPath,
                    sandboxDir ?? rootPath,
                    specs,
                    baseUrl
                  );
                  lastPlaywrightPassed = pwResult.passed;
                  passed = passed && pwResult.passed;
                }

                // Step 2: vision critique on every UI rail — no spec required; agent finds problems itself
                try {
                  const screenshotPath =
                    pwResult?.failures?.[0]?.screenshotPath ??
                    (await captureScreenshot(baseUrl, sandboxDir ?? rootPath, pendingPlanRailId));
                  const violations = await runVisualCritique(screenshotPath, rail?.outcome ?? "");
                  const high = violations.filter((v) => v.severity === "high");
                  if (high.length > 0) {
                    const visionFailures = high.map((v) => ({
                      testName: `[VISUAL] ${v.element}`,
                      error: `[VISUAL] ${v.violation}`,
                      screenshotPath,
                      domSnapshot: "",
                      consoleErrors: [] as string[],
                      networkFailures: [] as Array<{ url: string; status: number }>,
                    }));
                    if (pwResult) {
                      pwResult.failures.unshift(...visionFailures);
                      pwResult.passed = false;
                    } else {
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
                } catch {
                  // Vision critique is best-effort; never block the main flow.
                }

                if (pwResult && !pwResult.passed) {
                  recordPlaywrightResult(pendingPlanRailId, false);
                  const curIndex = session.currentTaskIndex ?? 0;
                  const taskId = pendingPlan!.tasks[curIndex]?.id;
                  const railTaskId = taskId ? planTaskToRailTask[taskId] : null;
                  const touchedPaths = getSessionTouchedPaths();
                  const verificationOutput = {
                    tool: "run_playwright_trace" as const,
                    passed: false,
                    errors: (touchedPaths.length > 0 ? touchedPaths : [pwResult.spec]).slice(0, 1).map(
                      (fp) =>
                        ({
                          filePath: fp,
                          message: pwResult.failures[0]?.error ?? "Playwright failed",
                          type: "runtime" as const,
                        })
                    ),
                  };
                  const classification = classifyFailure(verificationOutput, {
                    touchedPaths,
                    plan: pendingPlan!,
                    retryCounts: session.retryCounts ?? {},
                  });
                  if (classification.route === "code_writer") {
                    const errorOutput = `Playwright failures:\n${JSON.stringify(
                      pwResult.failures.slice(0, 10),
                      null,
                      2
                    )}`;
                    if (taskId) {
                      session.retryCounts[taskId] = (session.retryCounts[taskId] ?? 0) + 1;
                      if (railTaskId && pendingPlanRailId) {
                        updateTaskStatus(railTaskId, "executing");
                      }
                    }
                    saveSession(rootPath, session);
                    send({ type: "agentSessionUpdate" as any, session });
                    if (pendingPlanRailId && taskId) {
                      updateRailState(rootPath, pendingPlanRailId, "SELF_CORRECTING");
                      if (railTaskId) updateTaskStatus(railTaskId, "executing");
                    }
                    const retryLimitCode = vscode.workspace.getConfiguration("archVisualizer").get<number>("retryLimitCode") ?? 3;
                    if (taskId && (session.retryCounts[taskId] ?? 0) >= retryLimitCode) {
                      if (railTaskId) updateTaskStatus(railTaskId, "awaiting_hitl");
                      updateRailState(rootPath, pendingPlanRailId, "AWAITING_HITL");
                      persistAndNotifyTasks(rootPath);
                      return;
                    }
                    const railForPwFix = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
                    const modSignals = getModuleSignalsForModule(graph, pendingPlan!.tasks[curIndex]?.module ?? "");
                    const fix = await runTaskAtIndex(pendingPlan!, curIndex, rootPath, {
                      apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                      conversationTurns: lastConversationTurns,
                      errorOutput,
                      rail: railForPwFix ?? undefined,
                      railHistory: lastConversationTurns,
                      moduleSignals: modSignals,
                    });
                    if (fix.hasStaging) {
                      const staging = getStagingEntries();
                      send({
                        type: "agentStagingEntries",
                        entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
                      });
                    }
                    if (pendingPlanRailId) {
                      updateRailState(rootPath, pendingPlanRailId, "EXECUTING");
                    }
                    clearTraceContext();
                    persistAndNotifyTasks(rootPath);
                    return;
                  }
                  if (railTaskId) {
                    updateTaskStatus(railTaskId, "awaiting_hitl");
                    const evidence = JSON.stringify(
                      { failures: pwResult.failures, tracePath: pwResult.tracePath, spec: pwResult.spec },
                      null,
                      2
                    );
                    updateTaskEvidence(railTaskId, evidence);
                  }
                  updateRailState(rootPath, pendingPlanRailId, "AWAITING_HITL");
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
              saveSession(rootPath, session);
              send({ type: "agentSessionUpdate" as any, session });

              const completedIndex = (session.currentTaskIndex ?? 0) - 1;
              const completedPlanTask = pendingPlan!.tasks[completedIndex];
              if (completedPlanTask && pendingPlanRailId) {
                const railTaskId = planTaskToRailTask[completedPlanTask.id];
                if (railTaskId) {
                  updateTaskStatus(railTaskId, "completed");
                }
              }
              const nextPlanTask = pendingPlan!.tasks[session.currentTaskIndex];
              if (nextPlanTask && pendingPlanRailId) {
                const nextRailTaskId = planTaskToRailTask[nextPlanTask.id];
                if (nextRailTaskId) {
                  updateTaskStatus(nextRailTaskId, "executing");
                }
              } else if (!nextPlanTask && pendingPlanRailId) {
                // All plan tasks done, reviewer passed → VERIFYING → MATERIALIZING → ARCHIVED.
                updateRailState(rootPath, pendingPlanRailId, "VERIFYING");
                const archived = completeMaterializeAndArchive(rootPath, pendingPlanRailId);
                if (archived) {
                  persistAndNotifyTasks(rootPath);
                }
              }

              const nextIndex = session.currentTaskIndex;
              const nextPlanTaskId = pendingPlan!.tasks[nextIndex]?.id;
              const nextRailTaskId = nextPlanTaskId ? planTaskToRailTask[nextPlanTaskId] : null;
              const railForNext = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
              const railTaskForNext = nextRailTaskId ? getTask(nextRailTaskId) : null;
              const stepNext = railForNext?.logicPath?.[railTaskForNext?.logicStep ?? 0];
              setTraceContext({
                railId: pendingPlanRailId ?? undefined,
                taskId: nextRailTaskId ?? undefined,
                logicPathStep: stepNext ? `${stepNext.step}: ${stepNext.layer} - ${stepNext.filePath}` : undefined,
                filePath: stepNext?.filePath,
              });
              const nextModule = pendingPlan!.tasks[session.currentTaskIndex]?.module ?? "";
              const nextSignals = getModuleSignalsForModule(graph, nextModule);
              const next = await runTaskAtIndex(pendingPlan!, session.currentTaskIndex, rootPath, {
                apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
                conversationTurns: lastConversationTurns,
                rail: railForNext ?? undefined,
                railHistory: lastConversationTurns,
                moduleSignals: nextSignals,
              });
              clearTraceContext();
              if (next.hasStaging) {
                const staging = getStagingEntries();
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
      rejectStaging(msg.paths);
      send({ type: "agentStagingEntries", entries: [] });
      if (pendingPlanRailId) {
        recordCritiqueLoop(pendingPlanRailId);
        const rail = getRail(rootPath, pendingPlanRailId);
        if (rail && graph) {
          const touchedPaths = getSessionTouchedPaths();
          const touchedNodeIds = touchedPaths
            .flatMap((p) => graph!.nodes.filter((n) => n.path === p || (n as any).files?.some((f: string) => f === p)).map((n) => n.id))
            .filter((id, i, arr) => arr.indexOf(id) === i);
          const hi = computeHallucinationIndex(rail.logicPath, touchedNodeIds);
          updateRailPartial(rootPath, pendingPlanRailId, { hallucinationIndex: hi });
          const intendedIds = new Set(rail.logicPath.map((s) => s.nodeId));
          const divergedNodeIds = touchedNodeIds.filter((id) => !intendedIds.has(id));
          if (hi > 0.5) {
            initTraceLogger();
            emitTrace({
              role: "reviewer",
              type: "critic_feedback",
              message: `Drift detected: hallucination index ${(hi * 100).toFixed(0)}% (intended vs touched nodes)`,
              railId: pendingPlanRailId,
              metadata: divergedNodeIds.length > 0 ? { divergedNodeIds } : undefined,
            });
          }
        }
        const result = transitionRail(rootPath, pendingPlanRailId, "SUSPENDED");
        if (result.ok) persistAndNotifyTasks(rootPath);
      }
    }
    if (msg.type === "agentSessionRestore") {
      const recovered = loadSession(rootPath);
      if (recovered) {
        pendingPlan = recovered.planState;
        const staging = getStagingEntries();
        if (staging.length > 0) {
          send({
            type: "agentStagingEntries",
            entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
          });
        }
      }
    }
    if (msg.type === "agentSessionDiscard") {
      deleteSession(rootPath);
    }
    if (msg.type === "agentJiraResolveAction") {
      // Resolve = transition to Done; Keep/Dismiss = no-op (just close modal)
      if (msg.action === "resolve") {
        const config = getJiraConfig();
        if (config) {
          updateJira(config, msg.key, "archive").catch((err) => {
            vscode.window.showErrorMessage(`Jira resolve failed: ${err instanceof Error ? err.message : err}`);
          });
        }
      }
    }
    if (msg.type === "agentPartialPlanFailureAction") {
      // Abort = clear session; Revert = show message; Create Jira = would create issue
      if (msg.action === "abort") {
        deleteSession(rootPath);
      }
      if (msg.action === "create_jira") {
        vscode.window.showInformationMessage("Create Jira for partial completion — not yet implemented.");
      }
    }
    if (msg.type === "agentCostGateAction") {
      const session = loadSession(rootPath);
      if (msg.action === "abort") {
        deleteSession(rootPath);
        persistAndNotifyTasks(rootPath);
      }
      if (msg.action === "extend" && session) {
        const amount = msg.amount ?? 20_000;
        const EXTEND_CEILING = 180_000;
        const baseTokenBudget = vscode.workspace.getConfiguration("archVisualizer").get<number>("tokenBudgetSession") ?? 100_000;
        const baseLlmLimit = vscode.workspace.getConfiguration("archVisualizer").get<number>("retryLimitSession") ?? 50;
        session.extendedTokenBudget = Math.min((session.extendedTokenBudget ?? 0) + amount, EXTEND_CEILING - baseTokenBudget);
        session.extendedLlmLimit = (session.extendedLlmLimit ?? 0) + 20;
        saveSession(rootPath, session);
        send({ type: "agentSessionUpdate" as any, session });
        persistAndNotifyTasks(rootPath);
        if (pendingPlanRailId) {
          const rail = getRail(rootPath, pendingPlanRailId);
          if (rail?.state === "FAILED") {
            updateRailState(rootPath, pendingPlanRailId, "SUSPENDED");
            persistAndNotifyTasks(rootPath);
          }
        }
      }
      if (msg.action === "create_jira") {
        const config = getJiraConfig();
        if (config) {
          const baseUrl = config.baseUrl.replace(/\/$/, "");
          const url = `${baseUrl}/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent("[HITL] Token/LLM limit exceeded")}`;
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
    }
    if (msg.type === "failRailHitlAction") {
      const { railId, action } = msg as { railId: string; action: "create_jira" | "abandon" };
      if (action === "abandon") {
        failRail(rootPath, railId, "User abandoned rail after HITL escalation");
        persistAndNotifyTasks(rootPath);
      }
      if (action === "create_jira") {
        const config = getJiraConfig();
        const rail = getRail(rootPath, railId);
        if (!config || !rail) {
          vscode.window.showErrorMessage(
            !config
              ? "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN and reload."
              : `Rail not found for Jira escalation: ${railId}`
          );
        } else {
          const baseUrl = config.baseUrl.replace(/\/$/, "");
          const summary = `[RAIL FAILED] ${rail.outcome ?? railId}`;
          const url = `${baseUrl}/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(
            summary
          )}`;
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
    }
    if (msg.type === "playwrightHitlAction") {
      const { railId, action } = msg;
      if (action === "suspend") {
        transitionRail(rootPath, railId, "SUSPENDED");
        persistAndNotifyTasks(rootPath);
      }
      if (action === "retry" && pendingPlan && pendingPlanRailId === railId) {
        const session = loadSession(rootPath);
        if (session) {
          const curIndex = session.currentTaskIndex ?? 0;
          const taskId = pendingPlan.tasks[curIndex]?.id;
          const railTaskId = taskId ? planTaskToRailTask[taskId] : null;
          if (railTaskId) updateTaskStatus(railTaskId, "executing");
          updateRailState(rootPath, railId, "SELF_CORRECTING");
          const railForRetryCtx = getRail(rootPath, railId);
          const railTaskForRetry = railTaskId ? getTask(railTaskId) : null;
          const stepRetry = railForRetryCtx?.logicPath?.[railTaskForRetry?.logicStep ?? 0];
          setTraceContext({
            railId,
            taskId: railTaskId ?? undefined,
            logicPathStep: stepRetry ? `${stepRetry.step}: ${stepRetry.layer} - ${stepRetry.filePath}` : undefined,
            filePath: stepRetry?.filePath,
          });
              const modSignals = getModuleSignalsForModule(graph, pendingPlan.tasks[curIndex]?.module ?? "");
              const fix = await runTaskAtIndex(pendingPlan, curIndex, rootPath, {
            apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
            conversationTurns: lastConversationTurns,
            errorOutput: "User chose Retry — re-running task.",
            rail: railForRetryCtx ?? undefined,
                railHistory: lastConversationTurns,
                moduleSignals: modSignals,
          });
          if (fix.hasStaging) {
            const staging = getStagingEntries();
            send({ type: "agentStagingEntries", entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })) });
          }
          clearTraceContext();
          updateRailState(rootPath, railId, "EXECUTING");
          persistAndNotifyTasks(rootPath);
        }
      }
      if (action === "create_jira") {
        const config = getJiraConfig();
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
      } else if (action === "investigate") {
        vscode.window.showWarningMessage("Trace file not found — cannot open Playwright trace viewer.");
      }
    }
    if (msg.type === "taskAction") {
      const { taskId, action } = msg;
      const task = getTask(taskId);
      if (!task) return;
      if (action === "approve" && task.status === "awaiting_hitl") {
        updateTaskStatus(taskId, "completed");
        const rail = getRail(rootPath, task.railId);
        const railTasks = getTasksByRail(task.railId);
        const nextPending = railTasks.find((t) => t.status === "pending");
        const stillAwaitingHitl = railTasks.find((t) => t.status === "awaiting_hitl" && t.id !== taskId);
        if (nextPending) {
          updateTaskStatus(nextPending.id, "executing");
          transitionRail(rootPath, task.railId, "EXECUTING");
        } else if (task.kind === "verification") {
          // Section 13: T6 verification approved → VERIFYING → MATERIALIZING → ARCHIVED
          const toVerifying = transitionRail(rootPath, task.railId, "VERIFYING");
          if (toVerifying.ok && toVerifying.rail) {
            const archived = completeMaterializeAndArchive(rootPath, task.railId);
            if (archived) {
              emitTrace({
                role: "manager",
                type: "info",
                message: "Rail archived after verification approval",
                railId: task.railId,
              });
            }
          }
        } else if (stillAwaitingHitl) {
          // Another HITL task still pending (e.g. T3 approved, T6 still awaiting)
          updateRailState(rootPath, task.railId, "AWAITING_HITL");
        } else {
          transitionRail(rootPath, task.railId, "VERIFYING");
        }
        persistAndNotifyTasks(rootPath);
      }
      if (action === "reject" && task.status === "awaiting_hitl") {
        updateTaskStatus(taskId, "rejected");
        persistAndNotifyTasks(rootPath);
      }
      if (action === "take_ownership" && task.status === "awaiting_hitl") {
        updateTaskEvidence(taskId, "human_take_over");
        updateTaskStatus(taskId, "completed");
        emitTrace({
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
        transitionRail(rootPath, railId, "SUSPENDED");
        persistAndNotifyTasks(rootPath);
      }
      if (action === "resume") {
        const rail = getRail(rootPath, railId);
        if (rail?.state === "SUSPENDED") {
          transitionRail(rootPath, railId, "EXECUTING");
          persistAndNotifyTasks(rootPath);
        }
      }
      if (action === "abandon") {
        failRail(rootPath, railId, "User abandoned rail");
        persistAndNotifyTasks(rootPath);
      }
      if (action === "acknowledge_drift") {
        updateRailPartial(rootPath, railId, { hallucinationAcknowledgedAt: Date.now() });
        persistAndNotifyTasks(rootPath);
      }
      if (action === "materialize") {
        const archived = completeMaterializeAndArchive(rootPath, railId);
        if (archived) {
          emitTrace({ role: "manager", type: "info", message: "Rail archived after materialize", railId });
        }
        persistAndNotifyTasks(rootPath);
      }
    }
    if (msg.type === "openPlaywrightScreenshot") {
      const absPath = path.isAbsolute(msg.path) ? msg.path : path.join(rootPath, msg.path);
      if (fs.existsSync(absPath)) {
        vscode.env.openExternal(vscode.Uri.file(absPath));
      } else {
        vscode.window.showWarningMessage(`Screenshot not found: ${absPath}`);
      }
    }
    if (msg.type === "agentJiraAddLabel") {
      const config = getJiraConfig();
      if (config) {
        addLabel(config, msg.key, msg.label).then((r) => {
          send({ type: "agentJiraAddLabelResult", key: msg.key, label: msg.label, success: r.success, error: r.error });
          if (!r.success) {
            vscode.window.showErrorMessage(`Jira add label failed: ${r.error}`);
          }
        });
      } else {
        send({ type: "agentJiraAddLabelResult", key: msg.key, label: msg.label, success: false, error: "Jira not configured" });
      }
    }
    if (msg.type === "agentJiraSyncAction") {
      const config = getJiraConfig();
      if (config) {
        const context =
          msg.action === "retag" && msg.newFingerprint && msg.newModule
            ? { newFingerprint: msg.newFingerprint, newModule: msg.newModule }
            : undefined;
        updateJira(config, msg.key, msg.action, context).catch((err) => {
          const m = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`Jira update failed: ${m}`);
        });
      }
    }
    if (msg.type === "createViolationJira") {
      const config = getJiraConfig();
      if (!config) {
        vscode.window.showErrorMessage(
          "Jira is not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN and reload."
        );
        return;
      }
      const v = msg.violation as any;
      const summary = `[${String(v.type ?? "VIOLATION").toUpperCase()}] ${String(
        v.description ?? "Architecture violation"
      )}`;
      const baseUrl = config.baseUrl.replace(/\/$/, "");
      const url = `${baseUrl}/secure/CreateIssueDetails!init.jspa?summary=${encodeURIComponent(
        summary
      )}`;

      // Create or update a canonical rail representing "violations → create ticket".
      try {
        const violationId = String(v.id ?? v.sourceNodeId ?? summary);
        const outcome = `Create Jira ticket for violation ${violationId}`;
        const rail = triggerFromViolation({
          rootPath,
          violationId,
          outcome,
          sessionId: "violations-create-ticket",
        });

        const now = Date.now();
        const violationTask: Task = {
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
        createTask(violationTask);

        const syncTask: Task = {
          id: `${rail.id}-create-ticket`,
          railId: rail.id,
          kind: "governance_sync",
          description: "Ensure violation is tracked in Jira (Create ticket flow).",
          files: [],
          autoCapable: false,
          status: "awaiting_hitl",
          agent: "reviewer",
          logicStep: 2,
          hitlPrompt:
            "Confirm that a Jira ticket was created for this violation and linked appropriately.",
          createdAt: now,
        };
        createTask(syncTask);

        persistAndNotifyTasks(rootPath);
      } catch {
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
        if (msg.createJira) args.push("--jira");
        const proc = spawnSync("npx", args, {
          cwd: projectRoot,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          env: { ...process.env },
        });
        const data = JSON.parse(proc.stdout?.trim() || "{}");
        send({ type: "validationResult", data });
      } catch (err) {
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

  watcher = new ProjectWatcher();
  watcher.on("change", async () => {
    cachedFindings = null;
    if (panel) {
      send({ type: "loading", message: "Rescanning..." });
      await buildAndSendGraph(rootPath);
    }
  });
  watcher.start(rootPath);
}

async function buildAndSendGraph(rootPath: string) {
  try {
    send({ type: "loading", message: "Scanning files..." });
    if (!cachedFindings) {
      cachedFindings = [
        ...scanContracts(rootPath),
        ...scanDocumentReferences(rootPath),
        ...scanEnvironmentGaps(rootPath),
      ];
    }
    const findings = cachedFindings;

    let g = await scanProject(rootPath, findings);
    send({ type: "loading", message: "Checking for drift..." });
    g = detectDrift(g);
    send({ type: "loading", message: getAgentActive() ? "Enriching graph..." : "Enriching graph (heuristic only, agent paused)..." });
    g = await enrichGraphV2(g, getAgentActive() ? getOpenAiApiKey() : undefined);
    g = analyseGraph(g);
    graph = g;
    send({ type: "graph", data: g });
    const violations = deriveViolationsFromGraph(g);
    if (violations.length > 0) {
      send({ type: "violations", violations } as any);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: "error", message });
  }
}

function send(msg: ExtToWebMessage) {
  panel?.webview.postMessage(msg);
}

async function checkJiraResolveAfterCommit(
  rootPath: string,
  committedPaths: string[],
  g: ArchGraph | undefined
) {
  const config = getJiraConfig();
  if (!config || !g) return;
  try {
    const project = process.env.JIRA_PROJECT?.trim();
    const jql = process.env.JIRA_JQL?.trim()
      || (project
        ? `project = ${project} AND resolution = Unresolved ORDER BY updated DESC`
        : "resolution = Unresolved ORDER BY updated DESC");
    const issues = await searchIssues(config, jql, 50, { includeDescription: true });
    const baseUrl = config.baseUrl.replace(/\/$/, "");
    const modules = new Set<string>();
    for (const p of committedPaths) {
      const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
      if (parts.length >= 2) modules.add(parts.slice(0, 2).join("/"));
      else if (parts.length === 1) modules.add(parts[0]);
    }
    const toResolve: Array<{ key: string; summary: string; module: string; baseUrl: string }> = [];
    for (const i of issues) {
      const { module: mod } = extractFingerprintFromDescription(i.description);
      if (mod && modules.has(mod)) {
        toResolve.push({ key: i.key, summary: i.summary, module: mod, baseUrl });
      }
    }
    if (toResolve.length > 0) {
      send({ type: "agentJiraResolvePrompt", issues: toResolve });
    }
  } catch {
    /* ignore */
  }
}

function runGateCheck(rootPath: string): GateCondition | null {
  const config = vscode.workspace.getConfiguration("archVisualizer");
  const staging = getStagingEntries();
  const hasStagingWrites = staging.length > 0;
  const session = loadSession(rootPath);
  const touchedPaths = getSessionTouchedPaths();

  let scopeViolation = false;
  let scopeViolationPath: string | undefined;
  if (hasStagingWrites && pendingPlan) {
    const allowedBases = pendingPlan.tasks.map((t) =>
      t.module.replace(/\\/g, "/").replace(/\/$/, "")
    );
    for (const e of staging) {
      const norm = e.path.replace(/\\/g, "/");
      const inScope = allowedBases.some(
        (base) => norm === base || norm.startsWith(base + "/")
      );
      if (!inScope) {
        scopeViolation = true;
        scopeViolationPath = e.path;
        break;
      }
    }
  }

  const retryCounts = session?.retryCounts ?? {};
  const retryCountTotal = Object.values(retryCounts).reduce(
    (sum, v) => sum + (typeof v === "number" ? v : 0),
    0
  );
  let railTokenUsage = 0;
  let railLlmCalls = 0;
  if (pendingPlanRailId) {
    const t = getRailTelemetry(pendingPlanRailId);
    railTokenUsage = t.tokenUsage;
    railLlmCalls = t.llmCallCount;
  }
  const retryLimitCode = (config.get("retryLimitCode") as number | undefined) ?? 3;
  const retryLimitArch = (config.get("retryLimitArch") as number | undefined) ?? 2;
  const baseLlmLimit = (config.get("retryLimitSession") as number | undefined) ?? 50;
  const baseTokenBudget = (config.get("tokenBudgetSession") as number | undefined) ?? 100_000;
  const llmLimit = baseLlmLimit + (session?.extendedLlmLimit ?? 0);
  const tokenBudget = baseTokenBudget + (session?.extendedTokenBudget ?? 0);

  // Stop-vs-continue prompts near limits (warning band at 80%).
  const tokenUsageNow = railTokenUsage || (session?.tokenUsage ?? 0);
  const llmCallsNow = railLlmCalls || (session?.llmCallCount ?? 0);
  if (pendingPlanRailId && tokenBudget > 0 && tokenUsageNow / tokenBudget >= 0.8) {
    updateRailPartial(rootPath, pendingPlanRailId, {
      lastCritique: {
        source: "reviewer",
        message: `Near token limit (${tokenUsageNow}/${tokenBudget}). Choose: Extend budget or Abort.`,
        createdAt: Date.now(),
      },
    } as any);
  }
  if (pendingPlanRailId && llmLimit > 0 && llmCallsNow / llmLimit >= 0.8) {
    updateRailPartial(rootPath, pendingPlanRailId, {
      lastCritique: {
        source: "reviewer",
        message: `Near LLM call limit (${llmCallsNow}/${llmLimit}). Choose: Extend limit or Abort.`,
        createdAt: Date.now(),
      },
    } as any);
  }

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
    llmCallCount: llmCallsNow,
    tokenUsage: tokenUsageNow,
    tokenBudget,
    costCapSession: config.get<number>("costCapSession") ?? 0,
    touchedPaths,
    hasStaleJiraMismatch: lastStaleJiraMismatches.length > 0,
    hasPartialPlanFailure: false,
    hasRuleProposal: false,
    hasJiraResolvePrompt: false,
  };
  const gate = checkGates(ctx);
  if (gate) {
    const reason = scopeViolation && scopeViolationPath
      ? `Scope violation: ${scopeViolationPath} not in plan`
      : `Gate: ${gate.gate}`;
    const rail = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
    const reasoningSummary = rail?.lastCritique?.message || "";
    emitTrace({
      role: "manager",
      type: "error",
      message: reasoningSummary ? `${reason}\n\n${reasoningSummary}` : reason,
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
      failRail(rootPath, pendingPlanRailId, reason);
      persistAndNotifyTasks(rootPath);
    }
  }
  return gate;
}

const GATE_NEXT_STEPS: Record<string, string> = {
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

async function runCheckGatesCommand(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders?.[0]) {
    vscode.window.showInformationMessage("Check Gates: Open a workspace folder first.");
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const config = vscode.workspace.getConfiguration("archVisualizer");
  const projectRoot = config.get<string>("projectRoot") ?? ".";
  const fixturePath = process.env.ARCH_FIXTURE_PATH;
  const rootPath = fixturePath
    ? path.resolve(workspaceRoot, fixturePath)
    : path.join(workspaceRoot, projectRoot);
  const gate = runGateCheck(rootPath);
  if (gate) {
    const nextStep = GATE_NEXT_STEPS[gate.gate] ?? "Open Architecture Map to proceed.";
    vscode.window.showInformationMessage(
      `Gate: ${gate.gate}. Next step: ${nextStep}`,
      "Open Architecture Map"
    ).then((choice) => {
      if (choice === "Open Architecture Map") {
        vscode.commands.executeCommand("arch-visualizer.open");
      }
    });
  } else {
    vscode.window.showInformationMessage("Check Gates: No gate fired. Agent can proceed.");
  }
}

let pendingPlan: AgentPlan | null = null;
let pendingPlanRailId: string | null = null;

function getModuleSignalsForModule(g: ArchGraph | undefined, modulePath: string) {
  if (!g) return undefined;
  const all = computeModuleSignals(g);
  const norm = modulePath.replace(/\\/g, "/").replace(/\/+$/, "");
  return (
    all.find((ms) =>
      (ms.filePaths ?? []).some((p) => {
        const fp = p.replace(/\\/g, "/");
        return fp === norm || fp.startsWith(norm + "/");
      })
    ) ?? all.find((ms) => ms.moduleId === norm)
  );
}
function buildRealignPlanFromTouched(goal: string, touchedPaths: string[]): AgentPlan {
  const modules = Array.from(
    new Set(
      touchedPaths
        .map((p) => p.replace(/\\/g, "/"))
        .filter(Boolean)
        .map((p) => {
          const parts = p.split("/").filter(Boolean);
          if (parts.length >= 2) return parts.slice(0, 2).join("/");
          return parts[0] ?? p;
        })
    )
  ).slice(0, 6);
  const tasks = modules.map((m, i) => ({
    id: `T${i + 1}`,
    module: m,
    layer: "Business Logic" as any,
    action: "modify" as const,
    expectedOutput: `${goal} — realign step ${i + 1} (${m})`,
    successChecks: [{ kind: "staging_write", required: true } as const],
  }));
  const dependencies: [string, string][] = [];
  for (let i = 0; i < tasks.length - 1; i++) dependencies.push([tasks[i].id, tasks[i + 1].id]);
  return { goal: `${goal} (realigned)`, tasks, dependencies };
}

function computeFilesHash(root: string, relPaths: string[]): string {
  const h = crypto.createHash("sha256");
  const sorted = [...relPaths].map((p) => p.replace(/\\/g, "/")).sort();
  for (const p of sorted) {
    h.update(p);
    h.update("\n");
    try {
      const full = path.join(root, p);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        h.update(fs.readFileSync(full));
      }
    } catch {
      // ignore
    }
    h.update("\n");
  }
  return h.digest("hex").slice(0, 16);
}

type ArchitectureProposal = {
  summary: string;
  nodes: Array<{
    id: string;
    label: string;
    layer: string;
    description: string;
    files: Array<{
      name: string;
      purpose: string;
      todos: string[];
    }>;
    connectsTo: string[];
  }>;
  reuses: string[];
  rationale: string;
};

function convertDesignToPlan(proposal: ArchitectureProposal): AgentPlan {
  const tasks = proposal.nodes.map((node, i) => ({
    id: `T${i + 1}`,
    module: node.id,
    layer: node.layer as any,
    action: "create" as const,
    expectedOutput: node.description || proposal.summary || `Implement ${node.label}`,
    successChecks: [{ kind: "staging_write", required: true }] as any,
    proposedFiles: (node.files ?? []).map((f) => ({
      name: f.name,
      purpose: f.purpose,
      todos: f.todos ?? [],
    })),
  }));

  const dependencies: [string, string][] = [];
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
function createMockPlan(goal: string): string {
  const modules = graph?.nodes.slice(0, 3).map((n) => n.path) ?? ["src/auth", "src/services"];
  const m1 = modules[0] ?? "src/auth";
  const m2 = modules[1] ?? "src/services";
  const plan = {
    goal,
    tasks: [
      { id: "T1", module: m1, layer: "Business Logic", action: "create", expectedOutput: `${goal} — step 1`, successChecks: [{ kind: "staging_write", required: true }] },
      { id: "T2", module: m2, layer: "Business Logic", action: "modify", expectedOutput: `${goal} — step 2`, successChecks: [{ kind: "staging_write", required: true }] },
    ],
    dependencies: [["T1", "T2"]] as [string, string][],
  };
  return JSON.stringify(plan);
}

/** Section 10.3: Infer archetype from goal and available templates. */
function inferArchetypeForGoal(rootPath: string, goal: string): string | undefined {
  const available = listTemplateArchetypes(rootPath);
  if (available.length === 0) return undefined;
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
function buildPlanFromLogicPath(
  goal: string,
  logicPath: Array<{ step: number; layer: string; nodeId: string; filePath: string }>
): string {
  const tasks = logicPath.map((s, i) => ({
    id: `T${i + 1}`,
    module: s.filePath || `src/step-${i + 1}`,
    layer: s.layer || "Business Logic",
    action: i === 0 ? "create" : "modify",
    expectedOutput: `${goal} — step ${s.step}`,
    successChecks: [{ kind: "staging_write", required: true }],
  }));
  const dependencies: [string, string][] = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    dependencies.push([tasks[i].id, tasks[i + 1].id]);
  }
  return JSON.stringify({ goal, tasks, dependencies });
}

/** Section 10.3: Build AgentPlan JSON from template (logicPath + tasks). */
function buildPlanFromTemplate(
  goal: string,
  tmpl: { outcome: string; logicPath: Array<{ filePath?: string; step?: number }>; tasks: Array<{ description: string }> }
): string {
  const modules = graph?.nodes.slice(0, 6).map((n) => n.path) ?? [];
  const tasks = tmpl.tasks.map((t, i) => {
    const module = tmpl.logicPath[i]?.filePath ?? modules[i] ?? `src/step-${i + 1}`;
    return {
      id: `T${i + 1}`,
      module,
      layer: "Business Logic" as const,
      action: i === 0 ? "create" : "modify",
      expectedOutput: t.description || `${goal} — step ${i + 1}`,
      successChecks: [{ kind: "staging_write", required: true }],
    };
  });
  const dependencies: [string, string][] = [];
  for (let i = 0; i < tasks.length - 1; i++) {
    dependencies.push([tasks[i].id, tasks[i + 1].id]);
  }
  const plan = { goal, tasks, dependencies };
  return JSON.stringify(plan);
}

function handleRequestPlan(rootPath: string, goal: string) {
  if (!getAgentActive()) {
    send({ type: "agentPlanValidationError", error: "[Agent paused] Enable the agent toggle to generate plans." } as any);
    return;
  }
  const archetype = inferArchetypeForGoal(rootPath, goal);
  const plannerContext = loadPlannerContext(rootPath, archetype);
  let raw: string;
  let templateUsed = false;
    if (archetype) {
    const tmpl = loadTemplateForArchetype(rootPath, archetype);
    if (tmpl && tmpl.tasks.length > 0) {
      raw = buildPlanFromTemplate(goal, tmpl);
      templateUsed = true;
    } else if (graph && (archetype === "ui-api-external" || archetype === "ui-api-persistence" || archetype === "governance-violation")) {
      const logicPath = inferLogicPath(goal, graph, archetype as any);
      if (logicPath.length > 0) {
        raw = buildPlanFromLogicPath(goal, logicPath);
        templateUsed = true;
      } else {
        raw = createMockPlan(goal);
      }
    } else {
      raw = createMockPlan(goal);
    }
  } else {
    raw = createMockPlan(goal);
  }
    const result = validatePlan(raw, rootPath);
    if (result.valid && result.plan) {
    pendingPlan = result.plan;
    const warnings = archetype ? getAntiPatternWarnings(rootPath, archetype) : [];
    try {
      const rail = triggerFromChat({
        rootPath,
        userMessage: goal,
        sessionId: "agent-plan",
        archetype,
      });
      pendingPlanRailId = rail.id;
      if (templateUsed && archetype) {
        const tmpl = loadTemplateForArchetype(rootPath, archetype);
        if (tmpl?.logicPath?.length) {
          updateRailPartial(rootPath, rail.id, { logicPath: tmpl.logicPath });
        } else if (graph && (archetype === "ui-api-external" || archetype === "ui-api-persistence" || archetype === "governance-violation")) {
          const lp = inferLogicPath(goal, graph, archetype as any);
          if (lp.length > 0) updateRailPartial(rootPath, rail.id, { logicPath: lp });
        }
      }
      const intentSummary = `${result.plan.goal} — ${rail.outcome}`;
      updateRailPartial(rootPath, rail.id, { intentSummary } as any);
      updateRailState(rootPath, rail.id, "AWAITING_APPROVAL");
      for (let i = 0; i < result.plan.tasks.length; i++) {
        const t = result.plan.tasks[i];
        const task: Task = {
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
        createTask(task);
        planTaskToRailTask[t.id] = task.id;
      }
    } catch {
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
  } else {
    send({ type: "agentPlanValidationError", error: result.error ?? "Validation failed" });
  }
}

async function handleAgentPlanAction(
  action: "approve" | "reject",
  _editFeedback: string | undefined,
  rootPath: string
) {
  if (action === "approve") {
    initTraceLogger();
    clearSessionTouchedPaths();
    emitTrace({
      role: "manager",
      type: "info",
      message: "Plan approved → running first task",
      railId: pendingPlanRailId ?? undefined,
    });
      if (pendingPlan) {
      const session = createEmptySession(pendingPlan);
      session.activeGate = null;
      saveSession(rootPath, session);
      if (pendingPlanRailId && pendingPlan.tasks[0]) {
        const firstTaskId = planTaskToRailTask[pendingPlan.tasks[0].id];
        if (firstTaskId) {
          updateTaskStatus(firstTaskId, "executing");
        }
        void transitionRail(rootPath, pendingPlanRailId, "EXECUTING", {
          planApproved: true,
        });
      }
      const railForFirst = pendingPlanRailId ? getRail(rootPath, pendingPlanRailId) : null;
      const firstModule = pendingPlan.tasks[0]?.module ?? "";
      const firstSignals = getModuleSignalsForModule(graph, firstModule);
      const result = await runFirstTask(pendingPlan, rootPath, {
        apiKey: getAnthropicApiKey() ?? getOpenAiApiKey(),
        conversationTurns: lastConversationTurns,
        rail: railForFirst ?? undefined,
        railHistory: lastConversationTurns,
        moduleSignals: firstSignals,
      });
      if (result.hasStaging) {
        const staging = getStagingEntries();
        send({
          type: "agentStagingEntries",
          entries: staging.map((e) => ({ path: e.path, content: e.content, taskId: e.taskId })),
        });
      }
    }
  }
  if (action === "reject") {
    if (pendingPlanRailId) {
      recordCritiqueLoop(pendingPlanRailId);
      const result = transitionRail(rootPath, pendingPlanRailId, "SUSPENDED");
      if (result.ok) persistAndNotifyTasks(rootPath);
    }
  }
}

function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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

export function deactivate() {
  watcher?.stop();
}
