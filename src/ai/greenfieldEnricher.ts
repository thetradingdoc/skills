/**
 * greenfieldEnricher.ts
 *
 * Greenfield design mode: agent designs architecture from scratch (empty workspace).
 * Uses only the answer tool with graphCommand (create_node, connect); no retrieve_files, no scaffold.
 * When Jira is configured, also offers create_jira_issue and jira_search_by_archNodeId.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ArchitectureChatHistory, GraphCommand } from "../types";
import { validateGraphCommand, VALID_LAYERS, VALID_EDGE_RELATIONS } from "./validateGraphCommand";
import { executeJiraCreateTicket, executeJiraSearchByArchNodeId } from "./tools";

export type { GraphCommandValidationResult } from "./validateGraphCommand";
export { validateGraphCommand } from "./validateGraphCommand";

export type GreenfieldArchetype =
  | "saas-web-app"
  | "api-service"
  | "data-pipeline"
  | "monolith-split"
  | "greenfield-materialize";

export function inferGreenfieldArchetype(question: string): GreenfieldArchetype {
  const q = question.toLowerCase();
  if (/saas|web app|full.?stack|frontend|react|vue|angular|spa/i.test(q)) return "saas-web-app";
  if (/api service|rest api|graphql|microservice|backend only/i.test(q)) return "api-service";
  if (/data pipeline|etl|ingestion|streaming|batch processing/i.test(q)) return "data-pipeline";
  if (/monolith|split|modularize|extract module/i.test(q)) return "monolith-split";
  return "greenfield-materialize";
}

export type GreenfieldAskResult = {
  answer: string;
  /** Multiple create_node/connect commands per turn */
  graphCommands?: GraphCommand[];
  /** Single command for backwards compat */
  graphCommand?: GraphCommand;
};

const GREENFIELD_SYSTEM_PROMPT = `You are the Lead Software Architect.

There is no repository yet. Design the full architecture from scratch based on the user's request.

You must:
- Define layers (Presentation, Business Logic, Data Access, Infrastructure, External Services, Utilities, Configuration)
- Define modules (≤ 20 nodes; keep modules focused)
- Use create_node and connect to draw the initial system on the canvas
- Provide folder structure recommendations in your answer
- Justify design decisions in your answer

ALWAYS use the answer tool with graphCommands: an array of create_node and connect actions for the full architecture.

For every create_node, write a description that is a real, specific sentence about what that module does in this design (its responsibility, what it talks to, why it exists) — not a placeholder like "handles X" with no detail. A non-expert reading only the description should understand the module's job.

For every connect, set relation to the semantic meaning of that edge, chosen from: ${VALID_EDGE_RELATIONS.join(", ")}. Pick the relation that actually describes what crosses the edge (e.g. "calls" for a request, "reads"/"writes" for data access, "publishes"/"subscribes" for async messaging, "authenticates_via" for auth checks, "caches" for cache reads, "depends_on" for a generic build-time/runtime dependency with no clearer relation). Do not leave relation unset — every connect should carry one.

Rules:
- Do NOT include secrets, shell commands, or executable code in your design.
- Only suggest file names and example skeletons — no actual file content with secrets.
- Keep node IDs simple (e.g. "src/api", "services/auth", "ui/dashboard").
- For connect, use fromId and toId that match node IDs you created.`;

const JIRA_TOOLS: Anthropic.Tool[] = [
  {
    name: "create_jira_issue",
    description:
      "Create a Jira issue/epic for a module or design task. Use when the user wants to track design work in Jira.",
    input_schema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Jira project key" },
        summary: { type: "string", description: "Short summary" },
        description: { type: "string", description: "Longer description" },
        archNodeId: { type: "string", description: "archNodeId for the module (used as label)" },
        labels: { type: "array", items: { type: "string" } },
      },
      required: ["projectKey", "summary"],
    },
  },
  {
    name: "jira_search_by_archNodeId",
    description: "Search Jira for issues tagged with archNodeId.",
    input_schema: {
      type: "object",
      properties: {
        archNodeId: { type: "string" },
        maxResults: { type: "integer" },
      },
      required: ["archNodeId"],
    },
  },
];

