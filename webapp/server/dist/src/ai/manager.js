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
exports.runArchitectureTask = runArchitectureTask;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const errors_1 = require("./errors");
const questionRouter_1 = require("./questionRouter");
const claudeEnricher_1 = require("./claudeEnricher");
const greenfieldEnricher_1 = require("./greenfieldEnricher");
const mockGreenfieldEnricher_1 = require("./mockGreenfieldEnricher");
const critic_1 = require("./critic");
const templateLibrary_1 = require("../agent/templateLibrary");
const metrics_1 = require("./metrics");
async function runArchitectureTask(params) {
    const { mode, rootPath, ...rest } = params;
    const traceId = crypto.randomUUID();
    const startMs = Date.now();
    console.log(`[manager] traceId=${traceId} mode=${mode}`);
    const modeRegistry = {
        analysis: {
            mode: "analysis",
            execute: (p) => !rootPath
                ? Promise.resolve({
                    answer: "ERROR: Analysis mode requires a project root. Please scan a repository first.",
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
        if (!modeImpl)
            throw new Error(`Unknown mode: ${mode}`);
        const result = await modeImpl.execute({ ...rest, rootPath, traceId });
        (0, metrics_1.recordTaskMetrics)({
            traceId,
            mode,
            timestamp: startMs,
            latencyMs: Date.now() - startMs,
            criticScore: result.criticScore,
        });
        return result;
    }
    catch (err) {
        (0, metrics_1.recordTaskMetrics)({
            traceId,
            mode,
            timestamp: startMs,
            latencyMs: Date.now() - startMs,
            error: err instanceof Error ? err.message : String(err),
        });
        throw err;
    }
}
async function runAnalysisTask(params) {
    const { question, graph, nodeId, history, apiKeyOpenAI, apiKeyClaude, findings, rootPath, traceId, jiraConfig, jiraProjectKey, rail, } = params;
    const resolvedRoot = path.resolve(rootPath);
    const rootExists = fs.existsSync(resolvedRoot);
    const hasFiles = rootExists &&
        fs
            .readdirSync(resolvedRoot, { withFileTypes: true })
            .some((e) => !e.name.startsWith("."));
    if (!rootExists || !hasFiles) {
        console.warn(`[manager] Preflight failed for rootPath=${resolvedRoot} | exists=${rootExists} | hasFiles=${hasFiles}`);
        return {
            answer: "ERROR: The source code for this project is missing or has been cleaned up. " +
                "Please re-scan the repository to regenerate the architecture graph, then try your question again.",
            graphCommand: undefined,
            criticReport: "Preflight check failed: projectRoot directory missing or empty. Manager aborted to avoid hallucinations.",
            criticScore: 0,
            traceId,
        };
    }
    console.log(`[manager] runAnalysisTask | rootPath=${resolvedRoot} | question="${question.slice(0, 80)}${question.length > 80 ? "…" : ""}"`);
    let localHistory = history ?? [];
    try {
        const skillMatches = [...question.matchAll(/skill\s+['"]?([\w-]+)['"]?/gi)];
        for (const m of skillMatches) {
            const skillId = m[1];
            const indexPath = path.join(resolvedRoot, ".agent", "skill_index.json");
            if (fs.existsSync(indexPath)) {
                const raw = fs.readFileSync(indexPath, "utf8");
                const parsed = JSON.parse(raw);
                const skills = Array.isArray(parsed.skills) ? parsed.skills : [];
                const skillMeta = skills.find((s) => s.id === skillId && typeof s.path === "string");
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
                                role: "system",
                                content: `CRITICAL CONTEXT: You are refactoring or using the existing skill '${skillId}'. ` +
                                    `Here is its current implementation:\n\n\`\`\`\n${skillCode}\n\`\`\``,
                            },
                        ];
                    }
                }
            }
        }
    }
    catch (err) {
        console.warn(`[manager] Librarian pre-hook failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const route = (0, questionRouter_1.routeQuestion)(question, graph, findings ?? [], nodeId, history);
    let attempts = 0;
    const maxAttempts = 2;
    let lastAnswer = "";
    let lastGraphCommand;
    let lastCriticReport = "";
    let lastCriticScore = 0;
    let lastProposal;
    let lastViolations = [];
    while (attempts < maxAttempts) {
        const claudeResult = await (0, claudeEnricher_1.askAboutArchitecture)(question, graph, nodeId, localHistory, apiKeyClaude, findings, rootPath, jiraConfig, jiraProjectKey, rail ?? undefined);
        lastAnswer = claudeResult.answer;
        lastGraphCommand = claudeResult.graphCommand;
        lastProposal = claudeResult.proposal;
        const usedSaveSkill = claudeResult.usedSaveSkill === true;
        const isNavigationOnly = route.intent === "show_layer" &&
            !!lastGraphCommand &&
            lastAnswer.trim().length < 120;
        const review = isNavigationOnly
            ? {
                approved: true,
                score: 10,
                report: "Navigation-only query; critic skipped.",
                violations: [],
            }
            : await (0, critic_1.reviewArchitectureAnswer)({
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
        if (lastGraphCommand &&
            lastGraphCommand.action === "filter_layer" &&
            /src\/agent/i.test(question)) {
            const agentNodeIds = graph.nodes
                .map((n) => n.id)
                .filter((id) => id
                .replace(/\\/g, "/")
                .replace(/^\.\//, "")
                .startsWith("src/agent"));
            if (agentNodeIds.length > 0) {
                lastGraphCommand = {
                    action: "highlight_nodes",
                    nodeIds: agentNodeIds.slice(0, 12),
                };
            }
        }
        const FALLBACK_MSG = "I was unable to formulate a complete answer.";
        const isUsageRequest = /use\s+(?:the\s+)?(?:['"]?\w+['"]?\s+)?skill|run\s+(?:the\s+)?\w+\s+skill|summarize\s+(?:all\s+)?(?:routes|interfaces|modules)|list\s+(?:all\s+)?(?:routes|interfaces)/i.test(question);
        if (lastAnswer.includes(FALLBACK_MSG) && attempts < maxAttempts - 1) {
            const chunkingHint = lastAnswer.length > 12000
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
        const askedForCode = /refactor|code|script|implement|write|save.*skill|save as/i.test(question);
        if (askedForCode &&
            !hasCodeBlock &&
            !review.approved &&
            attempts < maxAttempts - 1) {
            localHistory = [
                ...(localHistory ?? []),
                { role: "assistant", content: lastAnswer },
                {
                    role: "user",
                    content: "DIRECTIVE: You provided analysis but no code block. The user explicitly asked for code/script output. " +
                        "Do NOT provide more high-level analysis or tables. IMMEDIATELY output the full implementation in a markdown code block and finish.",
                },
            ];
            attempts += 1;
            continue;
        }
        if (askedForCode &&
            usedSaveSkill &&
            !hasCodeBlock &&
            attempts < maxAttempts - 1) {
            localHistory = [
                ...(localHistory ?? []),
                { role: "assistant", content: lastAnswer },
                {
                    role: "user",
                    content: "SYSTEM DIRECTIVE: You successfully saved the skill, but you did NOT show its code. " +
                        "IMMEDIATELY output the full saved implementation in a markdown code block and briefly summarize what it does. " +
                        "Do NOT provide additional analysis, tables, or commentary.",
                },
            ];
            attempts += 1;
            continue;
        }
        if (review.approved) {
            (0, templateLibrary_1.recordSuccessfulRun)({
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
        const chunkingNote = lastAnswer.length > 12000
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
    };
}
async function runGreenfieldTask(params) {
    const { question, history, apiKeyOpenAI, apiKeyClaude, traceId, } = params;
    console.log(`[manager] runGreenfieldTask | traceId=${traceId} | question="${question.slice(0, 80)}${question.length > 80 ? "…" : ""}"`);
    try {
        const useMock = process.env.USE_MOCK_GREENFIELD === "1" || process.env.USE_MOCK_GREENFIELD === "true";
        const greenfieldResult = useMock
            ? await (0, mockGreenfieldEnricher_1.askGreenfieldMock)({ question, history })
            : await (0, greenfieldEnricher_1.askGreenfield)({ question, history, apiKeyClaude });
        const archetype = (0, greenfieldEnricher_1.inferGreenfieldArchetype)(params.question);
        const rootPath = params.graph?.projectRoot && typeof params.graph.projectRoot === "string" && params.graph.projectRoot.trim()
            ? params.graph.projectRoot.trim()
            : null;
        const review = await (0, critic_1.reviewGreenfieldAnswer)({
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
    }
    catch (err) {
        if (err instanceof errors_1.ArchError)
            throw err;
        (0, errors_1.logArchError)(err, traceId, "runGreenfieldTask");
        const raw = err instanceof Error ? err.message : String(err);
        const lower = raw.toLowerCase();
        let code = errors_1.ErrorCode.UNKNOWN;
        if (lower.includes("rate") || lower.includes("429"))
            code = errors_1.ErrorCode.RATE_LIMIT;
        else if (lower.includes("api key") || lower.includes("401"))
            code = errors_1.ErrorCode.NO_API_KEY;
        else if (lower.includes("timeout") || lower.includes("econnreset"))
            code = errors_1.ErrorCode.TRANSIENT;
        else if (lower.includes("invalid") || lower.includes("parse"))
            code = errors_1.ErrorCode.LLM_PARSE_FAILURE;
        throw new errors_1.ArchError({
            code,
            userMessage: (0, errors_1.toUserMessage)(err, traceId),
            traceId,
            internal: raw,
        });
    }
}
