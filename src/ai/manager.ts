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
import { ArchError, ArchErrorCode, ErrorCode, logArchError, toUserMessage } from "./errors";
import type { RouteResult } from "./questionRouter";
import { routeQuestion } from "./questionRouter";
import { askAboutArchitecture as askWithClaude } from "./claudeEnricher";
import { askGreenfield, inferGreenfieldArchetype } from "./greenfieldEnricher";
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
}

/** Pluggable mode interface — enables future modes without touching orchestrator */
export interface ArchitectureMode {
  readonly mode: AgentMode;
  execute(params: Record<string, unknown>): Promise<ManagerResult>;
}

export async function runArchitectureTask(params: {
  question: string;
  graph: ArchGraph;
  nodeId?: string;
  history?: ArchitectureChatHistory;
  mode: AgentMode;
  apiKeyOpenAI?: string;
  apiKeyClaude?: string;
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
}): Promise<ManagerResult> {
  const { mode, rootPath, ...rest } = params;
  const traceId = crypto.randomUUID();
  const startMs = Date.now();

  console.log(`[manager] traceId=${traceId} mode=${mode}`);

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
  } = params;

  const resolvedRoot = path.resolve(rootPath);
  const rootExists = fs.existsSync(resolvedRoot);
  const hasFiles =
    rootExists &&
    fs
      .readdirSync(resolvedRoot, { withFileTypes: true })
      .some((e) => !e.name.startsWith("."));

  if (!rootExists || !hasFiles) {
    console.warn(
      `[manager] Preflight failed for rootPath=${resolvedRoot} | exists=${rootExists} | hasFiles=${hasFiles}`
    );
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

  console.log(
    `[manager] runAnalysisTask | rootPath=${resolvedRoot} | question="${question.slice(0, 80)}${question.length > 80 ? "…" : ""}"`
  );

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
      pdfFileName
    );

    lastAnswer = claudeResult.answer;
    lastGraphCommand = claudeResult.graphCommand;
    lastProposal = claudeResult.proposal;
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

    const review: CriticResult = isNavigationOnly
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
  };
}

async function runGreenfieldTask(params: {
  question: string;
  graph: ArchGraph;
  nodeId?: string;
  history?: ArchitectureChatHistory;
  apiKeyOpenAI?: string;
  apiKeyClaude?: string;
  findings?: ContractFinding[];
  traceId: string;
}): Promise<ManagerResult> {
  const {
    question,
    history,
    apiKeyOpenAI,
    apiKeyClaude,
    traceId,
  } = params;

  console.log(
    `[manager] runGreenfieldTask | traceId=${traceId} | question="${question.slice(0, 80)}${question.length > 80 ? "…" : ""}"`
  );

  const HISTORY_BUDGET = 60_000;
  const trimmedHistory = trimHistoryToBudget(
    (history ?? []) as { role: string; content: string }[],
    HISTORY_BUDGET
  ) as ArchitectureChatHistory;

  try {
  const useMock = process.env.USE_MOCK_GREENFIELD === "1" || process.env.USE_MOCK_GREENFIELD === "true";
  const greenfieldResult = useMock
    ? await askGreenfieldMock({ question, history: trimmedHistory })
    : await askGreenfield({ question, history: trimmedHistory, apiKeyClaude });

  const archetype = inferGreenfieldArchetype(params.question);
  const rootPath =
    params.graph?.projectRoot && typeof params.graph.projectRoot === "string" && params.graph.projectRoot.trim()
      ? params.graph.projectRoot.trim()
      : null;

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

  const graphCommands = greenfieldResult.graphCommands ?? (greenfieldResult.graphCommand ? [greenfieldResult.graphCommand] : undefined);
  return {
    answer: greenfieldResult.answer,
    graphCommands,
    graphCommand: graphCommands?.[0],
    criticReport: review.report,
    criticScore: review.score,
    violations: Array.isArray(review.violations) ? review.violations : [],
    traceId,
    acceptanceCriteria: review.acceptanceCriteria,
    archetype,
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