const GREENFIELD_TOOLS_BASE: Anthropic.Tool[] = [
  {
    name: "answer",
    description:
      "Your final response to the user. Always include a graphCommand with create_node and/or connect actions to draw the proposed architecture on the canvas.",
    input_schema: {
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
              layer: {
                type: "string",
                enum: VALID_LAYERS,
                description: "Architectural layer",
              },
              description: {
                type: "string",
                description:
                  "Required for create_node. A specific sentence describing this module's responsibility and role in the design — not a generic placeholder.",
              },
              archNodeId: { type: "string" },
              fromId: { type: "string" },
              toId: { type: "string" },
              edgeType: { type: "string", enum: ["import", "reexport", "dynamic"] },
              relation: {
                type: "string",
                enum: VALID_EDGE_RELATIONS,
                description:
                  "Required for connect. The semantic meaning of this edge (calls, reads, writes, publishes, subscribes, authenticates_via, caches, depends_on).",
              },
              skeletonCode: {
                type: "string",
                description:
                  "Optional minimal skeleton or stub code for this module. Use sparingly; actual implementation comes from implement/materialize.",
              },
              layoutHint: {
                type: "string",
                description:
                  "Optional layout hint for canvas (e.g. left, center, right) to influence auto-arrangement.",
              },
              group: {
                type: "string",
                description: "Optional group ID to cluster related nodes visually.",
              },
            },
            required: ["action"],
          },
        },
      },
      required: ["content"],
    },
  },
];

function buildGreenfieldTools(jiraConfig?: { baseUrl: string; email: string; apiToken: string } | null, jiraProjectKey?: string | null): Anthropic.Tool[] {
  if (jiraConfig && (jiraConfig.baseUrl || jiraConfig.apiToken)) {
    return [...GREENFIELD_TOOLS_BASE, ...JIRA_TOOLS];
  }
  return GREENFIELD_TOOLS_BASE;
}

export async function askGreenfield(params: {
  question: string;
  history?: ArchitectureChatHistory;
  apiKeyClaude?: string;
  pdfBase64?: string;
  pdfFileName?: string;
  contextBlock?: string;
  jiraConfig?: { baseUrl: string; email: string; apiToken: string } | null;
  jiraProjectKey?: string | null;
}): Promise<GreenfieldAskResult> {
  const { question, history = [], apiKeyClaude, pdfBase64, pdfFileName, contextBlock, jiraConfig, jiraProjectKey } = params;

  const client = apiKeyClaude
    ? new Anthropic({ apiKey: apiKeyClaude })
    : new Anthropic();

  const historyMessages = (history ?? [])
    .filter((h): h is { role: "user" | "assistant"; content: string } => h.role === "user" || h.role === "assistant")
    .map((h) => ({ role: h.role as "user" | "assistant", content: h.content })) as Anthropic.MessageParam[];
  const questionWithContext = contextBlock ? `${contextBlock}\n\n## Question\n${question}` : question;
  const lastUserContent: Anthropic.MessageParam["content"] =
    pdfBase64 && pdfBase64.length > 0
      ? [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf" as const,
              data: pdfBase64,
            },
          },
          { type: "text", text: questionWithContext },
        ]
      : questionWithContext;
  const messages: Anthropic.MessageParam[] =
    historyMessages.length > 0
      ? [...historyMessages, { role: "user" as const, content: lastUserContent }]
      : [{ role: "user" as const, content: lastUserContent }];

  const tools = buildGreenfieldTools(jiraConfig, jiraProjectKey);
  const hasJira = tools.length > GREENFIELD_TOOLS_BASE.length;
  const jiraContext = hasJira && jiraConfig
    ? { config: jiraConfig, projectKey: jiraProjectKey ?? undefined }
    : undefined;
  const basePath = process.cwd();

  const MAX_STEPS = hasJira ? 3 : 1;
  let currentMessages: Anthropic.MessageParam[] = messages;
  let answer = "";
  let graphCommands: GraphCommand[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: GREENFIELD_SYSTEM_PROMPT + (hasJira ? "\n\nWhen Jira is available, you may create issues or epics for modules before providing your final answer." : ""),
    messages: currentMessages,
    tools,
    tool_choice: step === 0 && hasJira ? "auto" : { type: "tool", name: "answer" },
  });

  let toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

  for (const block of response.content) {
    if (block.type === "text") {
      answer = block.text;
    }
    if (block.type === "tool_use") {
      if (block.name === "answer") {
        const input = block.input as Record<string, unknown>;
        const content = typeof input.content === "string" ? input.content : "";
        if (content) answer = content;
        const raw = input.graphCommands ?? input.graphCommand;
        if (Array.isArray(raw)) {
          for (const item of raw) {
            const result = validateGraphCommand(item);
            if (result.valid && result.command.action !== "reset") {
              graphCommands.push(result.command);
            } else if (result.valid === false && item) {
              answer = `${answer}\n\n**Validation note:** One command could not be applied: ${result.error}.`;
            }
          }
        } else if (raw && typeof raw === "object") {
          const result = validateGraphCommand(raw);
          if (result.valid && result.command.action !== "reset") {
            graphCommands.push(result.command);
          } else if (result.valid === false) {
            answer = `${answer}\n\n**Validation note:** The proposed graph command could not be applied: ${result.error}. Please try rephrasing your design.`;
          }
        }
      } else {
        toolUseBlocks.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
      }
    }
  }

  if (toolUseBlocks.length === 0) break;

  const assistantContent: Anthropic.MessageParam["content"] = response.content as Anthropic.TextBlock[];
  const toolResults: Anthropic.ToolResultBlockParam[] = [];
  for (const tu of toolUseBlocks) {
    let result = "";
    if (tu.name === "create_jira_issue") {
      const r = await executeJiraCreateTicket(basePath, {
        projectKey: String(tu.input.projectKey ?? jiraProjectKey ?? ""),
        summary: String(tu.input.summary ?? ""),
        description: typeof tu.input.description === "string" ? tu.input.description : undefined,
        archNodeId: typeof tu.input.archNodeId === "string" ? tu.input.archNodeId : undefined,
        labels: Array.isArray(tu.input.labels) ? (tu.input.labels as string[]) : undefined,
      }, jiraContext);
      result = r.result ?? r.error ?? "Jira create failed.";
    } else if (tu.name === "jira_search_by_archNodeId") {
      const r = await executeJiraSearchByArchNodeId(
        basePath,
        String(tu.input.archNodeId ?? ""),
        typeof tu.input.maxResults === "number" ? tu.input.maxResults : 10,
        jiraContext
      );
      result = r.result ?? r.error ?? "Jira search failed.";
    }
    toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: result });
  }
  currentMessages = [
    ...currentMessages,
    { role: "assistant", content: assistantContent },
    { role: "user", content: toolResults },
  ];
  }

  return {
    answer: answer || "I've designed the architecture. Check the canvas for the proposed modules and connections.",
    graphCommands: graphCommands.length > 0 ? graphCommands : undefined,
  };
}

