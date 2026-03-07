import { Router } from "express";
import { runArchitectureTask } from "../../../src/ai/manager.js";
import { ArchError, toUserMessage, logArchError } from "../../../src/ai/errors.js";
import { requireUser } from "./middleware/requireUser.js";
import { validateGraphCommandMiddleware } from "./middleware/validateGraphCommand.js";
import { supabaseAdmin } from "./supabaseAdmin.js";
import { upsertViolations, recordScanSnapshot, buildGovernanceNotice, } from "./violationStore.js";
import { ARCH_RULESET_VERSION } from "../../../src/ai/critic.js";
import { createTask, setTaskRunning, setTaskCompleted, setTaskFailed, isTaskCancelled, } from "./tasks.js";
import { getUserJiraConfig } from "./jiraConfig.js";
import { getWorkspaceProjectKey } from "./jira.js";
import { saveDraft } from "./greenfieldDraft.js";
const router = Router();
router.post("/chat", requireUser, validateGraphCommandMiddleware, async (req, res) => {
    const { question, graph, nodeId, history, workspaceId, greenfieldSessionId } = req.body;
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
    const explicitMode = clientMode === "greenfield" || clientMode === "analysis"
        ? clientMode
        : null;
    const isEmptyGraph = graph.nodes.length === 0;
    const mode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
    const rootPath = mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== ""
        ? graph.projectRoot
        : null;
    try {
        const findings = []; // TODO: wire real findings if available
        const startMs = Date.now();
        let enrichedQuestion = question;
        if (supabaseAdmin && workspaceId) {
            const nodeIds = [];
            if (nodeId)
                nodeIds.push(nodeId);
            const notice = await buildGovernanceNotice(supabaseAdmin, workspaceId, nodeIds);
            if (notice) {
                enrichedQuestion = `${question}${notice}`;
            }
        }
        let jiraConfig;
        let jiraProjectKey;
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
        const violations = (result.violations ?? []);
        if (supabaseAdmin && workspaceId) {
            const client = supabaseAdmin;
            upsertViolations(client, {
                workspaceId,
                violations,
                rulesVersion: ARCH_RULESET_VERSION,
                markAbsent: true,
            })
                .then(() => recordScanSnapshot(client, workspaceId, ARCH_RULESET_VERSION))
                .catch((err) => {
                // eslint-disable-next-line no-console
                console.error("[violationStore] upsert/scan failed:", err);
            });
        }
        if (supabaseAdmin) {
            (async () => {
                let langsmithUrl = null;
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
                                hasGraphCommand: !!(result.graphCommands && result.graphCommands.length) ||
                                    !!result.graphCommand,
                            },
                            tags: ["architecture-visualizer"],
                        });
                        await run.postRun();
                        const maybeUrl = run.url;
                        langsmithUrl = typeof maybeUrl === "string" ? maybeUrl : null;
                    }
                    catch (err) {
                        if (process.env.METRICS_LOG === "1") {
                            console.warn("[metrics] LangSmith logging failed:", err instanceof Error ? err.message : String(err));
                        }
                    }
                }
                try {
                    await supabaseAdmin
                        .from("model_traces")
                        .insert({
                        workspace_id: workspaceId ?? null,
                        user_id: req.user?.id ?? null,
                        session_id: null,
                        question,
                        node_id: nodeId ?? null,
                        agent_model: "claude-sonnet-4-6",
                        critic_model: "gpt-4o-mini",
                        agent_latency_ms: latencyMs,
                        agent_prompt_tokens: null,
                        agent_completion_tokens: null,
                        langsmith_url: langsmithUrl,
                        agent_graph_commands: result.graphCommands && result.graphCommands.length > 0
                            ? result.graphCommands
                            : result.graphCommand
                                ? [result.graphCommand]
                                : null,
                        agent_violations: Array.isArray(result.violations) ? result.violations : null,
                        agent_answer: result.answer,
                        critic_latency_ms: null,
                        critic_prompt_tokens: null,
                        critic_completion_tokens: null,
                        critic_score: typeof result.criticScore === "number" ? String(result.criticScore) : null,
                    })
                        .throwOnError();
                }
                catch (err) {
                    if (process.env.METRICS_LOG === "1") {
                        console.warn("[metrics] Failed to insert model_traces:", err instanceof Error ? err.message : String(err));
                    }
                }
                // workspace_memories spec: insert when criticScore >= 7 and answer > 50 chars.
                // Stored: content = question + answer (truncated to 2k), memory_type = "arch_insight".
                // Query: GET /workspaces/:id/memories?nodeId= — returns by workspace, optionally filtered by node.
                if (workspaceId &&
                    typeof result.criticScore === "number" &&
                    result.criticScore >= 7 &&
                    result.answer?.trim().length > 50) {
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
                    }
                    catch {
                        if (process.env.METRICS_LOG === "1") {
                            console.warn("[metrics] workspace_memories insert skipped");
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
                }
                catch {
                    if (process.env.METRICS_LOG === "1") {
                        console.warn("[metrics] agent_traces insert skipped (table/schema may differ)");
                    }
                }
            })();
        }
        if (mode === "greenfield" &&
            greenfieldSessionId &&
            typeof greenfieldSessionId === "string" &&
            (result.graphCommands?.length || result.graphCommand)) {
            const cmds = result.graphCommands ?? (result.graphCommand ? [result.graphCommand] : []);
            const nodes = [];
            const edges = [];
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
                }
                catch {
                    // Non-fatal
                }
            }
        }
        res.json({
            answer: result.answer,
            graphCommands: result.graphCommands,
            graphCommand: result.graphCommand,
            criticReport: result.criticReport,
            criticScore: result.criticScore,
            acceptanceCriteria: result.acceptanceCriteria,
            archetype: result.archetype,
            violations: (result.violations ?? []),
            relevantNodeIds: result.relevantNodeIds ?? undefined,
        });
    }
    catch (err) {
        const traceId = err instanceof ArchError ? err.traceId : undefined;
        logArchError(err, traceId, "chat");
        const userMessage = toUserMessage(err, traceId);
        res.status(500).json({ error: userMessage, ...(traceId && { traceId }) });
    }
});
/** Async chat — returns 202 with taskId, client polls GET /api/tasks/:taskId */
router.post("/chat-async", requireUser, validateGraphCommandMiddleware, async (req, res) => {
    const { question, graph, nodeId, history, workspaceId, greenfieldSessionId } = req.body;
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
    const explicitMode = clientMode === "greenfield" || clientMode === "analysis"
        ? clientMode
        : null;
    const isEmptyGraph = graph.nodes.length === 0;
    const mode = explicitMode ?? (isEmptyGraph ? "greenfield" : "analysis");
    const rootPath = mode === "analysis" && graph.projectRoot && graph.projectRoot.trim() !== ""
        ? graph.projectRoot
        : null;
    const task = createTask();
    res.status(202).json({ taskId: task.taskId, status: "pending" });
    setTaskRunning(task.taskId);
    const findings = [];
    let jiraConfig;
    let jiraProjectKey;
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
        .then((result) => {
        if (isTaskCancelled(task.taskId))
            return;
        if (mode === "greenfield" &&
            sessionIdForDraft &&
            typeof sessionIdForDraft === "string" &&
            (result.graphCommands?.length || result.graphCommand)) {
            const cmds = result.graphCommands ?? (result.graphCommand ? [result.graphCommand] : []);
            const nodes = [];
            const edges = [];
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
                }
                catch {
                    // Non-fatal
                }
            }
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
        });
    })
        .catch((err) => {
        const traceId = err instanceof ArchError ? err.traceId : undefined;
        logArchError(err, traceId, "chat-async");
        try {
            setTaskFailed(task.taskId, toUserMessage(err, traceId));
        }
        catch {
            // Task store failure shouldn't crash the process
        }
    });
});
export { router as chatRoutes };
