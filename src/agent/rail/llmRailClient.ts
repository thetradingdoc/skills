import Anthropic from "@anthropic-ai/sdk";
import type { ArchitectureChatHistory } from "../../types";
import type { Rail } from "../types";
import { buildRailContext } from "./context";
import { emitTrace } from "../traceLogger";

export interface RailLLMCallParams {
  rail: Rail;
  fullHistory: ArchitectureChatHistory;
  tokenBudget: number;
  model: string;
  systemBase: string;
  userContent: string;
  tools?: Anthropic.Tool[];
  toolChoice?: Anthropic.MessageCreateParams["tool_choice"];
  apiKey?: string;
}

export async function callRailLLM(
  params: RailLLMCallParams
): Promise<{
  response: Anthropic.Message;
}> {
  const {
    rail,
    fullHistory,
    tokenBudget,
    model,
    systemBase,
    userContent,
    tools,
    toolChoice,
    apiKey,
  } = params;

  const key = apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Anthropic API key not configured. Set archVisualizer.anthropicApiKey or ANTHROPIC_API_KEY."
    );
  }

  const client = new Anthropic({ apiKey: key });

  const railHistory = buildRailContext(rail, fullHistory, tokenBudget);
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

  const priorTurns = railHistory.filter(
    (m): m is { role: "user" | "assistant"; content: string } =>
      m.role === "user" || m.role === "assistant"
  );

  const messages: Anthropic.MessageParam[] = [
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

  const totalTokens =
    (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  emitTrace(
    "llm_call",
    { railId: rail.id, role: "executor" },
    { stopReason: response.stop_reason, usage: response.usage },
    "Rail LLM call"
  );

  return { response };
}