/** Streaming variant: yields text chunks via onTextChunk. Use when no Jira tools (single-turn only). */
export async function askGreenfieldStream(params: {
  question: string;
  history?: ArchitectureChatHistory;
  apiKeyClaude?: string;
  pdfBase64?: string;
  pdfFileName?: string;
  contextBlock?: string;
  jiraConfig?: { baseUrl: string; email: string; apiToken: string } | null;
  onTextChunk?: (chunk: string) => void;
}): Promise<GreenfieldAskResult> {
  const { onTextChunk, jiraConfig, ...rest } = params;
  if (!onTextChunk || (jiraConfig && jiraConfig.apiToken)) {
    return askGreenfield({ ...rest, jiraConfig });
  }
  const client = rest.apiKeyClaude ? new Anthropic({ apiKey: rest.apiKeyClaude }) : new Anthropic();
  const historyMessages = (rest.history ?? [])
    .filter((h): h is { role: "user" | "assistant"; content: string } => h.role === "user" || h.role === "assistant")
    .map((h) => ({ role: h.role as "user" | "assistant", content: h.content })) as Anthropic.MessageParam[];
  const questionWithContext = rest.contextBlock ? `${rest.contextBlock}\n\n## Question\n${rest.question}` : rest.question;
  const lastUserContent: Anthropic.MessageParam["content"] =
    rest.pdfBase64 && rest.pdfBase64.length > 0
      ? [
          { type: "document", source: { type: "base64", media_type: "application/pdf" as const, data: rest.pdfBase64 } },
          { type: "text", text: questionWithContext },
        ]
      : questionWithContext;
  const messages: Anthropic.MessageParam[] =
    historyMessages.length > 0
      ? [...historyMessages, { role: "user" as const, content: lastUserContent }]
      : [{ role: "user" as const, content: lastUserContent }];

  const stream = client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: GREENFIELD_SYSTEM_PROMPT,
    messages,
    tools: GREENFIELD_TOOLS_BASE,
    tool_choice: { type: "tool" as const, name: "answer" as const },
  });

  stream.on("text", (delta: string) => onTextChunk(delta));
  const message = await stream.finalMessage();
  let answer = "";
  const graphCommands: GraphCommand[] = [];
  for (const block of message.content) {
    if (block.type === "text") answer = block.text;
    if (block.type === "tool_use" && block.name === "answer") {
      const input = block.input as Record<string, unknown>;
      const content = typeof input.content === "string" ? input.content : "";
      if (content) answer = content;
      const raw = input.graphCommands ?? input.graphCommand;
      if (Array.isArray(raw)) {
        for (const item of raw) {
          const result = validateGraphCommand(item);
          if (result.valid && result.command.action !== "reset") graphCommands.push(result.command);
        }
      } else if (raw && typeof raw === "object") {
        const result = validateGraphCommand(raw);
        if (result.valid && result.command.action !== "reset") graphCommands.push(result.command);
      }
    }
  }
  return {
    answer: answer || "I've designed the architecture. Check the canvas for the proposed modules and connections.",
    graphCommands: graphCommands.length > 0 ? graphCommands : undefined,
  };
}
