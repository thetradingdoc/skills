import { Router } from "express";
import { randomUUID } from "node:crypto";
import { runArchitectureTask } from "../../../src/ai/manager.js";
import type { ArchGraph, AgentMode, ContractFinding, CriticViolation } from "../../../src/types.js";
import { ArchError, toUserMessage, logArchError } from "../../../src/ai/errors.js";
import { requireUser } from "./middleware/requireUser.js";
import {
  consumeDesignMessageCredit,
  evaluateChatAccess,
  getEntitlement,
  resolveChatMode,
} from "./entitlements.js";
import { validateGraphCommandMiddleware } from "./middleware/validateGraphCommand.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { recordUsageEvent } from "./usage.js";
import { maybePruneWorkspaceMemories } from "./memoryHygiene.js";
import {
  getMemoriesForContext,
  getGraphEvolutionForContext,
  getSnapshotsForContext,
  getUserMemoriesForContext,
  getSystemModelForContext,
  buildMemoryContextBlock,
} from "./memoryRetrieval.js";
import {
  upsertViolations,
  recordScanSnapshot,
  buildGovernanceNotice,
} from "./violationStore.js";
import { ARCH_RULESET_VERSION } from "../../../src/ai/critic.js";
import {
  createTask,
  setTaskRunning,
  setTaskCompleted,
  setTaskFailed,
  isTaskCancelled,
} from "./tasks.js";
import { getUserJiraConfig, JiraDecryptError } from "./jiraConfig.js";
import { getWorkspaceProjectKey } from "./jira.js";
import { createJiraTicketForViolation } from "./jiraViolation.js";
import { saveDraft, type DraftNode, type DraftEdge } from "./greenfieldDraft.js";
import type { Rail, RailTrigger, Task as RailTask } from "../../../src/agent/types.js";
import { createRail } from "../../../src/agent/rail/manager.js";
import { createTask as createRailTask } from "../../../src/agent/rail/manager.js";
import { ensureProjectRoot } from "./cloneRepo.js";
import { runAutoRailsAndExecute } from "./todos.js";
import { addRailsToSession, getSessionRails, parseRailIntent } from "./chatSessionRails.js";
import { cancelRail, retryRail } from "./railActions.js";
import { getRecentFeedbackForUser } from "./feedback.js";
import { findPath } from "../../../src/analysis/pathSearch.js";
import { matchNodeByLabel } from "../../../src/ai/graphCommandMatcher.js";

const router = Router();

/** Parse path intent: "path from X to Y", "how does X connect to Y", etc. */
function parsePathIntent(q: string): { from: string; to: string } | null {
  const trimmed = q.trim();
  const patterns = [
    /path\s+from\s+(.+?)\s+to\s+(.+)/i,
    /path\s+(.+?)\s+to\s+(.+)/i,
    /trace\s+(?:path\s+)?from\s+(.+?)\s+to\s+(.+)/i,
    /how\s+does\s+(.+?)\s+connect\s+to\s+(.+)/i,
    /find\s+path\s+between\s+(.+?)\s+and\s+(.+)/i,
    /(.+?)\s+to\s+(.+?)\s+path/i,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) {
      const from = m[1].replace(/\?$/, "").trim();
      const to = m[2].replace(/\?$/, "").trim();
      if (from.length >= 2 && to.length >= 2) return { from, to };
    }
  }
  return null;
}

