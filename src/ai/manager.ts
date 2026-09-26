import { summariseAgentInventory } from "./agentSummary";
import * as fs from "fs";
import * as path from "path";
import type {
  AgentMode,
  ArchGraph,
  ArchitectureChatHistory,
  ContractFinding,
  GraphCommand,
  CriticResult,
  CriticViolation,
} from "../types";
import { logArchEvent } from "./logger";
import { ArchError, ArchErrorCode, ErrorCode, logArchError, toUserMessage } from "./errors";
import type { RouteResult } from "./questionRouter";
import { routeQuestion } from "./questionRouter";
import { retrieveFileSnippets } from "./retriever";
import { formatSkillSummary } from "../agent/skillStore";
import { askAboutArchitecture as askWithClaude } from "./claudeEnricher";
import { askGreenfield, askGreenfieldStream, inferGreenfieldArchetype } from "./greenfieldEnricher";
import { askGreenfieldOpenAI } from "./greenfieldEnricherOpenAI";
import { askGreenfieldMock } from "./mockGreenfieldEnricher";
import { reviewArchitectureAnswer, reviewGreenfieldAnswer } from "./critic";
import { recordSuccessfulRun } from "../agent/templateLibrary";
import { recordTaskMetrics } from "./metrics";
import { trimHistoryToBudget } from "./contextTrim";

export interface ManagerResult {
  answer: string;
  /** Multiple create_node/connect per turn (greenfield) */
  graphCommands?: GraphCommand[];
  /** Single command for backwards compat / analysis */
  graphCommand?: GraphCommand;
  criticReport?: string;
  criticScore?: number;
  proposal?: unknown;
  violations?: CriticViolation[];
  traceId?: string;
  /** Token usage from agent + critic (for telemetry and UI warning). */
  tokenUsage?: { agentInput: number; agentOutput: number; criticInput?: number; criticOutput?: number };
  /** Node IDs routeQuestion selected as context for this answer */
  relevantNodeIds?: string[];
  /** Greenfield: acceptance criteria from critic for rail persistence and spec generation */
  acceptanceCriteria?: { functional: string[]; visual: string[]; architectural: string[] };
  /** Greenfield: inferred archetype for template/anti-pattern routing */
  archetype?: string;
  /** Optional rails created/updated during this interaction (for UI linkback). */
  rails?: Array<{ id: string; outcome?: string; state?: string; archetype?: string }>;
  /** Reasoning steps for explainability (from agent tool use). */
  reasoningTrace?: string[];
  /** Citations linking claims to nodes, edges, or files. */
  citations?: Array<{ label: string; nodeId?: string; edgeId?: string; filePath?: string }>;
  /** Confidence 0–1 derived from critic or heuristics. */
  confidenceScore?: number;
  /** Suggested actions (e.g. "Highlight these nodes") derived from graph command. */
  suggestedActions?: string[];
}

/** Pluggable mode interface — enables future modes without touching orchestrator */
export interface ArchitectureMode {
  readonly mode: AgentMode;
  execute(params: Record<string, unknown>): Promise<ManagerResult>;
}

/** Condense the agent inventory into prose the model can reason over. */

