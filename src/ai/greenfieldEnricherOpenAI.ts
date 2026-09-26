/**
 * greenfieldEnricherOpenAI.ts
 *
 * OpenAI-backed variant of greenfield design mode: same contract as askGreenfield
 * (src/ai/greenfieldEnricher.ts), but calls OpenAI chat.completions with function-calling
 * instead of Anthropic Claude. Selected via GREENFIELD_PROVIDER=openai in .env.
 */

import OpenAI from "openai";
import type { ArchitectureChatHistory, GraphCommand } from "../types";
import { validateGraphCommand, VALID_LAYERS } from "./validateGraphCommand";

export type GreenfieldOpenAIAskResult = {
  answer: string;
  graphCommands?: GraphCommand[];
  graphCommand?: GraphCommand;
};

const GREENFIELD_SYSTEM_PROMPT = `You are the Lead Software Architect.

There is no repository yet. Design the full architecture from scratch based on the user's request.

You must:
- Define layers (Presentation, Business Logic, Data Access, Infrastructure, External Services, Utilities, Configuration)
- Define modules (<= 20 nodes; keep modules focused)
- Use create_node and connect to draw the initial system on the canvas
- Provide folder structure recommendations in your answer
- Justify design decisions in your answer

ALWAYS call the answer function with graphCommands: an array of create_node and connect actions for the full architecture.

Rules:
- Do NOT include secrets, shell commands, or executable code in your design.
- Only suggest file names and example skeletons -- no actual file content with secrets.
- Keep node IDs simple (e.g. "src/api", "services/auth", "ui/dashboard").
- For connect, use fromId and toId that match node IDs you created.`;

const ANSWER_FUNCTION = {
  name: "answer",
  description:
    "Your final response to the user. Always include graphCommands with create_node and/or connect actions to draw the proposed architecture on the canvas.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description:
          "Your architectural explanation, design rationale, folder structure recommendations, and justification.",
      },
      graphCommands: {
        type: "array",
        description:
          "Array of create_node and connect actions. Include one create_node per module, then connect for dependencies.",
        items: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["create_node", "connect", "reset"] },
            id: { type: "string", description: "Node ID (e.g. src/api, services/auth)" },
            label: { type: "string", description: "Human-readable label" },
            layer: { type: "string", enum: VALID_LAYERS, description: "Architectural layer" },
            description: { type: "string" },
            archNodeId: { type: "string" },
            fromId: { type: "string" },
            toId: { type: "string" },
            edgeType: { type: "string", enum: ["import", "reexport", "dynamic"] },
          },
          required: ["action"],
        },
      },
    },
    required: ["content"],
  },
};

export async function askGreenfieldOpenAI(params: {
  question: string;
  history?: ArchitectureChatHistory;
  contextBlock?: string;
  apiKeyOpenAI?: string;
}): Promise<GreenfieldOpenAIAskResult> {
  const { question, history = [], contextBlock, apiKeyOpenAI } = params;
  const key = apiKeyOpenAI ?? process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to webapp/server/.env to use GREENFIELD_PROVIDER=openai."
    );
  }
  const client = new OpenAI({ apiKey: key });
  const model = process.env.OPENAI_GREENFIELD_MODEL?.trim() || "gpt-4o";

  const historyMessages = (history ?? [])
    .filter(
      (h): h is { role: "user" | "assistant"; content: string } =>
        h.role === "user" || h.role === "assistant"
    )
    .map((h) => ({ role: h.role as "user" | "assistant", content: h.content }));

  const userContent = contextBlock ? `${contextBlock}\n\n---\n\n${question}` : question;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: GREENFIELD_SYSTEM_PROMPT },
    ...historyMessages,
    { role: "user", content: userContent },
  ];

  const completion = await client.chat.completions.create({
    model,
    messages,
    tools: [{ type: "function", function: ANSWER_FUNCTION as any }],
    tool_choice: { type: "function", function: { name: "answer" } },
  });

  const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
  let answer = completion.choices[0]?.message?.content ?? "";
  const graphCommands: GraphCommand[] = [];

  if (toolCall && toolCall.function?.name === "answer") {
    try {
      const input = JSON.parse(toolCall.function.arguments || "{}");
      if (typeof input.content === "string" && input.content) answer = input.content;
      const raw = input.graphCommands ?? input.graphCommand;
      const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const item of items) {
        const result = validateGraphCommand(item);
        if (result.valid && result.command.action !== "reset") {
          graphCommands.push(result.command);
        } else if (result.valid === false && item) {
          answer = `${answer}\n\n**Validation note:** One command could not be applied: ${result.error}.`;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      answer = answer || `Could not parse OpenAI's structured response: ${msg}`;
    }
  }

  return {
    answer:
      answer ||
      "I've designed the architecture. Check the canvas for the proposed modules and connections.",
    graphCommands: graphCommands.length > 0 ? graphCommands : undefined,
  };
}