/** Returns created railId or null if no rail created. */
function maybeCreateAnalysisRail(params: {
  mode: AgentMode;
  rootPath: string | null;
  question: string;
  result: {
    answer?: string | null;
    criticScore?: number | null;
    criticReport?: string | null;
    violations?: CriticViolation[] | null;
    traceId?: string | null;
    proposal?: unknown;
  };
  userId: string | undefined;
  workspaceId?: string | null;
  repoUrl?: string | null;
}) {
  if (params.mode !== "analysis") return null;
  if (!params.rootPath) return null;
  const now = Date.now();
  const railId = `rail-analysis-${now}-${Math.random().toString(16).slice(2, 8)}`;
  const trigger: RailTrigger = {
    source: "chat",
    userMessage: params.question.slice(0, 500),
    sessionId: params.userId ?? "webapp",
  };
  const hasViolations = Array.isArray(params.result.violations) && params.result.violations.length > 0;

  const proposal = params.result.proposal as
    | {
        summary?: string;
        nodes?: Array<{
          id?: string;
          label?: string;
          layer?: string;
          description?: string;
          files?: Array<{
            name?: string;
            purpose?: string;
            todos?: string[];
          }>;
          connectsTo?: string[];
        }>;
        reuses?: string[];
        rationale?: string;
      }
    | undefined;

  const hasProposalNodes = !!proposal && Array.isArray(proposal.nodes) && proposal.nodes.length > 0;

  const logicPath = hasProposalNodes
    ? proposal!.nodes!.map((n, idx) => {
        const rawLayer = typeof n.layer === "string" ? n.layer.toLowerCase() : "";
        let layer: "UI" | "API" | "Service" | "Infrastructure" | "External" = "Service";
        if (rawLayer.includes("ui") || rawLayer.includes("frontend") || rawLayer.includes("view")) {
          layer = "UI";
        } else if (rawLayer.includes("api") || rawLayer.includes("controller")) {
          layer = "API";
        } else if (rawLayer.includes("infra") || rawLayer.includes("infrastructure") || rawLayer.includes("devops")) {
          layer = "Infrastructure";
        } else if (rawLayer.includes("external") || rawLayer.includes("integration")) {
          layer = "External";
        }
        const nodeId = typeof n.id === "string" && n.id.trim() ? n.id.trim() : `step-${idx + 1}`;
        const filePath = nodeId;
        return {
          step: idx + 1,
          layer,
          nodeId,
          filePath,
          action: n.description && n.description.trim() ? n.description.trim().slice(0, 120) : "analysis-step",
        };
      })
    : [];

  const rail: Rail = {
    id: railId,
    version: 1,
    outcome: hasProposalNodes
      ? (typeof proposal!.summary === "string" && proposal!.summary.trim()
          ? proposal!.summary.trim()
          : params.question.slice(0, 200))
      : params.question.slice(0, 200),
    trigger,
    workspaceId: params.workspaceId ?? null,
    repoUrl: params.repoUrl ?? null,
    archetype: "analysis-chat",
    logicPath,
    state: hasProposalNodes ? "PRE_PLANNING" : "ARCHIVED",
    activeAgent: null,
    tasks: [],
    jiraKeys: [],
    traceIds: params.result.traceId ? [params.result.traceId] : [],
    overlaps: [],
    createdAt: now,
    updatedAt: now,
    createdBy: "human",
    sessionId: params.userId ?? "webapp",
    originSummary: params.question.slice(0, 200).trim() || undefined,
    lastCritique: {
      source: "reviewer",
      message: params.result.criticReport ?? "",
      createdAt: now,
      criticScore: params.result.criticScore ?? undefined,
      violations: hasViolations
        ? params.result.violations!.map((v) => ({
            type: v.type,
            severity: v.severity,
            description: v.description,
          }))
        : undefined,
    },
  };
  try {
    const created = createRail(params.rootPath, rail) as { id: string };
  const taskId = `task-meta-${randomUUID()}`;
  const task: RailTask = {
    id: taskId,
    railId: created.id,
    kind: "meta",
    description: "Analysis chat answer recorded.",
    files: [],
    autoCapable: false,
    status: "completed",
    agent: "reviewer",
    logicStep: 0,
    createdAt: now,
    resolvedAt: now,
  };
  createRailTask(task);

  if (hasViolations) {
    const vTaskId = `task-verify-${randomUUID()}`;
    const vTask: RailTask = {
      id: vTaskId,
      railId: created.id,
      kind: "verification",
      description: "Critic reported violations for analysis answer.",
      files: [],
      autoCapable: false,
      status: "pending",
      agent: "reviewer",
      logicStep: 0,
      createdAt: now,
    };
    createRailTask(vTask);
  }

  if (hasProposalNodes) {
    const nodes = proposal!.nodes!;
    nodes.forEach((n, idx) => {
      const nodeId = typeof n.id === "string" && n.id.trim() ? n.id.trim() : `step-${idx + 1}`;
      const description =
        (typeof n.description === "string" && n.description.trim()
          ? n.description.trim()
          : `Implement ${n.label ?? nodeId}`) || "Implement planned change";
      const codeTask: RailTask = {
        id: `task-code-${randomUUID()}`,
        railId: created.id,
        kind: "code_change",
        description,
        files: [],
        autoCapable: true,
        status: "pending",
        agent: "executor",
        logicStep: idx + 1,
        createdAt: now,
      };
      createRailTask(codeTask);
    });
  }
  return created.id;
  } catch (err) {
    console.error("[chat] maybeCreateAnalysisRail failed", {
      rootPath: params.rootPath,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
  return null;
}

router.post("/chat", requireUser, validateGraphCommandMiddleware, async (req, res) => {
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId, pdfBase64, pdfFileName, pendingViolations, provider } =
    req.body as {
      question?: string;
      graph?: ArchGraph;
      nodeId?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      workspaceId?: string | null;
      greenfieldSessionId?: string | null;
      threadId?: string | null;
      pdfBase64?: string | null;
      pdfFileName?: string | null;
      pendingViolations?: CriticViolation[];
      provider?: "anthropic" | "openai";
    };

  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question is required" });
    return;
  }

  if (question.length > 4000) {
    res.status(400).json({ error: "Question too long. Max 4000 characters." });
    return;
  }

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    res.status(400).json({
      error: "graph is required. Please scan a repository first so the architect has context.",
    });
    return;
  }

  if (history && Array.isArray(history) && history.length > 50) {
    res.status(400).json({ error: "History too long. Max 50 messages." });
    return;
  }

  if (pdfBase64 != null && (typeof pdfBase64 !== "string" || pdfBase64.length > 50_000_000)) {
    res.status(400).json({ error: "PDF too large. Max ~25MB." });
    return;
  }

  // V1 launch gate: free design (greenfield) vs Pro analysis agent
  if (req.user?.id) {
    const gateMode = resolveChatMode(req.body?.mode, graph);
    const ent = await getEntitlement(req.user.id);
    const access = evaluateChatAccess(ent, gateMode);
    if (!access.allowed) {
      res.status(access.status).json(access.body);
      return;
    }
    if (gateMode === "greenfield" && !ent.canUseAiAgent) {
      await consumeDesignMessageCredit(req.user.id);
    }
  }

  const railIntent = parseRailIntent(question);
  if (railIntent && workspaceId && req.user?.id) {
    const sessionRailsList = getSessionRails(threadId ?? undefined, workspaceId, req.user.id);
    const railId = sessionRailsList[railIntent.index];
    if (railId) {
      try {
        if (railIntent.action === "cancel") {
          const out = await cancelRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Cancelled rail ${railIntent.index + 1}.`,
              railAction: { action: "cancel", railId, index: railIntent.index + 1 },
              rails: [{ id: railId }],
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Cancel failed." });
          return;
        }
        if (railIntent.action === "retry") {
          const out = await retryRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Retrying rail ${railIntent.index + 1}. Execution started.`,
              railAction: { action: "retry", railId, taskId: out.taskId, index: railIntent.index + 1 },
              rails: [{ id: railId }],
              boardHint: { workspaceId },
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Retry failed." });
          return;
        }
      } catch {
        // fall through to normal chat
      }
    }
  }

  // Fix-or-Track: parse "Track" reply to create Jira tickets without LLM
  const trackMatch = /^\s*(track|create\s+jira|track\s+in\s+jira)\s*$/i.test(question.trim());
  if (trackMatch && Array.isArray(pendingViolations) && pendingViolations.length > 0) {
    try {
      const config = await getUserJiraConfig(req.user!.id);
      if (!config) {
        res.json({
          answer: "Jira is not connected. Use the Governance panel to connect your Jira account.",
          violations: pendingViolations,
        });
        return;
      }
      const projectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? config.project ?? null;
      if (!projectKey) {
        res.json({
          answer: "Set a project key in the sidebar to track violations in Jira.",
          violations: pendingViolations,
        });
        return;
      }
      const projectRoot = graph?.projectRoot ?? undefined;
      const projectName = graph?.projectName ?? undefined;
      const results: Array<{ key: string; url?: string; error?: string }> = [];
      for (const v of pendingViolations.slice(0, 10) as CriticViolation[]) {
        const srcNode = graph?.nodes?.find((n) => n.id === v.sourceNodeId || n.path === v.sourceNodeId);
        const archModulePath = srcNode?.path ?? v.sourceNodeId;
        const archModuleFiles = srcNode?.files;
        const r = await createJiraTicketForViolation({
          config,
          projectKey,
          violation: v,
          projectRoot,
          projectName,
          workspaceId: workspaceId ?? undefined,
          archModulePath,
          archModuleFiles,
        });
        if (r.error) {
          results.push({ key: "", error: r.error });
        } else {
          results.push({ key: r.key, url: r.url });
        }
      }
      const created = results.filter((x) => x.key);
      const failed = results.filter((x) => x.error);
      let answer = `Created ${created.length} Jira ticket(s) for violations.`;
      if (created.length > 0) {
        const keys = created.map((r) => `[${r.key}](${r.url ?? ""})`).join(", ");
        answer += `\n\n${keys}`;
      }
      if (failed.length > 0) {
        answer += `\n\n${failed.length} failed: ${failed.map((r) => r.error).join("; ")}`;
      }
      const updatedViolations = pendingViolations.map((v, i) => {
        const r = results[i];
        return r?.key ? { ...v, jiraKey: r.key, jiraStatus: "To Do" as const, trackedAt: Date.now() } : v;
      });
      res.json({ answer, violations: updatedViolations });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({
        answer: `Failed to create Jira tickets: ${msg}`,
        violations: pendingViolations,
      });
      return;
    }
  }

  const lowered = question.toLowerCase();
  const isExecutionIntent =
    lowered.includes("start implementing") ||
    lowered.includes("run the tasks") ||
    lowered.includes("go fix these") ||
    lowered.includes("apply the plan") ||
    lowered.includes("execute the rail");

  const looksLikeTodoLine = (line: string) =>
    /^(\d+\.\s+|-|\*)\s+.+/.test(line.trim());
  const lines = question.split(/\r?\n/);
  const todoLines = lines
    .filter(looksLikeTodoLine)
    .map((l) => l.replace(/^(\d+\.\s+|-|\*)\s+/, "").trim());
  const isTodoIntent =
    !!workspaceId &&
    todoLines.length > 0 &&
    (lowered.includes("todo list") ||
      lowered.includes("todos:") ||
      lowered.includes("backlog") ||
      lowered.includes("tasks:"));

  // Greenfield mode: empty graph allowed — agent designs from scratch
  // Backwards compatibility: if client sends mode, use it; else derive from graph
  const clientMode = req.body?.mode;
  const explicitMode =
    clientMode === "greenfield" || clientMode === "analysis"
      ? (clientMode as AgentMode)
      : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode: AgentMode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");

  let rootPath: string | null =
    mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== ""
      ? graph.projectRoot.trim()
      : null;

  let repoUrl: string | null = null;

  if (mode === "analysis" && workspaceId && supabaseAdmin) {
    const { data: gr } = await supabaseAdmin
      .from("graphs")
      .select("repo_url")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    repoUrl = (gr?.repo_url as string | null) ?? null;
    const { rootPath: resolved, error } = await ensureProjectRoot(
      workspaceId,
      graph,
      repoUrl
    );
    if (resolved !== null) rootPath = resolved;
    else if (error && rootPath === null) {
      res.status(400).json({ error });
      return;
    }
  }

  try {
    const findings: ContractFinding[] = []; // TODO: wire real findings if available

    const startMs = Date.now();

    let enrichedQuestion = question;
    if (supabaseAdmin && workspaceId) {
      const nodeIds: string[] = [];
      if (nodeId) nodeIds.push(nodeId);
      const notice = await buildGovernanceNotice(supabaseAdmin, workspaceId, nodeIds);
      if (notice) {
        enrichedQuestion = `${question}${notice}`;
      }
      const [memories, snapshots, userMemories, graphEvolution, systemModelSummary] = await Promise.all([
        getMemoriesForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        getSnapshotsForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        req.user?.id ? getUserMemoriesForContext(supabaseAdmin, req.user.id) : Promise.resolve([]),
        getGraphEvolutionForContext(supabaseAdmin, workspaceId),
        getSystemModelForContext(supabaseAdmin, workspaceId),
      ]);
      const memoryBlock = buildMemoryContextBlock(memories, snapshots, userMemories, graphEvolution, systemModelSummary);
      if (memoryBlock) {
        enrichedQuestion = `${memoryBlock}\n## Current question\n${question}`;
      }
    }

    let jiraConfig: { baseUrl: string; email: string; apiToken: string } | undefined;
    let jiraProjectKey: string | undefined;
    if (req.user?.id) {
      try {
        const userJira = await getUserJiraConfig(req.user.id);
        if (userJira) {
        jiraConfig = {
          baseUrl: userJira.baseUrl,
          email: userJira.email,
          apiToken: userJira.apiToken,
        };
        jiraProjectKey =
          (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ??
          userJira.project ??
          undefined;
        }
      } catch (e) {
        if (e instanceof JiraDecryptError) {
          res.status(400).json({ error: e.message, code: "jira_decrypt_failed" });
          return;
        }
        throw e;
      }
    }

    // Fast path: chat → todos (no full analysis run).
    if (isTodoIntent && workspaceId && supabaseAdmin && todoLines.length > 0) {
      try {
        const { data: ws } = await supabaseAdmin
          .from("workspaces")
          .select("id")
          .eq("id", workspaceId)
          .eq("owner_id", req.user!.id)
          .single();
        if (!ws) {
          res.status(403).json({ error: "Access denied for workspace." });
          return;
        }

        // Mirror /todos/from-chat logic to dedupe and insert todos.
        const { data: existing } = await supabaseAdmin
          .from("todos")
          .select("title")
          .eq("workspace_id", workspaceId)
          .in("title", todoLines);
        const existingTitles = new Set<string>((existing ?? []).map((r: any) => String(r.title)));

        const rows = todoLines
          .filter((title) => !existingTitles.has(title))
          .map((title) => ({
            workspace_id: workspaceId,
            title,
            description: null,
            phase: null,
            depends_on: null,
            status: "pending",
            source: "chat",
            source_path: null,
          }));

        if (rows.length === 0) {
          res.json({
            answer: "Todos already exist for each item in your list.",
            todos: [],
          });
          return;
        }

        const { data, error } = await supabaseAdmin
          .from("todos")
          .insert(rows)
          .select("*");

        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }

        res.json({
          answer: "Created todos from your list.",
          todos: data ?? [],
        });
        return;
      } catch {
        // fall through to normal chat if something goes wrong
      }
    }

    // Fast path: path search via chat (e.g. "path from auth to database")
    const pathMatch =
      /(?:path\s+from|path\s|trace\s+(?:path\s+)?from)\s+(.+?)\s+to\s+(.+)/i.exec(question) ||
      /how\s+does\s+(.+?)\s+connect\s+to\s+(.+)/i.exec(question) ||
      /find\s+path\s+between\s+(.+?)\s+and\s+(.+)/i.exec(question);
    if (pathMatch && graph && graph.nodes.length > 0) {
      const fromPart = pathMatch[1].trim();
      const toPart = pathMatch[2].trim();
      const sourceId = matchNodeByLabel(fromPart, graph);
      const targetId = matchNodeByLabel(toPart, graph);
      if (sourceId && targetId) {
        const nodeIds = findPath(graph, sourceId, targetId);
        res.json({
          answer: nodeIds.length > 0
            ? `Found path (${nodeIds.length} nodes): ${nodeIds.join(" → ")}.`
            : `No path found between "${fromPart}" and "${toPart}".`,
          graphCommands: nodeIds.length > 0
            ? [{ action: "trace_path" as const, nodeIds }]
            : [],
        });
        return;
      }
    }

    // Fast path: insights via chat (e.g. "show insights", "hotspots")
    const insightsMatch =
      /\b(insights|hotspots|show\s+insights|graph\s+insights)\b/i.test(question) ||
      /^insights$/i.test(question.trim());
    if (insightsMatch && graph) {
      res.json({
        answer: "Here are the graph insights. Use the insights panel to explore hotspots and dependencies.",
        showInsightsPanel: true,
      });
      return;
    }

    const useStream =
      req.body?.stream === true &&
      mode === "greenfield" &&
      !jiraConfig &&
      !jiraProjectKey;
    if (useStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
    }
    let feedbackContextSync: string | undefined;
    if (req.user?.id) {
      try {
        const { downvoteCount } = await getRecentFeedbackForUser(req.user.id);
        if (downvoteCount > 0) {
          feedbackContextSync =
            `Note: The user has downvoted ${downvoteCount} architecture answer(s) in the last 7 days. ` +
            "Prefer concise, actionable responses and avoid overly long explanations.";
        }
      } catch {
        // ignore
      }
    }
    const result = await runArchitectureTask({
      question: enrichedQuestion,
      graph,
      nodeId,
      history,
      mode,
      apiKeyOpenAI: process.env.OPENAI_API_KEY,
      apiKeyClaude: process.env.ANTHROPIC_API_KEY,
      provider,
      findings,
      rootPath,
      jiraConfig,
      jiraProjectKey: jiraProjectKey ?? undefined,
      feedbackContext: feedbackContextSync,
      ...(pdfBase64 && typeof pdfBase64 === "string"
        ? { pdfBase64, pdfFileName: typeof pdfFileName === "string" ? pdfFileName : "document.pdf" }
        : {}),
      ...(useStream
        ? {
            onTextChunk: (chunk: string) => {
              try {
                res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
              } catch {
                // Client may have disconnected
              }
            },
          }
        : {}),
    });
    const latencyMs = Date.now() - startMs;

    const analysisRailId = maybeCreateAnalysisRail({
      mode,
      rootPath,
      question,
      result: {
        answer: result.answer,
        criticScore: result.criticScore ?? null,
        criticReport: result.criticReport ?? null,
        violations: (result.violations ?? []) as CriticViolation[],
        traceId: result.traceId ?? null,
        proposal: result.proposal,
      },
      userId: req.user?.id,
      workspaceId: workspaceId ?? null,
      repoUrl,
    });

    const violations = (result.violations ?? []) as CriticViolation[];

    // Optional orchestration: auto-execute dependency-ready todos when user explicitly asks.
    let autoExecution:
      | {
          pickedTodoIds: string[];
          startedRails: string[];
        }
      | null = null;

    let railsFromExecution: Array<{ id: string }> | undefined;
    if (isExecutionIntent && workspaceId && req.user?.id) {
      try {
        const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user.id, 3);
        if (startedRails.length > 0) {
          railsFromExecution = startedRails;
          autoExecution = {
            pickedTodoIds: startedRails.map((r) => r.id),
            startedRails: startedRails.map((r) => r.id),
          };
          addRailsToSession(threadId ?? undefined, workspaceId, req.user.id, startedRails.map((r) => r.id));
        }
      } catch {
        // best-effort; chat should still return a normal answer
      }
    }
    if (analysisRailId) {
      addRailsToSession(threadId ?? undefined, workspaceId ?? undefined, req.user!.id, [analysisRailId]);
    }

    if (supabaseAdmin && workspaceId) {
      const client = supabaseAdmin;
      upsertViolations(client, {
        workspaceId,
        violations,
        rulesVersion: ARCH_RULESET_VERSION,
        markAbsent: false, // Chat returns question-scoped violations only; do not clear others.
      })
        .then(() =>
          recordScanSnapshot(client, workspaceId, ARCH_RULESET_VERSION)
        )
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[violationStore] upsert/scan failed:", err);
        });
    }

    if (supabaseAdmin) {
      (async () => {
        let langsmithUrl: string | null = null;
        if (process.env.LANGSMITH_API_KEY && process.env.LANGSMITH_API_KEY.trim()) {
          try {
            const { RunTree } = await import("langsmith");
            const run = new RunTree({
              name: "architecture_chat",
              run_type: "chain",
              inputs: {
                question,
                node_id: nodeId ?? null,
                workspace_id: workspaceId ?? null,
              },
              start_time: startMs,
              end_time: Date.now(),
              outputs: {
                answer: result.answer,
                criticScore: result.criticScore ?? null,
              },
              metadata: {
                traceId: result.traceId ?? null,
                mode,
                hasGraphCommand:
                  !!(result.graphCommands && result.graphCommands.length) ||
                  !!result.graphCommand,
              },
              tags: ["architecture-visualizer"],
            });
            await run.postRun();
            const maybeUrl = (run as any).url;
            langsmithUrl = typeof maybeUrl === "string" ? maybeUrl : null;
          } catch (err) {
            if (process.env.METRICS_LOG === "1") {
              console.warn(
                "[metrics] LangSmith logging failed:",
                err instanceof Error ? err.message : String(err)
              );
            }
          }
        }

        try {
          const tokenUsage = (result as { tokenUsage?: { agentInput?: number; agentOutput?: number } }).tokenUsage;
          await supabaseAdmin
            .from("model_traces")
            .insert({
              workspace_id: workspaceId ?? null,
              user_id: (req as { user?: { id?: string } }).user?.id ?? null,
              session_id: null,
              question,
              node_id: nodeId ?? null,
              agent_model: "claude-sonnet-4-6",
              critic_model: "gpt-4o-mini",
              agent_latency_ms: latencyMs,
              agent_prompt_tokens: tokenUsage?.agentInput ?? null,
              agent_completion_tokens: tokenUsage?.agentOutput ?? null,
              langsmith_url: langsmithUrl,
              agent_graph_commands:
                result.graphCommands && result.graphCommands.length > 0
                  ? result.graphCommands
                  : result.graphCommand
                    ? [result.graphCommand]
                    : null,
              agent_violations: Array.isArray(result.violations) ? result.violations : null,
              agent_answer: result.answer,
              critic_latency_ms: null,
              critic_prompt_tokens: null,
              critic_completion_tokens: null,
              critic_score:
                typeof result.criticScore === "number" ? String(result.criticScore) : null,
            })
            .throwOnError();
          if (workspaceId) {
            void recordUsageEvent(supabaseAdmin, {
              workspaceId,
              userId: (req as { user?: { id?: string } }).user?.id ?? null,
              nodeId: nodeId ?? null,
              source: "chat",
              model: "claude-sonnet-4-6",
              promptTokens: tokenUsage?.agentInput ?? 0,
              completionTokens: tokenUsage?.agentOutput ?? 0,
              metadata: { path: "chat-sync" },
            });
          }
        } catch (err) {
          if (process.env.METRICS_LOG === "1") {
            console.warn(
              "[metrics] Failed to insert model_traces:",
              err instanceof Error ? err.message : String(err)
            );
          }
        }
        // workspace_memories spec: insert when criticScore >= 7 and answer > 50 chars.
        // Stored: content = question + answer (truncated to 2k), memory_type = "arch_insight".
        // Query: GET /workspaces/:id/memories?nodeId= — returns by workspace, optionally filtered by node.
        if (
          workspaceId &&
          typeof result.criticScore === "number" &&
          result.criticScore >= 7 &&
          result.answer?.trim().length > 50
        ) {
          try {
            await supabaseAdmin!
              .from("workspace_memories")
              .insert({
                workspace_id: workspaceId,
                node_id: nodeId ?? null,
                content: `${question}\n\n${result.answer.slice(0, 2000)}`,
                memory_type: "arch_insight",
              })
              .throwOnError();
            if (supabaseAdmin) {
              setImmediate(() => {
                void maybePruneWorkspaceMemories(supabaseAdmin as any, workspaceId).catch(() => {});
              });
            }
          } catch {
            if (process.env.METRICS_LOG === "1") {
              console.warn("[metrics] workspace_memories insert skipped");
            }
          }
        }
        if (workspaceId && result.answer?.trim()) {
          try {
            await supabaseAdmin.from("conversation_snapshots").insert({
              workspace_id: workspaceId,
              node_id: nodeId ?? null,
              intent_summary: question.slice(0, 500),
              outcome_summary: result.answer.slice(0, 500),
            });
          } catch {
            if (process.env.METRICS_LOG === "1") {
              console.warn("[chat] conversation_snapshots insert skipped");
            }
          }
        }
        try {
          await supabaseAdmin
            .from("agent_traces")
            .insert({
              workspace_id: workspaceId ?? null,
              node_id: nodeId ?? null,
              trace_id: result.traceId ?? null,
              run_type: "chat",
              payload: {
                question: question.slice(0, 500),
                answer_preview: result.answer?.slice(0, 200) ?? null,
              },
            })
            .throwOnError();
        } catch {
          if (process.env.METRICS_LOG === "1") {
            console.warn("[metrics] agent_traces insert skipped (table/schema may differ)");
          }
        }
      })();
    }

    if (
      mode === "greenfield" &&
      greenfieldSessionId &&
      typeof greenfieldSessionId === "string" &&
      (result.graphCommands?.length || result.graphCommand)
    ) {
      const cmds = result.graphCommands ?? (result.graphCommand ? [result.graphCommand] : []);
      const nodes: DraftNode[] = [];
      const edges: DraftEdge[] = [];
      for (const cmd of cmds) {
        if (cmd.action === "create_node" && "id" in cmd) {
          nodes.push({
            id: cmd.id,
            label: cmd.label ?? cmd.id,
            layer: "layer" in cmd ? cmd.layer : undefined,
            description: "description" in cmd ? cmd.description : undefined,
            archNodeId: "archNodeId" in cmd ? cmd.archNodeId : undefined,
            skeletonCode: "skeletonCode" in cmd && typeof cmd.skeletonCode === "string" ? cmd.skeletonCode : undefined,
            layoutHint: "layoutHint" in cmd && typeof cmd.layoutHint === "string" ? cmd.layoutHint : undefined,
            group: "group" in cmd && typeof cmd.group === "string" ? cmd.group : undefined,
          });
        }
        if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
          edges.push({
            source: cmd.fromId,
            target: cmd.toId,
            relation: "relation" in cmd ? cmd.relation : undefined,
          });
        }
      }
      if (nodes.length > 0 || edges.length > 0) {
        try {
          saveDraft(greenfieldSessionId, { nodes, edges, workspaceId: workspaceId ?? undefined });
          if (
            supabaseAdmin &&
            workspaceId &&
            (result.criticScore ?? 0) >= 6 &&
            (result.answer?.length ?? 0) > 30
          ) {
            const designSummary = `Greenfield design: ${nodes.length} nodes (${nodes.map((n) => n.label || n.id).join(", ")}), ${edges.length} edges. ${(result.answer ?? "").slice(0, 300).replace(/\n/g, " ")}`;
            supabaseAdmin
              .from("workspace_memories")
              .insert({
                workspace_id: workspaceId,
                content: designSummary,
                memory_type: "greenfield_design",
                node_id: null,
              })
              .then(undefined, (e: unknown) =>
                console.warn("[chat] greenfield memory insert:", e instanceof Error ? e.message : e)
              );
          }
        } catch {
          // Non-fatal
        }
      }
    }

    if (supabaseAdmin && workspaceId && threadId && typeof threadId === "string") {
      const toAppend: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: question },
        { role: "assistant", content: (result.answer ?? "").slice(0, 10000) },
      ];
      if (result.criticReport?.trim()) {
        toAppend.push({ role: "assistant", content: `Critic: ${result.criticReport}`.slice(0, 10000) });
      }
      const autoTitle = question.slice(0, 60).trim();
      supabaseAdmin
        .from("chat_messages")
        .insert(
          toAppend.map((m) => ({
            thread_id: threadId,
            role: m.role,
            content: m.content,
          }))
        )
        .then(async () => {
          if (!supabaseAdmin) return;
          const update: Record<string, string> = { updated_at: new Date().toISOString() };
          const { data: thread } = await supabaseAdmin
            .from("chat_threads")
            .select("title")
            .eq("id", threadId)
            .eq("workspace_id", workspaceId)
            .single();
          if (thread?.title === "New chat" && autoTitle) {
            (update as Record<string, string>).title = autoTitle.slice(0, 200);
          }
          await supabaseAdmin
            .from("chat_threads")
            .update(update)
            .eq("id", threadId)
            .eq("workspace_id", workspaceId);
        })
        .then(undefined, (e: unknown) => console.warn("[chat] thread persist:", e instanceof Error ? e.message : e));
    }

    if (useStream) {
      try {
        res.write(
          `data: ${JSON.stringify({
            type: "done",
            answer: result.answer,
            graphCommands: result.graphCommands,
            graphCommand: result.graphCommand,
            criticReport: result.criticReport,
            criticScore: result.criticScore,
          })}\n\n`
        );
        res.end();
      } catch {
        res.end();
      }
      return;
    }

    const tokenUsage = (result as { tokenUsage?: { agentInput?: number; agentOutput?: number } }).tokenUsage;
    if (tokenUsage && (process.env.METRICS_LOG === "1" || process.env.TOKEN_LOG === "1")) {
      const in_ = tokenUsage.agentInput ?? 0;
      const out_ = tokenUsage.agentOutput ?? 0;
      console.log(`[chat] tokens in=${in_} out=${out_} total=${in_ + out_}`);
    }
    const allRails = [
      ...(analysisRailId ? [{ id: analysisRailId }] : []),
      ...(railsFromExecution ?? []),
      ...(Array.isArray((result as any).rails) ? (result as any).rails : []),
    ];
    const railsDeduped = Array.from(new Map(allRails.map((r) => [r.id, r])).values());
    const boardHint = workspaceId && railsDeduped.length > 0 ? { workspaceId } : undefined;

    res.json({
      answer: result.answer,
      graphCommands: result.graphCommands,
      graphCommand: result.graphCommand,
      criticReport: result.criticReport,
      criticScore: result.criticScore,
      acceptanceCriteria: result.acceptanceCriteria,
      archetype: result.archetype,
      violations: (result.violations ?? []) as CriticViolation[],
      relevantNodeIds: result.relevantNodeIds ?? undefined,
      ...(tokenUsage
        ? {
            tokenUsage: {
              input: tokenUsage.agentInput ?? 0,
              output: tokenUsage.agentOutput ?? 0,
              total: (tokenUsage.agentInput ?? 0) + (tokenUsage.agentOutput ?? 0),
              /** 180K is the safe limit; warn when >80%. */
              warningThreshold: 144_000,
            },
          }
        : {}),
      rails: railsDeduped.length > 0 ? railsDeduped : undefined,
      railIds: railsDeduped.map((r) => r.id),
      boardHint,
      autoExecution: autoExecution ?? undefined,
    });
  } catch (err) {
    const traceId = err instanceof ArchError ? err.traceId : undefined;
    logArchError(err, traceId, "chat");
    const userMessage = toUserMessage(err, traceId);
    res.status(500).json({ error: userMessage, ...(traceId && { traceId }) });
  }
});

