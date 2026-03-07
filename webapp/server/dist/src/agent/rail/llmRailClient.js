"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callRailLLM = callRailLLM;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const context_1 = require("./context");
const traceLogger_1 = require("../traceLogger");
async function callRailLLM(params) {
    const { rail, fullHistory, tokenBudget, model, systemBase, userContent, tools, toolChoice, apiKey, } = params;
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
        throw new Error("Anthropic API key not configured. Set archVisualizer.anthropicApiKey or ANTHROPIC_API_KEY.");
    }
    const client = new sdk_1.default({ apiKey: key });
    const railHistory = (0, context_1.buildRailContext)(rail, fullHistory, tokenBudget);
    const systemRail = `You are executing rail ${rail.id}.\n` +
        `Frozen outcome: ${rail.frozenOutcome ?? rail.outcome}.\n` +
        "Do not change the outcome; every step must move toward this outcome only.\n" +
        "Do not introduce new goals, alter the specification, or expand scope beyond this rail.\n";
    const systemMessages = railHistory
        .filter((m) => m.role === "system")
        .map((m) => m.content);
    const systemPrompt = [systemRail, ...systemMessages, systemBase]
        .filter(Boolean)
        .join("\n\n");
    const priorTurns = railHistory.filter((m) => m.role === "user" || m.role === "assistant");
    const messages = [
        ...priorTurns,
        { role: "user", content: userContent },
    ];
    const response = await client.messages.create({
        model,
        max_tokens: 8192,
        temperature: 0,
        system: systemPrompt,
        tools,
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        messages,
    });
    const totalTokens = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
    (0, traceLogger_1.emitTrace)("llm_call", { railId: rail.id, role: "executor" }, { stopReason: response.stop_reason, usage: response.usage }, "Rail LLM call");
    return { response };
}
