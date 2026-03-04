"use strict";
/**
 * greenfieldEnricher.ts
 *
 * Greenfield design mode: agent designs architecture from scratch (empty workspace).
 * Uses only the answer tool with graphCommand (create_node, connect); no retrieve_files, no scaffold.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateGraphCommand = void 0;
exports.askGreenfield = askGreenfield;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const validateGraphCommand_1 = require("./validateGraphCommand");
var validateGraphCommand_2 = require("./validateGraphCommand");
Object.defineProperty(exports, "validateGraphCommand", { enumerable: true, get: function () { return validateGraphCommand_2.validateGraphCommand; } });
const GREENFIELD_SYSTEM_PROMPT = `You are the Lead Software Architect.

There is no repository yet. Design the full architecture from scratch based on the user's request.

You must:
- Define layers (Presentation, Business Logic, Data Access, Infrastructure, External Services, Utilities, Configuration)
- Define modules (≤ 20 nodes; keep modules focused)
- Use create_node and connect to draw the initial system on the canvas
- Provide folder structure recommendations in your answer
- Justify design decisions in your answer

ALWAYS use the answer tool with graphCommands: an array of create_node and connect actions for the full architecture.

Rules:
- Do NOT include secrets, shell commands, or executable code in your design.
- Only suggest file names and example skeletons — no actual file content with secrets.
- Keep node IDs simple (e.g. "src/api", "services/auth", "ui/dashboard").
- For connect, use fromId and toId that match node IDs you created.`;
const GREENFIELD_TOOLS = [
    {
        name: "answer",
        description: "Your final response to the user. Always include a graphCommand with create_node and/or connect actions to draw the proposed architecture on the canvas.",
        input_schema: {
            type: "object",
            properties: {
                content: {
                    type: "string",
                    description: "Your architectural explanation, design rationale, folder structure recommendations, and justification.",
                },
                graphCommands: {
                    type: "array",
                    description: "Array of create_node and connect actions. Include one create_node per module, then connect for dependencies.",
                    items: {
                        type: "object",
                        properties: {
                            action: { type: "string", enum: ["create_node", "connect", "reset"] },
                            id: { type: "string", description: "Node ID (e.g. src/api, services/auth)" },
                            label: { type: "string", description: "Human-readable label" },
                            layer: {
                                type: "string",
                                enum: validateGraphCommand_1.VALID_LAYERS,
                                description: "Architectural layer",
                            },
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
    },
];
async function askGreenfield(params) {
    const { question, history = [], apiKeyClaude } = params;
    const client = apiKeyClaude
        ? new sdk_1.default({ apiKey: apiKeyClaude })
        : new sdk_1.default();
    const historyMessages = (history ?? [])
        .filter((h) => h.role === "user" || h.role === "assistant")
        .map((h) => ({ role: h.role, content: h.content }));
    const messages = historyMessages.length > 0
        ? [...historyMessages, { role: "user", content: question }]
        : [{ role: "user", content: question }];
    const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        system: GREENFIELD_SYSTEM_PROMPT,
        messages,
        tools: GREENFIELD_TOOLS,
        tool_choice: { type: "tool", name: "answer" },
    });
    let answer = "";
    const graphCommands = [];
    for (const block of response.content) {
        if (block.type === "text") {
            answer = block.text;
        }
        if (block.type === "tool_use" && block.name === "answer") {
            const input = block.input;
            const content = typeof input.content === "string" ? input.content : "";
            if (content)
                answer = content;
            const raw = input.graphCommands ?? input.graphCommand;
            if (Array.isArray(raw)) {
                for (const item of raw) {
                    const result = (0, validateGraphCommand_1.validateGraphCommand)(item);
                    if (result.valid && result.command.action !== "reset") {
                        graphCommands.push(result.command);
                    }
                    else if (result.valid === false && item) {
                        answer = `${answer}\n\n**Validation note:** One command could not be applied: ${result.error}.`;
                    }
                }
            }
            else if (raw && typeof raw === "object") {
                const result = (0, validateGraphCommand_1.validateGraphCommand)(raw);
                if (result.valid && result.command.action !== "reset") {
                    graphCommands.push(result.command);
                }
                else if (result.valid === false) {
                    answer = `${answer}\n\n**Validation note:** The proposed graph command could not be applied: ${result.error}. Please try rephrasing your design.`;
                }
            }
        }
    }
    return {
        answer: answer || "I've designed the architecture. Check the canvas for the proposed modules and connections.",
        graphCommands: graphCommands.length > 0 ? graphCommands : undefined,
    };
}
