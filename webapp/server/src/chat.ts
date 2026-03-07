import { Router } from "express";
import { randomUUID } from "node:crypto";
import { runArchitectureTask } from "../../../src/ai/manager.js";
import type { ArchGraph, AgentMode, ContractFinding, CriticViolation } from "../../../src/types.js";
import { ArchError, toUserMessage, logArchError } from "../../../src/ai/errors.js";
import { requireUser } from "./middleware/requireUser.js";
import { validateGraphCommandMiddleware } from "./middleware/validateGraphCommand.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { maybePruneWorkspaceMemories } from "./memoryHygiene.js";
import {
  getMemoriesForContext,
  getSnapshotsForContext,
  getUserMemoriesForContext,
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
import { getUserJiraConfig } from "./jiraConfig.js";
import { getWorkspaceProjectKey } from "./jira.js";
import { saveDraft } from "./greenfieldDraft.js";
import type { Rail, RailTrigger, Task as RailTask } from "../../../src/agent/types.js";
import { createRail } from "../../../src/agent/rail/manager.js";
import { createTask as createRailTask } from "../../../src/agent/rail/manager.js";

const router = Router();

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
}) {
  if (params.mode !== "analysis") return;
  if (!params.rootPath) return;
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
    const created = createRail(params.rootPath, rail);
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
  } catch (err) {
    console.error("[chat] maybeCreateAnalysisRail failed", {
      rootPath: params.rootPath,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
}

router.post("/chat", requireUser, validateGraphCommandMiddleware, async (req, res) => {
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId } = req.body as {
    question?: string;
    graph?: ArchGraph;
    nodeId?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    workspaceId?: string | null;
    greenfieldSessionId?: string | null;
    threadId?: string | null;
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

  // Greenfield mode: empty graph allowed — agent designs from scratch
  // Backwards compatibility: if client sends mode, use it; else derive from graph
  const clientMode = req.body?.mode;
  const explicitMode =
    clientMode === "greenfield" || clientMode === "analysis"
      ? (clientMode as AgentMode)
      : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode: AgentMode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
  const rootPath =
    mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== ""
      ? graph.projectRoot
      : null;

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
      const [memories, snapshots, userMemories] = await Promise.all([
        getMemoriesForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        getSnapshotsForContext(supabaseAdmin, workspaceId, { nodeId: nodeId ?? null }),
        req.user?.id ? getUserMemoriesForContext(supabaseAdmin, req.user.id) : Promise.resolve([]),
      ]);
      const memoryBlock = buildMemoryContextBlock(memories, snapshots, userMemories);
      if (memoryBlock) {
        enrichedQuestion = `${memoryBlock}\n## Current question\n${question}`;
      }
    }

    let jiraConfig: { baseUrl: string; email: string; apiToken: string } | undefined;
    let jiraProjectKey: string | undefined;
    if (req.user?.id) {
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
    }

    const result = await runArchitectureTask({
      question: enrichedQuestion,
      graph,
      nodeId,
      history,
      mode,
      apiKeyOpenAI: process.env.OPENAI_API_KEY,
      apiKeyClaude: process.env.ANTHROPIC_API_KEY,
      findings,
      rootPath,
      jiraConfig,
      jiraProjectKey: jiraProjectKey ?? undefined,
    });
    const latencyMs = Date.now() - startMs;

    setImmediate(() => {
      try {
        maybeCreateAnalysisRail({
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
        });
      } catch (err) {
        console.error("[chat] maybeCreateAnalysisRail failed", {
          rootPath,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    });

    const violations = (result.violations ?? []) as CriticViolation[];

    if (supabaseAdmin && workspaceId) {
      const client = supabaseAdmin;
      upsertViolations(client, {
        workspaceId,
        violations,
        rulesVersion: ARCH_RULESET_VERSION,
        markAbsent: true,
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
            await supabaseAdmin
              .from("workspace_memories")
              .insert({
                workspace_id: workspaceId,
                node_id: nodeId ?? null,
                content: `${question}\n\n${result.answer.slice(0, 2000)}`,
                memory_type: "arch_insight",
              })
              .throwOnError();
            if (supabaseAdmin) {
              const client = supabaseAdmin;
              setImmediate(() => {
                void maybePruneWorkspaceMemories(client, workspaceId).catch(() => {});
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
      const nodes: Array<{ id: string; label: string; layer?: string; description?: string; archNodeId?: string }> = [];
      const edges: Array<{ source: string; target: string }> = [];
      for (const cmd of cmds) {
        if (cmd.action === "create_node" && "id" in cmd) {
          nodes.push({
            id: cmd.id,
            label: cmd.label ?? cmd.id,
            layer: "layer" in cmd ? cmd.layer : undefined,
            description: "description" in cmd ? cmd.description : undefined,
            archNodeId: "archNodeId" in cmd ? cmd.archNodeId : undefined,
          });
        }
        if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
          edges.push({ source: cmd.fromId, target: cmd.toId });
        }
      }
      if (nodes.length > 0 || edges.length > 0) {
        try {
          saveDraft(greenfieldSessionId, { nodes, edges, workspaceId: workspaceId ?? undefined });
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

    const tokenUsage = (result as { tokenUsage?: { agentInput?: number; agentOutput?: number } }).tokenUsage;
    if (tokenUsage && (process.env.METRICS_LOG === "1" || process.env.TOKEN_LOG === "1")) {
      const in_ = tokenUsage.agentInput ?? 0;
      const out_ = tokenUsage.agentOutput ?? 0;
      console.log(`[chat] tokens in=${in_} out=${out_} total=${in_ + out_}`);
    }
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
  const { question, graph, nodeId, history, workspaceId, greenfieldSessionId, threadId } = req.body as {
    question?: string;
    graph?: ArchGraph;
    nodeId?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    workspaceId?: string | null;
    greenfieldSessionId?: string | null;
    threadId?: string | null;
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

  const clientMode = req.body?.mode;
  const explicitMode =
    clientMode === "greenfield" || clientMode === "analysis"
      ? (clientMode as AgentMode)
      : null;
  const isEmptyGraph = graph.nodes.length === 0;
  const mode: AgentMode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
  const rootPath =
    mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== ""
      ? graph.projectRoot
      : null;

  const task = createTask();
  res.status(202).json({ taskId: task.taskId, status: "pending" });

  setTaskRunning(task.taskId);
  const findings: ContractFinding[] = [];

  let jiraConfig: { baseUrl: string; email: string; apiToken: string } | undefined;
  let jiraProjectKey: string | undefined;
  if (req.user?.id) {
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
    findings,
    rootPath,
    jiraConfig,
    jiraProjectKey: jiraProjectKey ?? undefined,
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
        const nodes: Array<{ id: string; label: string; layer?: string; description?: string; archNodeId?: string }> = [];
        const edges: Array<{ source: string; target: string }> = [];
        for (const cmd of cmds) {
          if (cmd.action === "create_node" && "id" in cmd) {
            nodes.push({
              id: cmd.id,
              label: cmd.label ?? cmd.id,
              layer: "layer" in cmd ? cmd.layer : undefined,
              description: "description" in cmd ? cmd.description : undefined,
              archNodeId: "archNodeId" in cmd ? cmd.archNodeId : undefined,
            });
          }
          if (cmd.action === "connect" && "fromId" in cmd && "toId" in cmd) {
            edges.push({ source: cmd.fromId, target: cmd.toId });
          }
        }
        if (nodes.length > 0 || edges.length > 0) {
          try {
            saveDraft(sessionIdForDraft, { nodes, edges, workspaceId: workspaceId ?? undefined });
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
      });

      setImmediate(() => {
        try {
          maybeCreateAnalysisRail({
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
          });
        } catch (err) {
          console.error("[chat] maybeCreateAnalysisRail failed (async)", {
            rootPath,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          });
        }
      });

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
});

export { router as chatRoutes };