/** Async chat — returns 202 with taskId, client polls GET /api/tasks/:taskId */
router.post("/chat-async", requireUser, validateGraphCommandMiddleware, async (req, res) => {
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId, pdfBase64, pdfFileName, pendingViolations, provider } =
    req.body as {
      question?: string;
      provider?: "anthropic" | "openai";
      graph?: ArchGraph;
      nodeId?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      workspaceId?: string | null;
      greenfieldSessionId?: string | null;
      threadId?: string | null;
      pdfBase64?: string | null;
      pdfFileName?: string | null;
      pendingViolations?: CriticViolation[];
    };

  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "question is required" });
    return;
  }

  if (question.length > 4000) {
    res.status(400).json({ error: "Question too long. Max 4000 characters." });
    return;
  }

  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    res.status(400).json({
      error: "graph is required. Please scan a repository first so the architect has context.",
    });
    return;
  }

  if (history && Array.isArray(history) && history.length > 50) {
    res.status(400).json({ error: "History too long. Max 50 messages." });
    return;
  }

  if (pdfBase64 != null && (typeof pdfBase64 !== "string" || pdfBase64.length > 50_000_000)) {
    res.status(400).json({ error: "PDF too large. Max ~25MB." });
    return;
  }

  // V1 launch gate: free design (greenfield) vs Pro analysis agent
  if (req.user?.id) {
    const gateMode = resolveChatMode(req.body?.mode, graph);
    const ent = await getEntitlement(req.user.id);
    const access = evaluateChatAccess(ent, gateMode);
    if (!access.allowed) {
      res.status(access.status).json(access.body);
      return;
    }
    if (gateMode === "greenfield" && !ent.canUseAiAgent) {
      await consumeDesignMessageCredit(req.user.id);
    }
  }

  const railIntent = parseRailIntent(question);
  if (railIntent && workspaceId && req.user?.id) {
    const sessionRailsList = getSessionRails(threadId ?? undefined, workspaceId, req.user.id);
    const railId = sessionRailsList[railIntent.index];
    if (railId) {
      try {
        if (railIntent.action === "cancel") {
          const out = await cancelRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Cancelled rail ${railIntent.index + 1}.`,
              railAction: { action: "cancel", railId, index: railIntent.index + 1 },
              rails: [{ id: railId }],
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Cancel failed." });
          return;
        }
        if (railIntent.action === "retry") {
          const out = await retryRail(railId, workspaceId, req.user.id);
          if (out.ok) {
            res.json({
              answer: `Retrying rail ${railIntent.index + 1}. Execution started.`,
              railAction: { action: "retry", railId, taskId: out.taskId, index: railIntent.index + 1 },
              rails: [{ id: railId }],
              boardHint: { workspaceId },
            });
            return;
          }
          res.status(400).json({ error: out.error ?? "Retry failed." });
          return;
        }
      } catch {
        // fall through to normal chat
      }
    }
  }

  // Fix-or-Track: parse "Track" reply to create Jira tickets (sync response, no task)
  const trackMatch = /^\s*(track|create\s+jira|track\s+in\s+jira)\s*$/i.test(question.trim());
  if (trackMatch && Array.isArray(pendingViolations) && pendingViolations.length > 0) {
    try {
      const config = await getUserJiraConfig(req.user!.id);
      if (!config) {
        res.json({
          answer: "Jira is not connected. Use the Governance panel to connect your Jira account.",
          violations: pendingViolations,
        });
        return;
      }
      const projectKey = (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ?? config.project ?? null;
      if (!projectKey) {
        res.json({
          answer: "Set a project key in the sidebar to track violations in Jira.",
          violations: pendingViolations,
        });
        return;
      }
      const projectRoot = graph?.projectRoot ?? undefined;
      const projectName = graph?.projectName ?? undefined;
      const results: Array<{ key: string; url?: string; error?: string }> = [];
      for (const v of pendingViolations.slice(0, 10)) {
        const srcNode = graph?.nodes?.find((n) => n.id === v.sourceNodeId || n.path === v.sourceNodeId);
        const archModulePath = srcNode?.path ?? v.sourceNodeId;
        const archModuleFiles = srcNode?.files;
        const r = await createJiraTicketForViolation({
          config,
          projectKey,
          violation: v,
          projectRoot,
          projectName,
          workspaceId: workspaceId ?? undefined,
          archModulePath,
          archModuleFiles,
        });
        if (r.error) {
          results.push({ key: "", error: r.error });
        } else {
          results.push({ key: r.key, url: r.url });
        }
      }
      const created = results.filter((x) => x.key);
      const failed = results.filter((x) => x.error);
      let answer = `Created ${created.length} Jira ticket(s) for violations.`;
      if (created.length > 0) {
        const keys = created.map((r) => `[${r.key}](${r.url ?? ""})`).join(", ");
        answer += `\n\n${keys}`;
      }
      if (failed.length > 0) {
        answer += `\n\n${failed.length} failed: ${failed.map((r) => r.error).join("; ")}`;
      }
      const updatedViolations = pendingViolations.map((v, i) => {
        const r = results[i];
        return r?.key ? { ...v, jiraKey: r.key, jiraStatus: "To Do" as const, trackedAt: Date.now() } : v;
      });
      res.json({ answer, violations: updatedViolations });
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.json({
        answer: `Failed to create Jira tickets: ${msg}`,
        violations: pendingViolations,
      });
      return;
    }
  }

  const lowered = question.toLowerCase();
  const isExecutionIntent =
    lowered.includes("start implementing") ||
    lowered.includes("run the tasks") ||
    lowered.includes("go fix these") ||
    lowered.includes("apply the plan") ||
    lowered.includes("execute the rail");

  const clientMode = req.body?.mode;
  const explicitMode =
    clientMode === "greenfield" || clientMode === "analysis"
      ? (clientMode as AgentMode)
      : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode: AgentMode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");

  const task = createTask();
  res.status(202).json({ taskId: task.taskId, status: "pending" });

  setTaskRunning(task.taskId);
  const findings: ContractFinding[] = [];

  let jiraConfig: { baseUrl: string; email: string; apiToken: string } | undefined;
  let jiraProjectKey: string | undefined;
  if (req.user?.id) {
    try {
      const userJira = await getUserJiraConfig(req.user.id);
      if (userJira) {
        jiraConfig = {
          baseUrl: userJira.baseUrl,
          email: userJira.email,
          apiToken: userJira.apiToken,
        };
        jiraProjectKey =
          (workspaceId ? await getWorkspaceProjectKey(workspaceId) : null) ??
          userJira.project ??
          undefined;
      }
    } catch (e) {
      if (e instanceof JiraDecryptError) {
        setTaskFailed(task.taskId, e.message);
        return;
      }
      throw e;
    }
  }

  (async () => {
    let rootPath: string | null =
      mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== ""
        ? graph.projectRoot.trim()
        : null;

    let repoUrl: string | null = null;

    if (mode === "analysis" && workspaceId && supabaseAdmin) {
      const { data: gr } = await supabaseAdmin
        .from("graphs")
        .select("repo_url")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      repoUrl = (gr?.repo_url as string | null) ?? null;
      const { rootPath: resolved, error } = await ensureProjectRoot(
        workspaceId,
        graph,
        repoUrl
      );
      if (resolved !== null) rootPath = resolved;
      else if (error && rootPath === null) {
        setTaskFailed(task.taskId, error);
        return;
      }
    }

  let feedbackContext: string | undefined;
  if (req.user?.id) {
    try {
      const { downvoteCount } = await getRecentFeedbackForUser(req.user.id);
      if (downvoteCount > 0) {
        feedbackContext =
          `Note: The user has downvoted ${downvoteCount} architecture answer(s) in the last 7 days. ` +
          "Prefer concise, actionable responses and avoid overly long explanations.";
      }
    } catch {
      // ignore
    }
  }

  const sessionIdForDraft = greenfieldSessionId;
  runArchitectureTask({
    question,
    graph,
    nodeId,
    history,
    mode,
    apiKeyOpenAI: process.env.OPENAI_API_KEY,
    apiKeyClaude: process.env.ANTHROPIC_API_KEY,
    provider,
    findings,
    rootPath,
    jiraConfig,
    jiraProjectKey: jiraProjectKey ?? undefined,
    feedbackContext,
    ...(pdfBase64 && typeof pdfBase64 === "string"
      ? { pdfBase64, pdfFileName: typeof pdfFileName === "string" ? pdfFileName : "document.pdf" }
      : {}),
  })
    .then(async (result) => {
      if (isTaskCancelled(task.taskId)) return;
      if (
        mode === "greenfield" &&
        sessionIdForDraft &&
        typeof sessionIdForDraft === "string" &&
        (result.graphCommands?.length || result.graphCommand)
      ) {
        const cmds = result.graphCommands ?? (result.graphCommand ? [result.graphCommand] : []);
      const nodes: DraftNode[] = [];
      const edges: DraftEdge[] = [];
      for (const cmd of cmds) {
        if (cmd.action === "create_node" && "id" in cmd) {
          nodes.push({
            id: cmd.id,
            label: cmd.label ?? cmd.id,
            layer: "layer" in cmd ? cmd.layer : undefined,
            description: "description" in cmd ? cmd.description : undefined,
            archNodeId: "archNodeId" in cmd ? cmd.archNodeId : undefined,
            skeletonCode: "skeletonCode" in cmd && typeof cmd.skeletonCode === "string" ? cmd.skeletonCode : undefined,
            layoutHint: "layoutHint" in cmd && typeof cmd.layoutHint === "string" ? cmd.layoutHint : undefined,
            group: "group" in cmd && typeof cmd.group === "string" ? cmd.group : undefined,
          });
          }
          if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
            edges.push({
              source: cmd.fromId,
              target: cmd.toId,
              relation: "relation" in cmd ? cmd.relation : undefined,
            });
          }
        }
        if (nodes.length > 0 || edges.length > 0) {
          try {
            saveDraft(sessionIdForDraft, { nodes, edges, workspaceId: workspaceId ?? undefined });
            if (
              supabaseAdmin &&
              workspaceId &&
              (result.criticScore ?? 0) >= 6 &&
              (result.answer?.length ?? 0) > 30
            ) {
              const designSummary = `Greenfield design: ${nodes.length} nodes (${nodes.map((n) => n.label || n.id).join(", ")}), ${edges.length} edges. ${(result.answer ?? "").slice(0, 300).replace(/\n/g, " ")}`;
              supabaseAdmin
                .from("workspace_memories")
                .insert({
                  workspace_id: workspaceId,
                  content: designSummary,
                  memory_type: "greenfield_design",
                  node_id: null,
                })
                .then(undefined, (e: unknown) =>
                  console.warn("[chat-async] greenfield memory insert:", e instanceof Error ? e.message : e)
                );
            }
          } catch {
            // Non-fatal
          }
        }
      }
      const tu = (result as { tokenUsage?: { agentInput?: number; agentOutput?: number } }).tokenUsage;
      if (tu && (process.env.METRICS_LOG === "1" || process.env.TOKEN_LOG === "1")) {
        const in_ = tu.agentInput ?? 0;
        const out_ = tu.agentOutput ?? 0;
        console.log(`[chat-async] tokens in=${in_} out=${out_} total=${in_ + out_}`);
      }
      if (workspaceId && tu) {
        void recordUsageEvent(supabaseAdmin, {
          workspaceId,
          userId: req.user?.id ?? null,
          nodeId: null,
          source: mode === "design" || mode === "greenfield" ? "greenfield" : "chat",
          model: "claude-sonnet-4-6",
          promptTokens: tu.agentInput ?? 0,
          completionTokens: tu.agentOutput ?? 0,
          metadata: { path: "chat-async", mode },
        });
      }
      let railsForResult: Array<{ id: string }> | undefined = (result as any).rails;
      if (isExecutionIntent && workspaceId && req.user?.id) {
        try {
          const { startedRails } = await runAutoRailsAndExecute(workspaceId, req.user.id, 3);
          if (startedRails.length > 0) {
            railsForResult = startedRails;
            addRailsToSession(threadId ?? undefined, workspaceId, req.user.id, startedRails.map((r) => r.id));
          }
        } catch {
          // best-effort
        }
      }
      const analysisRailIdAsync = maybeCreateAnalysisRail({
        mode,
        rootPath,
        question,
        result: {
          answer: result.answer,
          criticScore: result.criticScore ?? null,
          criticReport: result.criticReport ?? null,
          violations: (result.violations ?? []) as CriticViolation[],
          traceId: result.traceId ?? null,
          proposal: result.proposal,
        },
        userId: req.user?.id,
        workspaceId: workspaceId ?? null,
        repoUrl,
      });
      const allRailsAsync = [
        ...(analysisRailIdAsync ? [{ id: analysisRailIdAsync }] : []),
        ...(railsForResult ?? []),
      ];
      const railsDedupedAsync = Array.from(new Map(allRailsAsync.map((r) => [r.id, r])).values());
      if (analysisRailIdAsync && workspaceId && req.user?.id) {
        addRailsToSession(threadId ?? undefined, workspaceId, req.user.id, [analysisRailIdAsync]);
      }
      setTaskCompleted(task.taskId, {
        answer: result.answer,
        graphCommands: result.graphCommands,
        graphCommand: result.graphCommand,
        criticReport: result.criticReport,
        criticScore: result.criticScore,
        acceptanceCriteria: result.acceptanceCriteria,
        archetype: result.archetype,
        violations: result.violations ?? [],
        traceId: result.traceId,
        tokenUsage: tu,
        rails: railsDedupedAsync.length > 0 ? railsDedupedAsync : railsForResult,
        railIds: railsDedupedAsync.map((r) => r.id),
        boardHint: workspaceId && railsDedupedAsync.length > 0 ? { workspaceId } : undefined,
        // Explainability metadata from manager, if present.
        reasoningTrace: (result as any).reasoningTrace,
        citations: (result as any).citations,
        confidenceScore: (result as any).confidenceScore,
        suggestedActions: (result as any).suggestedActions,
      });

      if (supabaseAdmin && workspaceId && (result.violations ?? []).length > 0) {
        upsertViolations(supabaseAdmin as any, {
          workspaceId,
          violations: result.violations ?? [],
          rulesVersion: ARCH_RULESET_VERSION,
          markAbsent: false, // Chat returns question-scoped violations only; do not clear others.
        })
          .then(() => recordScanSnapshot(supabaseAdmin as any, workspaceId, ARCH_RULESET_VERSION))
          .catch((err) => {
            // eslint-disable-next-line no-console
            console.error("[chat-async] violationStore upsert failed:", err);
          });
      }


      if (supabaseAdmin && workspaceId && result.answer?.trim()) {
        try {
          await supabaseAdmin.from("conversation_snapshots").insert({
            workspace_id: workspaceId,
            node_id: nodeId ?? null,
            intent_summary: question.slice(0, 500),
            outcome_summary: result.answer.slice(0, 500),
          });
        } catch {
          if (process.env.METRICS_LOG === "1") {
            console.warn("[chat] conversation_snapshots insert skipped (async)");
          }
        }
      }

      if (supabaseAdmin && workspaceId && threadId && typeof threadId === "string") {
        const toAppend: Array<{ role: "user" | "assistant"; content: string }> = [
          { role: "user", content: question },
          { role: "assistant", content: (result.answer ?? "").slice(0, 10000) },
        ];
        if (result.criticReport?.trim()) {
          toAppend.push({ role: "assistant", content: `Critic: ${result.criticReport}`.slice(0, 10000) });
        }
        const autoTitle = question.slice(0, 60).trim();
        supabaseAdmin
          .from("chat_messages")
          .insert(
            toAppend.map((m) => ({
              thread_id: threadId,
              role: m.role,
              content: m.content,
            }))
          )
          .then(async () => {
            if (!supabaseAdmin) return;
            const update: Record<string, string> = { updated_at: new Date().toISOString() };
            const { data: thread } = await supabaseAdmin
              .from("chat_threads")
              .select("title")
              .eq("id", threadId)
              .eq("workspace_id", workspaceId)
              .single();
            if (thread?.title === "New chat" && autoTitle) {
              (update as Record<string, string>).title = autoTitle.slice(0, 200);
            }
            await supabaseAdmin
              .from("chat_threads")
              .update(update)
              .eq("id", threadId)
              .eq("workspace_id", workspaceId);
          })
          .then(undefined, (e: unknown) => console.warn("[chat] thread persist:", e instanceof Error ? e.message : e));
      }
    })
    .catch((err) => {
      const traceId = err instanceof ArchError ? err.traceId : undefined;
      logArchError(err, traceId, "chat-async");
      try {
        setTaskFailed(task.taskId, toUserMessage(err, traceId));
      } catch {
        // Task store failure shouldn't crash the process
      }
    });
  })();
});

export { router as chatRoutes };