export async function runArchitectureTask(params: {
  question: string;
  graph: ArchGraph;
  nodeId?: string;
  history?: ArchitectureChatHistory;
  mode: AgentMode;
  apiKeyOpenAI?: string;
  apiKeyClaude?: string;
  /** Optional per-request override of which model builds the design; falls back to GREENFIELD_PROVIDER env var when omitted. */
  provider?: "anthropic" | "openai";
  findings?: ContractFinding[];
  rootPath: string | null;
  /** Per-user Jira config from integrations (webapp chat flow) */
  jiraConfig?: { baseUrl: string; email: string; apiToken: string };
  /** Workspace Jira project key (webapp chat flow) */
  jiraProjectKey?: string;
  /** Section 9.1: Optional rail for buildRailContext (plan-scoped Q&A) */
  rail?: { outcome: string; state: string; logicPath: Array<{ layer: string; nodeId: string }>; sessionId: string } | null;
  /** Optional PDF attachment (base64) for analysis chat */
  pdfBase64?: string;
  pdfFileName?: string;
  /** Feedback-loop: hint when user has recent downvotes (prefer concise responses). */
  feedbackContext?: string;
}): Promise<ManagerResult> {
  const { mode, rootPath, ...rest } = params;
  const traceId = crypto.randomUUID();
  const startMs = Date.now();

  logArchEvent("info", "runArchitectureTask start", {
    traceId,
    mode,
  });

  const modeRegistry: Record<AgentMode, ArchitectureMode> = {
    analysis: {
      mode: "analysis",
      execute: (p) =>
        !rootPath
          ? Promise.resolve({
              answer:
                "ERROR: Analysis mode requires a project root. Please scan a repository first.",
              criticReport: "Mode mismatch: analysis requires rootPath.",
              criticScore: 0,
              traceId,
            })
          : runAnalysisTask({ ...rest, rootPath, traceId }),
    },
    greenfield: {
      mode: "greenfield",
      execute: () => runGreenfieldTask({ ...rest, traceId }),
    },
  };

  try {
    const modeImpl = modeRegistry[mode];
    if (!modeImpl) throw new Error(`Unknown mode: ${mode}`);
    const result = await modeImpl.execute({ ...rest, rootPath, traceId } as Record<string, unknown>);
    recordTaskMetrics({
      traceId,
      mode,
      timestamp: startMs,
      latencyMs: Date.now() - startMs,
      criticScore: result.criticScore,
    });
    return result;
  } catch (err) {
    recordTaskMetrics({
      traceId,
      mode,
      timestamp: startMs,
      latencyMs: Date.now() - startMs,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function runAnalysisTask(params: {
  question: string;
  graph: ArchGraph;
  nodeId?: string;
  history?: ArchitectureChatHistory;
  apiKeyOpenAI?: string;
  apiKeyClaude?: string;
  findings?: ContractFinding[];
  rootPath: string;
  traceId: string;
  jiraConfig?: { baseUrl: string; email: string; apiToken: string };
  jiraProjectKey?: string;
  rail?: { outcome: string; state: string; logicPath: Array<{ layer: string; nodeId: string }>; sessionId: string } | null;
  pdfBase64?: string;
  pdfFileName?: string;
  feedbackContext?: string;
}): Promise<ManagerResult> {
  const {
    question,
    graph,
    nodeId,
    history,
    apiKeyOpenAI,
    apiKeyClaude,
    findings,
    rootPath,
    traceId,
    jiraConfig,
    jiraProjectKey,
    rail,
    pdfBase64,
    pdfFileName,
    feedbackContext,
  } = params;

  const resolvedRoot = path.resolve(rootPath);
  const rootExists = fs.existsSync(resolvedRoot);
  const hasFiles =
    rootExists &&
    fs
      .readdirSync(resolvedRoot, { withFileTypes: true })
      .some((e) => !e.name.startsWith("."));

  if (!rootExists || !hasFiles) {
    logArchEvent("warn", "manager preflight failed", {
      traceId,
      rootPath: resolvedRoot,
      rootExists,
      hasFiles,
    });
    return {
      answer:
        "ERROR: The source code for this project is missing or has been cleaned up. " +
        "Please re-scan the repository to regenerate the architecture graph, then try your question again.",
      graphCommand: undefined,
      criticReport:
        "Preflight check failed: projectRoot directory missing or empty. Manager aborted to avoid hallucinations.",
      criticScore: 0,
      traceId,
    };
  }

  logArchEvent("info", "runAnalysisTask", {
    traceId,
    rootPath: resolvedRoot,
    question: question.slice(0, 200),
  });

  let localHistory = history ?? [];

  try {
    const skillMatches = [...question.matchAll(/skill\s+['"]?([\w-]+)['"]?/gi)];
    for (const m of skillMatches) {
      const skillId = m[1];
      const indexPath = path.join(resolvedRoot, ".agent", "skill_index.json");
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, "utf8");
        const parsed = JSON.parse(raw) as {
          skills?: Array<{ id?: string; path?: string; description?: string }>;
        };
        const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
        const skillMeta = skills.find(
          (s) => s.id === skillId && typeof s.path === "string"
        );
        if (skillMeta?.path) {
          const skillPath = skillMeta.path;
          const absSkillPath = path.isAbsolute(skillPath)
            ? skillPath
            : path.join(resolvedRoot, skillPath);
          if (fs.existsSync(absSkillPath)) {
            const skillCode = fs.readFileSync(absSkillPath, "utf8");
            localHistory = [
              ...localHistory,
              {
                role: "system" as const,
                content:
                  `CRITICAL CONTEXT: You are refactoring or using the existing skill '${skillId}'. ` +
                  `Here is its current implementation:\n\n\`\`\`\n${skillCode}\n\`\`\``,
              },
            ];
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      `[manager] Librarian pre-hook failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const route: RouteResult = routeQuestion(
    question,
    graph,
    findings ?? [],
    nodeId,
    history
  );

  const HISTORY_BUDGET = 60_000;
  localHistory = trimHistoryToBudget(
    localHistory as { role: string; content: string }[],
    HISTORY_BUDGET
  ) as ArchitectureChatHistory;

  let attempts = 0;
  const maxAttempts = 2;
  let lastAnswer = "";
  let lastGraphCommand: GraphCommand | undefined;
  let lastCriticReport = "";
  let lastCriticScore = 0;
  let lastProposal: unknown;
  let lastViolations: CriticViolation[] = [];
  let lastTokenUsage: ManagerResult["tokenUsage"];
  let lastReasoningTrace: string[] | undefined;
  let lastCitations: ManagerResult["citations"];

  while (attempts < maxAttempts) {
    const claudeResult = await askWithClaude(
      question,
      graph,
      nodeId,
      localHistory,
      apiKeyClaude,
      findings,
      rootPath,
      jiraConfig,
      jiraProjectKey,
      rail ?? undefined,
      pdfBase64,
      pdfFileName,
      feedbackContext
    );

    lastAnswer = claudeResult.answer;
    lastGraphCommand = claudeResult.graphCommand;
    lastProposal = claudeResult.proposal;
    lastReasoningTrace = (claudeResult as { reasoningTrace?: string[] }).reasoningTrace;
    lastCitations = (claudeResult as { citations?: ManagerResult["citations"] }).citations;
    const usedSaveSkill = claudeResult.usedSaveSkill === true;
    if (claudeResult.tokenUsage) {
      lastTokenUsage = {
        agentInput: claudeResult.tokenUsage.input,
        agentOutput: claudeResult.tokenUsage.output,
      };
    }

    const isNavigationOnly =
      route.intent === "show_layer" &&
      !!lastGraphCommand &&
      lastAnswer.trim().length < 120;

    // The critic doubles the cost of every question, and for a lookup it
    // reviews a list. Yesterday it scored a correct "that function does not
    // exist" 4 out of 10 for insufficient architectural context — the failure
    // mode of reviewing an answer that had nothing to review.
    //
    // It earns its cost when the turn changed something or proposed changing
    // something. Those are the answers where being wrong matters.
    const asksForChange =
      /\b(add|create|change|edit|fix|refactor|implement|build|remove|delete|rename|move|update|write)\b/i.test(question);
    const wroteSomething =
      /\b(edited|created|added|updated|wrote|removed)\b/i.test(lastAnswer.slice(0, 400));
    const proposesDesign =
      /\b(should|recommend|suggest|propose|instead of|better to)\b/i.test(lastAnswer.slice(0, 600));
    const criticWorthRunning = asksForChange || wroteSomething || proposesDesign;

    const review: CriticResult = isNavigationOnly || !criticWorthRunning
      ? {
          approved: true,
          score: 10,
          report: "Navigation-only query; critic skipped.",
          violations: [],
        }
      : await reviewArchitectureAnswer({
          question,
          answer: claudeResult.answer,
          graph,
          findings,
          apiKey: apiKeyOpenAI,
          apiKeyClaude,
        });

    lastCriticReport = review.report;
    lastCriticScore = review.score;
    lastViolations = Array.isArray(review.violations) ? review.violations : [];

    if (
      lastGraphCommand &&
      lastGraphCommand.action === "filter_layer" &&
      /src\/agent/i.test(question)
    ) {
      const agentNodeIds = graph.nodes
        .map((n) => n.id)
        .filter((id) =>
          id
            .replace(/\\/g, "/")
            .replace(/^\.\//, "")
            .startsWith("src/agent")
        );
      if (agentNodeIds.length > 0) {
        lastGraphCommand = {
          action: "highlight_nodes",
          nodeIds: agentNodeIds.slice(0, 12),
        };
      }
    }

    const FALLBACK_MSG = "I was unable to formulate a complete answer.";
    const isUsageRequest =
      /use\s+(?:the\s+)?(?:['"]?\w+['"]?\s+)?skill|run\s+(?:the\s+)?\w+\s+skill|summarize\s+(?:all\s+)?(?:routes|interfaces|modules)|list\s+(?:all\s+)?(?:routes|interfaces)/i.test(
        question
      );
    if (lastAnswer.includes(FALLBACK_MSG) && attempts < maxAttempts - 1) {
      const chunkingHint =
        lastAnswer.length > 12000
          ? " Keep your answer concise or summarize by section to avoid truncation."
          : "";
      const directiveContent = isUsageRequest
        ? `DIRECTIVE: Your last attempt did not run the requested skill. You have the relevant skill in context (see Skill Library above). ` +
          `IMMEDIATELY call the run_skill tool with the appropriate skill id (e.g. map-routes, list-interfaces), then call the answer tool to summarize the tool output for the user. Do NOT respond with an inability message.${chunkingHint}`
        : `DIRECTIVE: Your last attempt failed. Critic says:\n${review.report}\n\n` +
          `STOP searching files. IMMEDIATELY write the requested script or answer, use any required tools (such as "save_skill"), and then call the "answer" tool to finish. THIS IS YOUR LAST CHANCE.${chunkingHint}`;
      localHistory = [
        ...(localHistory ?? []),
        { role: "assistant", content: lastAnswer },
        { role: "user", content: directiveContent },
      ];
      attempts += 1;
      continue;
    }

    const hasCodeBlock = /```[\s\S]*?```/.test(lastAnswer);
    const askedForCode =
      /refactor|code|script|implement|write|save.*skill|save as/i.test(question);
    if (
      askedForCode &&
      !hasCodeBlock &&
      !review.approved &&
      attempts < maxAttempts - 1
    ) {
      localHistory = [
        ...(localHistory ?? []),
        { role: "assistant", content: lastAnswer },
        {
          role: "user",
          content:
            "DIRECTIVE: You provided analysis but no code block. The user explicitly asked for code/script output. " +
            "Do NOT provide more high-level analysis or tables. IMMEDIATELY output the full implementation in a markdown code block and finish.",
        },
      ];
      attempts += 1;
      continue;
    }

    if (
      askedForCode &&
      usedSaveSkill &&
      !hasCodeBlock &&
      attempts < maxAttempts - 1
    ) {
      localHistory = [
        ...(localHistory ?? []),
        { role: "assistant", content: lastAnswer },
        {
          role: "user",
          content:
            "SYSTEM DIRECTIVE: You successfully saved the skill, but you did NOT show its code. " +
            "IMMEDIATELY output the full saved implementation in a markdown code block and briefly summarize what it does. " +
            "Do NOT provide additional analysis, tables, or commentary.",
        },
      ];
      attempts += 1;
      continue;
    }

    if (review.approved) {
      recordSuccessfulRun({
        rootPath,
        intent: route.intent,
        model: "claude",
        usedCritic: true,
        score: review.score,
        question,
      });
      break;
    }
    if (attempts === maxAttempts - 1) {
      break;
    }

    const chunkingNote =
      lastAnswer.length > 12000
        ? "\n\nCHUNKING DIRECTIVE: Your previous response was very long and may have been truncated. For this retry, summarize by section, list the most important items first, or add \"... (N more)\" to avoid truncation."
        : "";
    localHistory = [
      ...(localHistory ?? []),
      {
        role: "assistant",
        content: `Critic feedback on your previous answer:\n${review.report}${chunkingNote}`,
      },
    ];

    attempts += 1;
  }

  // Prefer telemetry + trace_path when the user is asking about a runtime flow
  // and the model did not already emit a trace_path command.
  if (
    route.intent === "trace_flow" &&
    !lastGraphCommand &&
    lastAnswer &&
    Array.isArray(route.relevantNodeIds) &&
    route.relevantNodeIds.length >= 2
  ) {
    const ids = route.relevantNodeIds.slice(0, 8);
    lastGraphCommand = {
      action: "trace_path",
      nodeIds: ids,
    };
    lastAnswer =
      lastAnswer +
      "\n\n---\nI have highlighted a `trace_path` across the most relevant nodes so you can inspect the runtime flow on the canvas.";
  }

  // Fix-or-Track protocol: when critic found violations, explicitly ask the user
  // whether to fix now (rails) or track in Jira (ticket creation).
  if (lastViolations.length > 0) {
    const alreadyAsked =
      /fix\s+now|track\s+\(create\s+jira\)|track\s+in\s+jira/i.test(lastAnswer);
    if (!alreadyAsked) {
      const top = lastViolations.slice(0, 3);
      const bullets = top
        .map((v) => {
          const pair = v.targetNodeId ? `${v.sourceNodeId} → ${v.targetNodeId}` : v.sourceNodeId;
          return `- ${v.severity.toUpperCase()}: ${v.type} (${pair}) — ${v.description}`;
        })
        .join("\n");
      lastAnswer =
        lastAnswer +
        `\n\n---\n**Architectural violations detected. Fix now or track (create Jira)?**\n\n${bullets}\n\nReply with **Fix** to open a rail/refactor flow, or **Track** to create Jira tickets tagged with \`archNodeId:<id>\`.`;
    }
  }

  const confidenceScore =
    lastCriticScore != null && lastCriticScore >= 0
      ? Math.max(0, Math.min(1, lastCriticScore / 10))
      : undefined;
  const suggestedActions = deriveSuggestedActions(lastGraphCommand, route.relevantNodeIds);

  return {
    answer: lastAnswer,
    graphCommand: lastGraphCommand,
    criticReport: lastCriticReport,
    criticScore: lastCriticScore,
    proposal: lastProposal,
    violations: lastViolations,
    traceId,
    relevantNodeIds: route.relevantNodeIds,
    ...(lastTokenUsage ? { tokenUsage: lastTokenUsage } : {}),
    ...(confidenceScore != null ? { confidenceScore } : {}),
    ...(suggestedActions.length > 0 ? { suggestedActions } : {}),
    ...(lastReasoningTrace?.length ? { reasoningTrace: lastReasoningTrace } : {}),
    ...(lastCitations?.length ? { citations: lastCitations } : {}),
  };
}

function deriveSuggestedActions(
  cmd: GraphCommand | undefined,
  relevantNodeIds: string[] | undefined
): string[] {
  if (!cmd && (!relevantNodeIds || relevantNodeIds.length === 0)) return [];
  const actions: string[] = [];
  if (cmd) {
    switch (cmd.action) {
      case "highlight_nodes":
        actions.push("Highlight these nodes");
        break;
      case "focus_node":
        actions.push("Focus on this node");
        break;
      case "filter_layer":
        actions.push(`Show ${cmd.layer} layer`);
        break;
      case "trace_path":
        actions.push("Show request flow");
        break;
      case "reset":
        actions.push("Reset view");
        break;
      default:
        break;
    }
  }
  if (actions.length === 0 && relevantNodeIds && relevantNodeIds.length > 0) {
    actions.push("Highlight these nodes");
  }
  return actions;
}

async function runGreenfieldTask(params: {
  question: string;
  graph: ArchGraph;
  nodeId?: string;
  history?: ArchitectureChatHistory;
  apiKeyOpenAI?: string;
  apiKeyClaude?: string;
  /** Optional per-request override of which model builds the design; falls back to GREENFIELD_PROVIDER env var when omitted. */
  provider?: "anthropic" | "openai";
  findings?: ContractFinding[];
  traceId: string;
  pdfBase64?: string;
  pdfFileName?: string;
  jiraConfig?: { baseUrl: string; email: string; apiToken: string };
  jiraProjectKey?: string;
  /** When provided, uses streaming for greenfield (single-turn, no Jira) and invokes for each text chunk */
  onTextChunk?: (chunk: string) => void;
}): Promise<ManagerResult> {
  const {
    question,
    history,
    apiKeyOpenAI,
    apiKeyClaude,
    provider: requestedProvider,
    traceId,
    pdfBase64,
    pdfFileName,
  } = params;

  console.log(
    `[manager] runGreenfieldTask | traceId=${traceId} | question="${question.slice(0, 80)}${question.length > 80 ? "…" : ""}"`
  );

  const HISTORY_BUDGET = 60_000;
  let trimmedHistory = trimHistoryToBudget(
    (history ?? []) as { role: string; content: string }[],
    HISTORY_BUDGET
  ) as ArchitectureChatHistory;

  const useMock = process.env.USE_MOCK_GREENFIELD === "1" || process.env.USE_MOCK_GREENFIELD === "true";
  const archetype = inferGreenfieldArchetype(params.question);
  const rootPath =
    params.graph?.projectRoot && typeof params.graph.projectRoot === "string" && params.graph.projectRoot.trim()
      ? params.graph.projectRoot.trim()
      : null;

  let contextBlock: string | undefined;
  if (rootPath && params.graph?.nodes?.length) {
    try {
      const route = routeQuestion(
        question,
        params.graph,
        params.findings ?? [],
        params.nodeId,
        history
      );
      if (route.filesToRead.length > 0) {
        const retrieved = retrieveFileSnippets(
          rootPath,
          route.filesToRead,
          params.graph,
          route.keywords
        );
        if (retrieved.formatted) {
          contextBlock = `## Code context from existing repo\n${retrieved.formatted}`;
        }
      }
      try {
        const skillsText = formatSkillSummary(rootPath, 12);
        if (skillsText) {
          contextBlock = (contextBlock ?? "") + `\n\n## Skill Library (from .agent/skill_index.json)\n${skillsText}\n`;
        }
      } catch {
        // Non-fatal
      }
    } catch {
      // Best-effort; proceed without retrieval
    }
  }

  // Agent inventory needs no filesystem access, so it is added whether or not
  // retrieval succeeded — a saved graph often has a projectRoot that no longer
  // exists on this machine.
  const agentSummary = summariseAgentInventory(params.graph);
  if (agentSummary) {
    contextBlock = agentSummary + (contextBlock ? "\n\n" + contextBlock : "");
  }
  if (process.env.ARCHY_DUMP_CONTEXT === "1") {
    try { fs.writeFileSync("/tmp/archy-context.txt", String(contextBlock ?? "(contextBlock is undefined)"), "utf8"); } catch {}
  }

  const maxAttempts = 2;
  let attempts = 0;
  let lastResult: Awaited<ReturnType<typeof askGreenfield>> | null = null;
  let lastReview: Awaited<ReturnType<typeof reviewGreenfieldAnswer>> | null = null;

  const useStream = !!params.onTextChunk && !params.jiraConfig && !params.jiraProjectKey;
  const askParams = {
    question,
    history: trimmedHistory,
    apiKeyClaude,
    ...(pdfBase64 ? { pdfBase64, pdfFileName: pdfFileName ?? "document.pdf" } : {}),
    ...(contextBlock ? { contextBlock } : {}),
    ...(params.jiraConfig ? { jiraConfig: params.jiraConfig } : {}),
    ...(params.jiraProjectKey ? { jiraProjectKey: params.jiraProjectKey } : {}),
    ...(useStream && params.onTextChunk ? { onTextChunk: params.onTextChunk } : {}),
  };

  try {
  while (attempts < maxAttempts) {
    const provider = (requestedProvider || process.env.GREENFIELD_PROVIDER || "anthropic").trim().toLowerCase();
    const greenfieldResult = useMock
      ? await askGreenfieldMock({ question, history: trimmedHistory })
      : provider === "openai"
        ? await askGreenfieldOpenAI({ question, history: trimmedHistory, contextBlock, apiKeyOpenAI })
        : useStream
          ? await askGreenfieldStream(askParams)
          : await askGreenfield(askParams);
    lastResult = greenfieldResult;

    const review = await reviewGreenfieldAnswer({
      question,
      answer: greenfieldResult.answer,
      graphCommands: greenfieldResult.graphCommands,
      graphCommand: greenfieldResult.graphCommand,
      apiKey: apiKeyOpenAI,
      apiKeyClaude,
      existingGraph: params.graph?.nodes?.length ? params.graph : null,
      rootPath,
      archetype,
    });
    lastReview = review;

    const approved = review.approved === true && (typeof review.score === "number" ? review.score >= 6 : true);
    if (approved || attempts === maxAttempts - 1) break;

    trimmedHistory = [
      ...trimmedHistory,
      { role: "assistant" as const, content: greenfieldResult.answer },
      {
        role: "user" as const,
        content: `Critic feedback on your previous design:\n${review.report}\n\nPlease revise the design to address these issues.`,
      },
    ];
    attempts += 1;
  }

  const graphCommands = lastResult
    ? (lastResult.graphCommands ?? (lastResult.graphCommand ? [lastResult.graphCommand] : undefined))
    : undefined;
  const gfScore = lastReview?.score ?? 0;
  const confidenceScore = typeof gfScore === "number" ? Math.max(0, Math.min(1, gfScore / 10)) : undefined;
  const suggestedActions = deriveSuggestedActions(graphCommands?.[0], undefined);
  return {
    answer: lastResult?.answer ?? "Design generation failed.",
    graphCommands,
    graphCommand: graphCommands?.[0],
    criticReport: lastReview?.report ?? "No review.",
    criticScore: gfScore,
    violations: Array.isArray(lastReview?.violations) ? lastReview.violations : [],
    traceId,
    acceptanceCriteria: lastReview?.acceptanceCriteria,
    archetype,
    ...(confidenceScore != null ? { confidenceScore } : {}),
    ...(suggestedActions.length > 0 ? { suggestedActions } : {}),
  };
  } catch (err) {
    if (err instanceof ArchError) throw err;
    logArchError(err, traceId, "runGreenfieldTask");
    const raw = err instanceof Error ? err.message : String(err);
    const lower = raw.toLowerCase();
    let code: ArchErrorCode = ErrorCode.UNKNOWN;
    if (lower.includes("rate") || lower.includes("429")) code = ErrorCode.RATE_LIMIT;
    else if (lower.includes("api key") || lower.includes("401")) code = ErrorCode.NO_API_KEY;
    else if (lower.includes("timeout") || lower.includes("econnreset")) code = ErrorCode.TRANSIENT;
    else if (lower.includes("invalid") || lower.includes("parse")) code = ErrorCode.LLM_PARSE_FAILURE;
    throw new ArchError({
      code,
      userMessage: toUserMessage(err, traceId),
      traceId,
      internal: raw,
    });
  }
}
