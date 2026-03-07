"use strict";
/**
 * claudeEnricher.ts
 *
 * Claude-based reasoning engine using Anthropic SDK with native tool use.
 * Drop-in replacement for askAboutArchitecture in enricher-retrieval.ts.
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.askAboutArchitecture = askAboutArchitecture;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const traceLogger_1 = require("../agent/traceLogger");
const sessionPersistence_1 = require("../agent/sessionPersistence");
const skillStore_1 = require("../agent/skillStore");
const questionRouter_1 = require("./questionRouter");
const retriever_1 = require("./retriever");
const tools_1 = require("./tools");
const toolExec = __importStar(require("./tools"));
const graphCommandMatcher_1 = require("./graphCommandMatcher");
const context_1 = require("../agent/rail/context");
const VALID_LAYERS = [
    "Presentation",
    "Business Logic",
    "Data Access",
    "Infrastructure",
    "External Services",
    "Utilities",
    "Configuration",
    "Uncategorized",
];
function isValidLayer(v) {
    return VALID_LAYERS.includes(v);
}
function parseGraphCommand(raw) {
    if (!raw || typeof raw !== "object")
        return undefined;
    const o = raw;
    if (o.action === "highlight_nodes" && Array.isArray(o.nodeIds)) {
        const nodeIds = o.nodeIds.filter((id) => typeof id === "string");
        if (nodeIds.length > 0)
            return { action: "highlight_nodes", nodeIds };
    }
    if (o.action === "filter_layer" && typeof o.layer === "string" && isValidLayer(o.layer)) {
        return { action: "filter_layer", layer: o.layer };
    }
    if (o.action === "filter_edge_type" && typeof o.edgeType === "string") {
        const edgeType = o.edgeType;
        if (["arch", "drift", "violations", "all"].includes(edgeType)) {
            return { action: "filter_edge_type", edgeType };
        }
    }
    if (o.action === "focus_node" && typeof o.nodeId === "string") {
        return { action: "focus_node", nodeId: o.nodeId };
    }
    if (o.action === "reset")
        return { action: "reset" };
    if (o.action === "create_node" && typeof o.id === "string" && typeof o.label === "string" && typeof o.layer === "string" && isValidLayer(o.layer)) {
        return {
            action: "create_node",
            id: o.id,
            label: o.label,
            layer: o.layer,
            description: typeof o.description === "string" ? o.description : undefined,
            archNodeId: typeof o.archNodeId === "string" ? o.archNodeId : undefined,
        };
    }
    if (o.action === "connect" && typeof o.fromId === "string" && typeof o.toId === "string") {
        const edgeType = typeof o.edgeType === "string" ? o.edgeType : undefined;
        return {
            action: "connect",
            fromId: o.fromId,
            toId: o.toId,
            edgeType,
        };
    }
    if (o.action === "trace_path" && Array.isArray(o.nodeIds)) {
        const nodeIds = o.nodeIds.filter((id) => typeof id === "string");
        if (nodeIds.length > 0) {
            return {
                action: "trace_path",
                nodeIds,
                intensity: typeof o.intensity === "number" ? o.intensity : undefined,
            };
        }
    }
    return undefined;
}
const TOOLS = [
    {
        name: "retrieve_files",
        description: "Retrieve source file contents to answer questions about the codebase. " +
            "Use this when you need to see actual code, not just module summaries.",
        input_schema: {
            type: "object",
            properties: {
                files: {
                    type: "array",
                    items: { type: "string" },
                    description: "File paths relative to project root. Max 6 per call. " +
                        "Use paths from the available_paths list only.",
                },
                reason: {
                    type: "string",
                    description: "Why you need these files — what you expect to find.",
                },
            },
            required: ["files"],
        },
    },
    {
        name: "scaffold_node",
        description: "Create or update a module scaffold on disk for a proposed architecture node. Use this after a new node design is confirmed.",
        input_schema: {
            type: "object",
            properties: {
                archNodeId: {
                    type: "string",
                    description: "Stable archNodeId to write into file headers (e.g. 'routes/auth').",
                },
                relPath: {
                    type: "string",
                    description: "Directory or file path relative to project root where the scaffold should live (e.g. 'services/cache').",
                },
                layer: {
                    type: "string",
                    description: "Optional layer name (Presentation, Business Logic, etc.).",
                },
                kind: {
                    type: "string",
                    description: "Optional module kind (service, route, adapter, etc.).",
                },
            },
            required: ["archNodeId", "relPath"],
        },
    },
    {
        name: "telemetry_tail",
        description: "Tail structured logs to inspect runtime behavior for a specific requestId or route. Use this when the user asks to trace a live/request flow.",
        input_schema: {
            type: "object",
            properties: {
                requestId: {
                    type: "string",
                    description: "Optional request ID or correlation ID to filter logs.",
                },
                route: {
                    type: "string",
                    description: "Optional route or path fragment to filter logs.",
                },
            },
        },
    },
    {
        name: "jira_create_ticket",
        description: "Create a Jira issue for an architectural violation or bug, tagging it with archNodeId so it links back to the graph.",
        input_schema: {
            type: "object",
            properties: {
                projectKey: {
                    type: "string",
                    description: "Jira project key (e.g. ARCH, ENG).",
                },
                summary: {
                    type: "string",
                    description: "Short summary of the issue.",
                },
                description: {
                    type: "string",
                    description: "Longer description, including findings and context.",
                },
                archNodeId: {
                    type: "string",
                    description: "archNodeId for the affected node, used as a label.",
                },
                labels: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional extra labels.",
                },
            },
            required: ["projectKey", "summary"],
        },
    },
    {
        name: "jira_search_by_archNodeId",
        description: "Search Jira for issues tagged with a given archNodeId label. Use this to connect the graph to existing tickets.",
        input_schema: {
            type: "object",
            properties: {
                archNodeId: {
                    type: "string",
                    description: "Label value archNodeId:<id> that was used when creating tickets.",
                },
                maxResults: {
                    type: "integer",
                    description: "Maximum number of issues to return (default 10).",
                },
            },
            required: ["archNodeId"],
        },
    },
    {
        name: "run_skill",
        description: "Execute a previously saved skill from the .agent/skills folder and return its output. Use this when the user asks to USE a skill (e.g. summarize routes) rather than to create one.",
        input_schema: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "Skill ID (e.g. 'map-routes'). Must match an id in skill_index.json.",
                },
                args: {
                    type: "string",
                    description: "Optional CLI arguments to pass to the skill (e.g. '--json').",
                },
            },
            required: ["id"],
        },
    },
    {
        name: "save_skill",
        description: "Persist a small reusable script or plan into the Skill Library under .agent/skills. " +
            "Use this when you create a general-purpose helper that will likely be useful in future tasks.",
        input_schema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Short identifier for the skill, used as the file base name. Use letters, numbers, and underscores only.",
                },
                description: {
                    type: "string",
                    description: "One sentence describing what this skill does and when to use it.",
                },
                language: {
                    type: "string",
                    enum: ["typescript", "python", "bash", "other"],
                    description: "Language of the code snippet. Determines file extension.",
                },
                code: {
                    type: "string",
                    description: "The full source code for the skill.",
                },
                tags: {
                    type: "array",
                    items: { type: "string" },
                    description: "Optional tags for this skill, e.g. ['refactor','typescript','git']. Helps with future lookup.",
                },
            },
            required: ["name", "description", "language", "code"],
        },
    },
    {
        name: "grep_codebase",
        description: "Search for a string or pattern across all source files. " +
            "Use to find callers, implementations, or usages of a function/route/class.",
        input_schema: {
            type: "object",
            properties: {
                pattern: {
                    type: "string",
                    description: "String to search for (exact match, case-sensitive).",
                },
            },
            required: ["pattern"],
        },
    },
    {
        name: "read_file",
        description: "Read a single file's full contents.",
        input_schema: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "File path relative to project root.",
                },
            },
            required: ["path"],
        },
    },
    {
        name: "run_command",
        description: "Run an allowed command and see its output. " +
            "Use for type-checking (npx tsc --noEmit), linting, or tests.",
        input_schema: {
            type: "object",
            properties: {
                command: {
                    type: "string",
                    description: "Command to run. Allowed: npx tsc --noEmit, npx eslint src, npm test, npm run <script>",
                },
            },
            required: ["command"],
        },
    },
    {
        name: "propose_architecture",
        description: "Propose new architectural components before writing any code. " +
            "Use this when the user asks to BUILD, ADD, or CREATE something new.",
        input_schema: {
            type: "object",
            properties: {
                summary: { type: "string" },
                nodes: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string" },
                            label: { type: "string" },
                            layer: { type: "string", enum: VALID_LAYERS },
                            description: { type: "string" },
                            files: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        purpose: { type: "string" },
                                        todos: { type: "array", items: { type: "string" } },
                                    },
                                    required: ["name", "purpose", "todos"],
                                },
                            },
                            connectsTo: { type: "array", items: { type: "string" } },
                        },
                        required: ["id", "label", "layer", "description", "files", "connectsTo"],
                    },
                },
                reuses: { type: "array", items: { type: "string" } },
                rationale: { type: "string" },
            },
            required: ["summary", "nodes", "reuses", "rationale"],
        },
    },
    {
        name: "answer",
        description: "Provide the final answer to the user's question.",
        input_schema: {
            type: "object",
            properties: {
                content: { type: "string" },
                graphCommand: {
                    type: "object",
                    properties: {
                        action: {
                            type: "string",
                            enum: [
                                "filter_layer",
                                "filter_edge_type",
                                "highlight_nodes",
                                "focus_node",
                                "reset",
                                "create_node",
                                "connect",
                                "trace_path",
                            ],
                        },
                        layer: { type: "string" },
                        edgeType: { type: "string" },
                        nodeIds: { type: "array", items: { type: "string" } },
                        nodeId: { type: "string" },
                        id: { type: "string" },
                        label: { type: "string" },
                        description: { type: "string" },
                        archNodeId: { type: "string" },
                        fromId: { type: "string" },
                        toId: { type: "string" },
                        intensity: { type: "number" },
                    },
                    required: ["action"],
                },
            },
            required: ["content"],
        },
    },
];
function loadProjectMemory(graph) {
    const root = graph.projectRoot ?? "";
    if (!root)
        return "";
    const memoryPath = path.join(root, ".archy.md");
    try {
        if (!fs.existsSync(memoryPath))
            return "";
        const content = fs.readFileSync(memoryPath, "utf-8").trim();
        if (!content)
            return "";
        return `\n\n## Project memory (.archy.md)\n${content}`;
    }
    catch {
        return "";
    }
}
function buildSystemPrompt(graph) {
    const base = `You are a senior software architect embedded in the ${graph.projectName ?? "this"} codebase.

You reason in layers, understand module boundaries, and use tools to inspect real code before making claims.

When the user asks to build something new, always propose_architecture first before any code is written.

You have a persistent Skill Library under .agent/skills and an index in .agent/skill_index.json.
- When you create a small, reusable helper script or code-based tool, call save_skill with a clear name, description, language, code, and optional tags.
- When the user asks to USE a skill (e.g. "use map-routes to summarize routes", "run the list-interfaces skill", "summarize all routes"), you MUST call the run_skill tool with that skill's id, then call the answer tool with a concise summary of the tool output. Do not reply with "I was unable to formulate" when the skill is listed in the Skill Library — execute it and report.
- Prefer reusing existing skills via the run_skill tool over re-implementing the same logic in every conversation.
- IMPORTANT: If the user explicitly says "save it as a skill called X" or similar, you MUST:
  1) Implement the script or helper, and
  2) Call save_skill with name "X" (or the exact name they gave) and the code, instead of only replying with code in text.`;
    const memory = loadProjectMemory(graph);
    const navInstructions = `

## Canvas navigation
When the user asks to show, find, highlight, or navigate to something:
- ALWAYS use the answer tool with a graphCommand — never reply with text only.
- Use focus_node for a single module, highlight_nodes for a set, filter_layer for a whole layer.
- Use exact node IDs from the architecture context, not labels.
- If nothing matches, use graphCommand.action="reset" and explain what wasn't found.

## Convergence rules
1. Every task MUST end with a call to the answer tool. Do not finish a conversation without calling the answer tool at least once.
2. After you successfully save a skill with save_skill, your next and final step is to call the answer tool to summarize what you did for the user and finish the task.
3. For requests that ask to use or run a skill (e.g. "summarize routes using map-routes"), call run_skill with that skill's id, then call answer with a short summary of the output. Do not answer with inability when the skill exists in the Skill Library.
4. If tools such as read_file, retrieve_files, grep_codebase, or run_command fail repeatedly (for example, due to "File not found"), stop searching and instead provide the best possible implementation or explanation based on the architecture context, then call the answer tool.
5. For long enumerations (route maps, interface lists, module summaries): prefer full enumeration per file or section; avoid placeholder text like "(Inspect file for full list)". If output would be very long, list key items and add "... (N more)" or summarize by section so the response is not truncated.`;
    return base + memory + navInstructions;
}
function buildGraphContext(graph, relevantNodeIds, intent, findings, codeContext, focusNodeId, history, question, availablePaths) {
    const isOverview = intent === "overview" || intent === "show_layer" || relevantNodeIds.length === 0;
    const nodesToShow = isOverview
        ? graph.nodes
        : graph.nodes.filter((n) => relevantNodeIds.includes(n.id));
    const displayNodes = nodesToShow.length === 0 ? graph.nodes : nodesToShow;
    const nodeLines = displayNodes
        .map((n) => `- ${n.suggestedLabel ?? n.label} (${n.layer ?? "?"}) [${n.id}]: ${n.description ?? ""}`)
        .join("\n");
    const relevantIds = new Set(displayNodes.map((n) => n.id));
    const edgeLines = graph.edges
        .filter((e) => relevantIds.has(e.source) || relevantIds.has(e.target))
        .slice(0, 25)
        .map((e) => {
        const src = graph.nodes.find((n) => n.id === e.source)?.suggestedLabel ?? e.source;
        const tgt = graph.nodes.find((n) => n.id === e.target)?.suggestedLabel ?? e.target;
        return `  ${src} → ${tgt}${e.isDrift ? " ⚠ DRIFT" : ""}${e.isLayerViolation ? " ⛔ VIOLATION" : ""}`;
    })
        .join("\n");
    const findingLines = findings.length > 0
        ? findings
            .slice(0, 20)
            .map((f) => `- [${f.severity}] ${f.type}: ${f.description} (${f.location})`)
            .join("\n")
        : "None detected.";
    const focusNode = focusNodeId
        ? graph.nodes.find((n) => n.id === focusNodeId)
        : undefined;
    const focusLine = focusNode
        ? `\nUser is focused on: ${focusNode.suggestedLabel ?? focusNode.label} [${focusNode.id}] — ${focusNode.layer}\n${focusNode.description ?? ""}`
        : "";
    const conversationTurns = history?.filter((h) => h.role === "user" || h.role === "assistant") ?? [];
    const historyLines = conversationTurns.length > 0
        ? `\nConversation history:\n${conversationTurns
            .slice(-4)
            .map((h) => `${h.role}: ${h.content.slice(0, 300)}`)
            .join("\n")}\n`
        : "";
    const pathList = [...availablePaths].slice(0, 50).join("\n");
    return `## Architecture
${nodeLines}

## Connections
${edgeLines}

## Static analysis findings
${findingLines}

${codeContext ? `## Retrieved code\n${codeContext}\n` : ""}${focusLine}

## Available file paths
${pathList}

${historyLines}## Question
${question}`;
}
async function executeTool(toolName, toolInput, basePath, graph, availablePaths, keywords, jiraContext) {
    switch (toolName) {
        case "retrieve_files": {
            const files = toolInput.files ?? [];
            const validPaths = files
                .filter((p) => typeof p === "string" && availablePaths.has(p))
                .slice(0, 6)
                .map((p) => path.join(basePath, p));
            if (validPaths.length === 0) {
                return {
                    result: "No valid paths provided. Use paths from the available file paths list exactly as shown.",
                };
            }
            const retrieved = (0, retriever_1.retrieveFileSnippets)(basePath, validPaths, graph, keywords);
            return { result: retrieved.formatted || "Files were empty or not found." };
        }
        case "grep_codebase": {
            const pattern = toolInput.pattern;
            const res = (0, tools_1.executeGrep)(basePath, pattern);
            if (res.results && res.results.length > 0) {
                return {
                    result: res.results
                        .slice(0, 30)
                        .map((r) => `${r.file}:${r.line} ${r.text}`)
                        .join("\n"),
                };
            }
            return { result: res.error ?? `No matches found for "${pattern}".` };
        }
        case "read_file": {
            const filePath = toolInput.path;
            const res = (0, tools_1.executeReadFile)(basePath, filePath);
            return { result: res.result ?? `Error: ${res.error}` };
        }
        case "run_command": {
            const command = toolInput.command;
            const res = (0, tools_1.executeRunCommand)(basePath, command);
            if (res.error)
                return { result: `Error: ${res.error}` };
            return { result: res.result ?? "Command completed with no output." };
        }
        case "run_skill": {
            const id = String(toolInput.id ?? "").trim();
            const args = String(toolInput.args ?? "").trim() || undefined;
            if (!basePath) {
                return {
                    result: "Cannot run skill: project root is unknown. Ensure graph.projectRoot is set.",
                };
            }
            if (!id) {
                return { result: "Cannot run skill: id is required." };
            }
            const res = (0, tools_1.executeRunSkill)(basePath, id, args);
            if (res.error) {
                return { result: `Error running skill '${id}': ${res.error}` };
            }
            return { result: res.result ?? "Skill completed with no output." };
        }
        case "propose_architecture": {
            return {
                result: `Architecture proposal created with ${(toolInput.nodes ?? []).length} new modules. Awaiting user approval.`,
                proposal: toolInput,
            };
        }
        case "save_skill": {
            const name = String(toolInput.name ?? "").trim();
            const description = String(toolInput.description ?? "").trim();
            const language = String(toolInput.language ?? "typescript").trim();
            const code = String(toolInput.code ?? "");
            const tagsInput = toolInput.tags;
            const tags = Array.isArray(tagsInput) && tagsInput.every((t) => typeof t === "string")
                ? tagsInput
                : [];
            console.log(`[save_skill] Requested skill "${name}" | language=${language} | codeLength=${code.length}`);
            if (!basePath) {
                return {
                    result: "Cannot save skill: project root is unknown. Ensure graph.projectRoot is set.",
                };
            }
            if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
                return {
                    result: "Skill name is required and must contain only letters, numbers, underscores, or hyphens.",
                };
            }
            if (!code.trim()) {
                return { result: "Cannot save empty skill code." };
            }
            // Map language to file extension
            let ext = ".ts";
            if (language === "python")
                ext = ".py";
            else if (language === "bash")
                ext = ".sh";
            const skillsDir = path.join(basePath, ".agent", "skills");
            // Basic sandboxing: ensure we only ever write under .agent/skills
            try {
                if (!fs.existsSync(skillsDir)) {
                    fs.mkdirSync(skillsDir, { recursive: true });
                }
            }
            catch (err) {
                return {
                    result: `Failed to prepare skills directory: ${err instanceof Error ? err.message : String(err)}`,
                };
            }
            const fileName = `${name}${ext}`;
            const absPath = path.join(skillsDir, fileName);
            // Extra safety: ensure the resolved path stays under skillsDir
            const resolved = path.resolve(absPath);
            const resolvedSkillsDir = path.resolve(skillsDir);
            if (!resolved.startsWith(resolvedSkillsDir)) {
                return {
                    result: "Refused to save skill: resolved path escapes the .agent/skills directory.",
                };
            }
            try {
                fs.writeFileSync(absPath, code, "utf-8");
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[save_skill] Failed to write skill file: ${msg}`);
                return {
                    result: `Failed to write skill file: ${msg}`,
                };
            }
            const relPath = path
                .relative(basePath, absPath)
                .replace(/\\/g, "/");
            try {
                (0, skillStore_1.registerSkill)(basePath, {
                    id: name,
                    description,
                    path: relPath,
                    language,
                    tags,
                });
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`[save_skill] Failed to update skill index: ${msg}`);
                return {
                    result: `Skill file saved, but failed to update skill index: ${msg}`,
                };
            }
            const successMsg = `Skill '${name}' saved successfully at ${relPath}.`;
            return {
                result: `${successMsg}

IMPORTANT: You have fulfilled the skill creation for this request.
- You MUST now call the answer tool to summarize what you did for the user and finish the task.
- Do not call more search tools (retrieve_files, grep_codebase, run_command) unless absolutely necessary.
- Focus on explaining how to use this skill in the future and, if relevant, what it discovered.`,
            };
        }
        case "scaffold_node": {
            if (!basePath) {
                return {
                    result: "Cannot scaffold node: project root is unknown. Ensure graph.projectRoot is set.",
                };
            }
            const archNodeId = String(toolInput.archNodeId ?? "").trim();
            const relPath = String(toolInput.relPath ?? "").trim();
            const layer = typeof toolInput.layer === "string"
                ? toolInput.layer
                : undefined;
            const kind = typeof toolInput.kind === "string"
                ? toolInput.kind
                : undefined;
            if (!archNodeId || !relPath) {
                return {
                    result: "archNodeId and relPath are required to scaffold a node.",
                };
            }
            const res = toolExec.executeScaffoldNode(basePath, {
                archNodeId,
                relPath,
                layer,
                kind,
            });
            return {
                result: res.result ?? `Error scaffolding node: ${res.error}`,
            };
        }
        case "telemetry_tail": {
            const params = {
                requestId: typeof toolInput.requestId === "string"
                    ? toolInput.requestId
                    : undefined,
                route: typeof toolInput.route === "string"
                    ? toolInput.route
                    : undefined,
            };
            const res = toolExec.executeTelemetryTail(basePath, params);
            return {
                result: res.result ?? `Telemetry error: ${res.error}`,
            };
        }
        case "jira_create_ticket": {
            const fromInput = String(toolInput.projectKey ?? "").trim();
            const projectKey = fromInput || (jiraContext?.projectKey ?? "");
            const summary = String(toolInput.summary ?? "").trim();
            const description = typeof toolInput.description === "string"
                ? toolInput.description
                : undefined;
            const archNodeId = typeof toolInput.archNodeId === "string"
                ? toolInput.archNodeId
                : undefined;
            const labelsInput = toolInput.labels;
            const labels = Array.isArray(labelsInput) && labelsInput.every((t) => typeof t === "string")
                ? labelsInput
                : undefined;
            if (!projectKey || !summary) {
                return {
                    result: "summary is required. projectKey is required (provide in tool input or set workspace Jira project key).",
                };
            }
            const res = await toolExec.executeJiraCreateTicket(basePath, { projectKey, summary, description, archNodeId, labels }, jiraContext);
            return {
                result: res.result ?? `Jira error: ${res.error}`,
            };
        }
        case "jira_search_by_archNodeId": {
            const archNodeId = String(toolInput.archNodeId ?? "").trim();
            const maxResultsRaw = toolInput.maxResults;
            const maxResults = typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw)
                ? maxResultsRaw
                : 10;
            if (!archNodeId) {
                return { result: "archNodeId is required to search Jira issues." };
            }
            const res = await toolExec.executeJiraSearchByArchNodeId(basePath, archNodeId, maxResults, jiraContext);
            return {
                result: res.result ?? `Jira search error: ${res.error}`,
            };
        }
        default:
            return { result: `Unknown tool: ${toolName}` };
    }
}
async function askAboutArchitecture(question, graph, nodeId, history, apiKey, findings, rootPath, jiraConfig, jiraProjectKey, rail) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) {
        return {
            answer: "[No API key] Set ANTHROPIC_API_KEY or archVisualizer.anthropicApiKey to enable Claude reasoning.",
        };
    }
    const client = new sdk_1.default({ apiKey: key });
    const allFindings = findings ?? [];
    const basePath = rootPath ?? graph.projectRoot;
    const hist = history ?? [];
    const railContext = rail && rail.logicPath?.length
        ? (0, context_1.buildRailContext)(rail, hist, 500)
        : [];
    const route = (0, questionRouter_1.routeQuestion)(question, graph, allFindings, nodeId, history);
    // Pre-resolve possible navigation targets from the query
    const matchResult = (0, graphCommandMatcher_1.matchQueryToGraph)(question, graph);
    // Detect explicit "save as skill" intent so we can strongly steer tool use.
    const skillSaveMatch = question.match(/save (?:it |this )?as a skill(?: called| named)?\s+["']?([\w\-]+)["']?/i);
    const forcedSkillName = skillSaveMatch?.[1]?.trim() ?? null;
    // Detect "use / run skill X" so we prefer run_skill over save_skill on first step.
    const useSkillMatch = question.match(/(?:use|run)\s+(?:the\s+)?(?:['"]?([\w\-]+)['"]?\s+)?skill|skill\s+['"]?([\w\-]+)['"]?\s+to\s+(?:summarize|list)/i);
    const forcedRunSkillId = (useSkillMatch?.[1] ?? useSkillMatch?.[2])?.trim() ?? null;
    const isUsageRequest = !!forcedRunSkillId || /summarize\s+(?:all\s+)?(?:routes|interfaces|modules)|list\s+(?:all\s+)?(?:routes|interfaces)/i.test(question);
    let codeContext = "";
    if (route.filesToRead.length > 0) {
        const retrieved = (0, retriever_1.retrieveFileSnippets)(basePath, route.filesToRead, graph, route.keywords);
        codeContext = retrieved.formatted;
    }
    const availablePaths = new Set();
    for (const n of graph.nodes) {
        for (const f of n.files.filter((f) => /\.(ts|tsx|js|jsx|py|md|json)$/.test(f) && !/\.test\.|\.spec\./.test(f))) {
            const norm = f.replace(/\\/g, "/").replace(/^\.\//, "");
            availablePaths.add(norm);
        }
    }
    let contextText = buildGraphContext(graph, route.relevantNodeIds, route.intent, route.relevantFindings, codeContext, nodeId, history, question, availablePaths);
    // Surface the Skill Library so Claude can see and reuse existing skills.
    if (basePath) {
        const skillsText = (0, skillStore_1.formatSkillSummary)(basePath, 20);
        if (skillsText) {
            contextText += `\n\n## Skill Library (from .agent/skill_index.json)\n${skillsText}\n`;
        }
    }
    // If the user explicitly asked to save something as a named skill,
    // prepend a hard instruction so Claude is much more likely to call save_skill.
    if (forcedSkillName) {
        contextText =
            `INSTRUCTION: The user explicitly asked you to save your solution as a reusable skill named "${forcedSkillName}". ` +
                `You MUST implement the script or helper and then call the save_skill tool with name="${forcedSkillName}". ` +
                `Do not only reply with code in text; persist it via save_skill so it is available in future sessions.\n\n` +
                contextText;
    }
    // If the user asked to USE a skill (summarize/list with a skill), prefer run_skill first.
    if (isUsageRequest && !forcedSkillName) {
        const skillHint = forcedRunSkillId
            ? `Call run_skill with id="${forcedRunSkillId}" first, then answer with a summary of the output.`
            : "Call run_skill with the appropriate skill id from the Skill Library (e.g. map-routes, list-interfaces), then answer with a summary of the output.";
        contextText =
            `INSTRUCTION: The user asked to use a skill to summarize or list. ${skillHint} Do NOT call save_skill for this request.\n\n` +
                contextText;
    }
    // If we matched nodes for navigation, append them so Claude sees concrete IDs
    if (matchResult.isNavigation && matchResult.matchedNodeIds.length > 0) {
        contextText +=
            "\n\n" +
                (0, graphCommandMatcher_1.formatMatchedNodesForPrompt)(matchResult.matchedNodeIds, graph) +
                `\n\nMATCH REASON: ${matchResult.reason}\n` +
                "Use these exact ids in any graphCommand you emit.";
    }
    else if (matchResult.isNavigation) {
        contextText +=
            `\n\n[Navigation intent detected but no nodes matched "${question}". ` +
                "If you cannot confidently identify modules, use graphCommand.action=\"reset\".]";
    }
    // Inject rail context (outcome, state, logic path, session digest) into the system prompt.
    const railSystemContent = railContext
        .filter((h) => h.role === "system")
        .map((h) => h.content)
        .join("\n\n");
    // Inject any system messages from history (e.g. Librarian skill code) into the system prompt.
    const systemFromHistory = (history ?? [])
        .filter((h) => h.role === "system")
        .map((h) => h.content)
        .join("\n\n");
    const systemParts = [railSystemContent, systemFromHistory].filter(Boolean).join("\n\n");
    const systemPrompt = systemParts.length > 0
        ? systemParts + "\n\n" + buildSystemPrompt(graph)
        : buildSystemPrompt(graph);
    // Prepend rail session turns as prior messages (user/assistant) so Claude sees the rail context.
    const railPriorTurns = railContext.filter((h) => h.role === "user" || h.role === "assistant");
    const messages = [
        ...railPriorTurns,
        { role: "user", content: contextText },
    ];
    const MAX_STEPS = 6;
    let finalAnswer = "";
    let finalGraphCommand;
    let proposal;
    let usedSaveSkill = false;
    const jiraContext = jiraConfig || jiraProjectKey
        ? { config: jiraConfig, projectKey: jiraProjectKey ?? undefined }
        : undefined;
    try {
        for (let step = 0; step < MAX_STEPS; step++) {
            const response = await client.messages.create({
                model: "claude-sonnet-4-6",
                max_tokens: 2048,
                temperature: 0.2,
                system: systemPrompt,
                tools: TOOLS,
                // When we know a skill save is required, force save_skill on first step.
                // When the user asked to use a skill (not save), force run_skill on first step.
                ...(forcedSkillName && step === 0
                    ? { tool_choice: { type: "tool", name: "save_skill" } }
                    : isUsageRequest && step === 0
                        ? { tool_choice: { type: "tool", name: "run_skill" } }
                        : {}),
                messages,
            });
            const totalTokens = (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);
            if (basePath)
                (0, sessionPersistence_1.bumpSessionUsage)(basePath, { tokenUsage: totalTokens, llmCallCount: 1 });
            (0, traceLogger_1.emitTrace)("llm_call", { role: "architect", step: step + 1, nodeId, question }, {
                stopReason: response.stop_reason,
                usage: response.usage,
                contentTypes: response.content.map((b) => b.type),
            }, "Claude architect response");
            const textBlocks = response.content.filter((b) => b.type === "text");
            const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
            messages.push({ role: "assistant", content: response.content });
            if (response.stop_reason === "end_turn") {
                const text = textBlocks.map((b) => b.text).join("\n").trim();
                if (text)
                    finalAnswer = text;
                // Fallback: navigation query with matched nodes but no answer tool call.
                // Synthesize a graphCommand from matchResult so the canvas still updates.
                if (!finalGraphCommand && matchResult.isNavigation && matchResult.matchedNodeIds.length > 0) {
                    if (matchResult.matchedNodeIds.length === 1) {
                        finalGraphCommand = {
                            action: "focus_node",
                            nodeId: matchResult.matchedNodeIds[0],
                        };
                    }
                    else {
                        finalGraphCommand = {
                            action: "highlight_nodes",
                            nodeIds: matchResult.matchedNodeIds,
                        };
                    }
                }
                break;
            }
            if (toolUseBlocks.length === 0) {
                const text = textBlocks.map((b) => b.text).join("\n").trim();
                if (text)
                    finalAnswer = text;
                break;
            }
            const toolResults = [];
            // Execute non-answer tools first so that side effects (like save_skill)
            // occur even if answer is also present in the same tool_use batch.
            const actionTools = toolUseBlocks.filter((t) => t.name !== "answer");
            const answerTool = toolUseBlocks.find((t) => t.name === "answer");
            for (const toolUse of actionTools) {
                (0, traceLogger_1.emitTrace)("llm_reasoning", { tool: toolUse.name, input: toolUse.input, step: step + 1 }, {}, "Claude requested tool");
                if (toolUse.name === "save_skill") {
                    usedSaveSkill = true;
                }
                const { result, proposal: prop } = await executeTool(toolUse.name, toolUse.input, basePath, graph, availablePaths, route.keywords, jiraContext);
                if (prop)
                    proposal = prop;
                (0, traceLogger_1.emitTrace)("llm_call", { tool: toolUse.name, step: step + 1 }, { result: result.slice(0, 800), proposal: prop ? true : false }, "Tool executed for Claude");
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: result.slice(0, 8000),
                });
            }
            if (answerTool) {
                (0, traceLogger_1.emitTrace)("llm_reasoning", { tool: answerTool.name, input: answerTool.input, step: step + 1 }, {}, "Claude requested tool");
                const input = answerTool.input;
                finalAnswer = input.content;
                if (input.graphCommand) {
                    finalGraphCommand = parseGraphCommand(input.graphCommand);
                }
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: answerTool.id,
                    content: "Answer recorded.",
                });
            }
            if (finalAnswer)
                break;
            messages.push({ role: "user", content: toolResults });
        }
        if (!finalAnswer) {
            const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
            if (lastAssistant && Array.isArray(lastAssistant.content)) {
                const texts = lastAssistant.content
                    .filter((b) => b.type === "text")
                    .map((b) => b.text);
                finalAnswer =
                    texts.join("\n").trim() ||
                        "I was unable to formulate a complete answer. Try asking more specifically.";
            }
        }
        // Global fallback: if this was a navigation query with matches but no graphCommand,
        // synthesize one so the canvas still updates.
        if (!finalGraphCommand && matchResult.isNavigation && matchResult.matchedNodeIds.length > 0) {
            if (matchResult.matchedNodeIds.length === 1) {
                finalGraphCommand = {
                    action: "focus_node",
                    nodeId: matchResult.matchedNodeIds[0],
                };
            }
            else {
                finalGraphCommand = {
                    action: "highlight_nodes",
                    nodeIds: matchResult.matchedNodeIds,
                };
            }
        }
        return {
            answer: finalAnswer,
            ...(finalGraphCommand ? { graphCommand: finalGraphCommand } : {}),
            ...(proposal ? { proposal } : {}),
            ...(usedSaveSkill ? { usedSaveSkill: true } : {}),
        };
    }
    catch (err) {
        return {
            answer: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
    }
}
