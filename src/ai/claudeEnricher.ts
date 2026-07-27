/**
 * claudeEnricher.ts
 *
 * Claude-based reasoning engine using Anthropic SDK with native tool use.
 * Drop-in replacement for askAboutArchitecture in enricher-retrieval.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import * as fs from "fs";
import * as path from "path";
import type {
  ArchGraph,
  ArchitectureChatHistory,
  ContractFinding,
  GraphCommand,
  NodeLayer,
} from "../types";
import { emitTrace } from "../agent/traceLogger";
import { bumpSessionUsage } from "../agent/sessionPersistence";
import { registerSkill, formatSkillSummary } from "../agent/skillStore";
import { routeQuestion } from "./questionRouter";
import { retrieveFileSnippets } from "./retriever";
import {
  executeReadFile,
  executeGrep,
  executeRunCommand,
  executeRunSkill,
} from "./tools";
import * as toolExec from "./tools";
import { matchQueryToGraph, formatMatchedNodesForPrompt } from "./graphCommandMatcher";
import { buildRailContext } from "../agent/rail/context";
import { estimateTokens, trimHistoryToBudget, trimTextToBudget } from "./contextTrim";
import { CONTEXT_WINDOW_SAFE } from "../agent/tokenBudget";

export type AskResult = {
  answer: string;
  graphCommand?: GraphCommand;
  proposal?: unknown;
  usedSaveSkill?: boolean;
  /** Token usage from Claude responses (aggregated across steps). */
  tokenUsage?: { input: number; output: number };
  /** Reasoning steps (tool calls, intermediate conclusions) for explainability. */
  reasoningTrace?: string[];
  /** Citations linking claims to nodes, edges, or files. */
  citations?: Array<{ label: string; nodeId?: string; edgeId?: string; filePath?: string }>;
};

const VALID_LAYERS: NodeLayer[] = [
  "Presentation",
  "Business Logic",
  "Data Access",
  "Infrastructure",
  "External Services",
  "Utilities",
  "Configuration",
  "Uncategorized",
];

function isValidLayer(v: string): v is NodeLayer {
  return VALID_LAYERS.includes(v as NodeLayer);
}

function parseGraphCommand(raw: unknown): GraphCommand | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  if (o.action === "highlight_nodes" && Array.isArray(o.nodeIds)) {
    const nodeIds = o.nodeIds.filter((id): id is string => typeof id === "string");
    if (nodeIds.length > 0) return { action: "highlight_nodes", nodeIds };
  }
  if (o.action === "filter_layer" && typeof o.layer === "string" && isValidLayer(o.layer)) {
    return { action: "filter_layer", layer: o.layer };
  }
  if (o.action === "filter_edge_type" && typeof o.edgeType === "string") {
    const edgeType = o.edgeType as "arch" | "drift" | "violations" | "all";
    if (["arch", "drift", "violations", "all"].includes(edgeType)) {
      return { action: "filter_edge_type", edgeType };
    }
  }
  if (o.action === "focus_node" && typeof o.nodeId === "string") {
    return { action: "focus_node", nodeId: o.nodeId };
  }
  if (o.action === "reset") return { action: "reset" };
  if (o.action === "create_node" && typeof o.id === "string" && typeof o.label === "string" && typeof o.layer === "string" && isValidLayer(o.layer as string)) {
    return {
      action: "create_node",
      id: o.id,
      label: o.label as string,
      layer: o.layer as NodeLayer,
      description: typeof o.description === "string" ? (o.description as string) : undefined,
      archNodeId: typeof o.archNodeId === "string" ? (o.archNodeId as string) : undefined,
    };
  }
  if (o.action === "connect" && typeof o.fromId === "string" && typeof o.toId === "string") {
    const edgeType = typeof o.edgeType === "string" ? (o.edgeType as "import" | "reexport" | "dynamic") : undefined;
    return {
      action: "connect",
      fromId: o.fromId as string,
      toId: o.toId as string,
      edgeType,
    };
  }
  if (o.action === "trace_path" && Array.isArray(o.nodeIds)) {
    const nodeIds = o.nodeIds.filter((id): id is string => typeof id === "string");
    if (nodeIds.length > 0) {
      return {
        action: "trace_path",
        nodeIds,
        intensity: typeof o.intensity === "number" ? (o.intensity as number) : undefined,
      };
    }
  }
  return undefined;
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "retrieve_files",
    description:
      "Retrieve source file contents to answer questions about the codebase. " +
      "Use this when you need to see actual code, not just module summaries.",
    input_schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "File paths relative to project root. Max 6 per call. " +
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
    description:
      "Create or update a module scaffold on disk for a proposed architecture node. Use this after a new node design is confirmed.",
    input_schema: {
      type: "object",
      properties: {
        archNodeId: {
          type: "string",
          description:
            "Stable archNodeId to write into file headers (e.g. 'routes/auth').",
        },
        relPath: {
          type: "string",
          description:
            "Directory or file path relative to project root where the scaffold should live (e.g. 'services/cache').",
        },
        layer: {
          type: "string",
          description: "Optional layer name (Presentation, Business Logic, etc.).",
        },
        kind: {
          type: "string",
          description: "Optional module kind (service, route, adapter, etc.).",
        },
        template: {
          type: "string",
          enum: ["api_route", "service"],
          description: "Optional scaffold template: api_route for Express handlers, service for service layer.",
        },
        readme: {
          type: "boolean",
          description: "If true, create a README.md in the scaffolded directory.",
        },
        test: {
          type: "boolean",
          description: "If true, create a .test.ts stub file.",
        },
      },
      required: ["archNodeId", "relPath"],
    },
  },
  {
    name: "telemetry_tail",
    description:
      "Tail structured logs to inspect runtime behavior for a specific requestId or route. Use this when the user asks to trace a live/request flow.",
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
    description:
      "Create a Jira issue for an architectural violation or bug, tagging it with archNodeId so it links back to the graph.",
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
    description:
      "Search Jira for issues tagged with a given archNodeId label. Use this to connect the graph to existing tickets.",
    input_schema: {
      type: "object",
      properties: {
        archNodeId: {
          type: "string",
          description:
            "Label value archNodeId:<id> that was used when creating tickets.",
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
    name: "jira_watch",
    description:
      "Check the latest Jira issues for a given archNodeId label. Call this periodically to \"watch\" an issue or module over time.",
    input_schema: {
      type: "object",
      properties: {
        archNodeId: {
          type: "string",
          description: "archNodeId for the module you want to watch (labels are stored as archNodeId:<id>).",
        },
        maxResults: {
          type: "integer",
          description: "Maximum number of issues to return (default 5).",
        },
      },
      required: ["archNodeId"],
    },
  },
  {
    name: "run_skill",
    description:
      "Execute a previously saved skill from the .agent/skills folder and return its output. Use this when the user asks to USE a skill (e.g. summarize routes) rather than to create one.",
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
    description:
      "Persist a small reusable script or plan into the Skill Library under .agent/skills. " +
      "Use this when you create a general-purpose helper that will likely be useful in future tasks.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Short identifier for the skill, used as the file base name. Use letters, numbers, and underscores only.",
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
          description:
            "Optional tags for this skill, e.g. ['refactor','typescript','git']. Helps with future lookup.",
        },
      },
      required: ["name", "description", "language", "code"],
    },
  },
  {
    name: "grep_codebase",
    description:
      "Search for a string or pattern across all source files. " +
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
    description:
      "Run an allowed command and see its output. " +
      "Use for type-checking (npx tsc --noEmit), linting, or tests.",
    input_schema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Command to run. Allowed: npx tsc --noEmit, npx eslint src, npm test, npm run <script>",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "propose_architecture",
    description:
      "Propose new architectural components before writing any code. " +
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

function loadProjectMemory(graph: ArchGraph): string {
  const root = graph.projectRoot ?? "";
  if (!root) return "";
  const memoryPath = path.join(root, ".archy.md");
  try {
    if (!fs.existsSync(memoryPath)) return "";
    const content = fs.readFileSync(memoryPath, "utf-8").trim();
    if (!content) return "";
    return `\n\n## Project memory (.archy.md)\n${content}`;
  } catch {
    return "";
  }
}

function buildSystemPrompt(graph: ArchGraph): string {
  const base = `You are a senior software architect embedded in the ${
    graph.projectName ?? "this"
  } codebase.

You reason in layers, understand module boundaries, and use tools to inspect real code before making claims.

When the user asks to build something new, always propose_architecture first before any code is written.

## Response formatting rules
- Use **bold** for section titles and emphasis, never ## markdown headers
- Use \`inline code\` for file paths, function names, variable names, and commands
- Use plain bullet points (—) for lists, not markdown bullets
- Write in clear prose paragraphs where possible, not just bullet lists
- Keep tables for structured comparisons only — not for simple lists
- Lead with the most important insight, then supporting detail

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

function buildGraphContext(
  graph: ArchGraph,
  relevantNodeIds: string[],
  intent: string,
  findings: ContractFinding[],
  codeContext: string,
  focusNodeId: string | undefined,
  history: ArchitectureChatHistory | undefined,
  question: string,
  availablePaths: Set<string>
): string {
  const isOverview =
    intent === "overview" || intent === "show_layer" || relevantNodeIds.length === 0;
  const nodesToShow = isOverview
    ? graph.nodes
    : graph.nodes.filter((n) => relevantNodeIds.includes(n.id));
  const displayNodes = nodesToShow.length === 0 ? graph.nodes : nodesToShow;

  const nodeLines = displayNodes
    .map(
      (n) =>
        `- ${n.suggestedLabel ?? n.label} (${n.layer ?? "?"}) [${n.id}]: ${
          n.description ?? ""
        }`
    )
    .join("\n");

  const relevantIds = new Set(displayNodes.map((n) => n.id));
  const edgeLines = graph.edges
    .filter((e) => relevantIds.has(e.source) || relevantIds.has(e.target))
    .slice(0, 25)
    .map((e) => {
      const src = graph.nodes.find((n) => n.id === e.source)?.suggestedLabel ?? e.source;
      const tgt = graph.nodes.find((n) => n.id === e.target)?.suggestedLabel ?? e.target;
      return `  ${src} → ${tgt}${e.isDrift ? " ⚠ DRIFT" : ""}${
        e.isLayerViolation ? " ⛔ VIOLATION" : ""
      }`;
    })
    .join("\n");

  const findingLines =
    findings.length > 0
      ? findings
          .slice(0, 20)
          .map(
            (f) =>
              `- [${f.severity}] ${f.type}: ${f.description} (${f.location})`
          )
          .join("\n")
      : "None detected.";

  const focusNode = focusNodeId
    ? graph.nodes.find((n) => n.id === focusNodeId)
    : undefined;
  const focusLine = focusNode
    ? `\nUser is focused on: ${
        focusNode.suggestedLabel ?? focusNode.label
      } [${focusNode.id}] — ${focusNode.layer}\n${focusNode.description ?? ""}`
    : "";

  const conversationTurns = history?.filter(
    (h): h is { role: "user" | "assistant"; content: string } =>
      h.role === "user" || h.role === "assistant"
  ) ?? [];
  const historyLines =
    conversationTurns.length > 0
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

interface JiraToolContext {
  config?: { baseUrl: string; email: string; apiToken: string };
  projectKey?: string;
}

function formatReasoningStep(
  toolName: string,
  input: Record<string, unknown>,
  result: string
): string {
  switch (toolName) {
    case "retrieve_files": {
      const files = (input.files as string[] ?? []).slice(0, 3);
      const count = (input.files as string[] ?? []).length;
      const names = files.map((f) => path.basename(f));
      return count > 0
        ? `Retrieved code from ${names.join(", ")}${count > 3 ? ` (+${count - 3} more)` : ""}`
        : "";
    }
    case "grep_codebase":
      return `Searched codebase for "${String(input.pattern ?? "").slice(0, 40)}"`;
    case "read_file":
      return `Read file ${String(input.path ?? "").slice(-60)}`;
    case "run_command":
      return `Ran command: ${String(input.command ?? "").slice(0, 50)}`;
    case "run_skill":
      return `Executed skill "${String(input.id ?? "")}"`;
    case "propose_architecture":
      return `Proposed architecture with ${((input.nodes as unknown[]) ?? []).length} new modules`;
    case "save_skill":
      return `Saved skill "${String(input.name ?? "")}"`;
    case "jira_watch":
    case "jira_create_ticket":
      return `Accessed Jira for ${String(input.archNodeId ?? "").slice(0, 30) || "issues"}`;
    default:
      return `Used ${toolName}`;
  }
}

function collectCitations(
  toolName: string,
  input: Record<string, unknown>,
  result: string,
  out: Map<string, { label: string; nodeId?: string; edgeId?: string; filePath?: string }>,
  relevantNodeIds: string[],
  graph: ArchGraph
): void {
  if (toolName === "retrieve_files") {
    const files = (input.files as string[]) ?? [];
    for (const f of files) {
      const key = `file:${f}`;
      if (!out.has(key)) {
        const node = graph.nodes.find((n) => n.files?.some((pf) => pf.includes(f) || f.includes(pf)));
        out.set(key, {
          label: path.basename(f),
          filePath: f,
          nodeId: node?.id,
        });
      }
    }
  } else if (toolName === "read_file") {
    const p = String(input.path ?? "");
    if (p) {
      const key = `file:${p}`;
      if (!out.has(key)) {
        const node = graph.nodes.find((n) => n.files?.some((pf) => pf.includes(p) || p.includes(pf)));
        out.set(key, { label: path.basename(p), filePath: p, nodeId: node?.id });
      }
    }
  }
  for (const nid of relevantNodeIds) {
    const key = `node:${nid}`;
    if (!out.has(key)) {
      const node = graph.nodes.find((n) => n.id === nid);
      out.set(key, {
        label: node?.label ?? node?.path ?? nid,
        nodeId: nid,
      });
    }
  }
}

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  basePath: string,
  graph: ArchGraph,
  availablePaths: Set<string>,
  keywords: string[],
  jiraContext?: JiraToolContext
): Promise<{ result: string; proposal?: unknown }> {
  switch (toolName) {
    case "retrieve_files": {
      const files = (toolInput.files as string[]) ?? [];
      const validPaths = files
        .filter((p) => typeof p === "string" && availablePaths.has(p))
        .slice(0, 6)
        .map((p) => path.join(basePath, p));
      if (validPaths.length === 0) {
        return {
          result:
            "No valid paths provided. Use paths from the available file paths list exactly as shown.",
        };
      }
      const retrieved = retrieveFileSnippets(basePath, validPaths, graph, keywords);
      return { result: retrieved.formatted || "Files were empty or not found." };
    }
    case "grep_codebase": {
      const pattern = toolInput.pattern as string;
      const res = executeGrep(basePath, pattern);
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
      const filePath = toolInput.path as string;
      const res = executeReadFile(basePath, filePath);
      return { result: res.result ?? `Error: ${res.error}` };
    }
    case "run_command": {
      const command = toolInput.command as string;
      const res = executeRunCommand(basePath, command);
      if (res.error) return { result: `Error: ${res.error}` };
      return { result: res.result ?? "Command completed with no output." };
    }
    case "run_skill": {
      const id = String(toolInput.id ?? "").trim();
      const args = String(toolInput.args ?? "").trim() || undefined;
      if (!basePath) {
        return {
          result:
            "Cannot run skill: project root is unknown. Ensure graph.projectRoot is set.",
        };
      }
      if (!id) {
        return { result: "Cannot run skill: id is required." };
      }
      const res = executeRunSkill(basePath, id, args);
      if (res.error) {
        return { result: `Error running skill '${id}': ${res.error}` };
      }
      return { result: res.result ?? "Skill completed with no output." };
    }
    case "propose_architecture": {
      return {
        result: `Architecture proposal created with ${
          ((toolInput.nodes as unknown[]) ?? []).length
        } new modules. Awaiting user approval.`,
        proposal: toolInput,
      };
    }
    case "save_skill": {
      const name = String(toolInput.name ?? "").trim();
      const description = String(toolInput.description ?? "").trim();
      const language = String(toolInput.language ?? "typescript").trim();
      const code = String(toolInput.code ?? "");
      const tagsInput = toolInput.tags as unknown;
      const tags =
        Array.isArray(tagsInput) && tagsInput.every((t) => typeof t === "string")
          ? (tagsInput as string[])
          : [];

      console.log(
        `[save_skill] Requested skill "${name}" | language=${language} | codeLength=${code.length}`
      );

      if (!basePath) {
        return {
          result:
            "Cannot save skill: project root is unknown. Ensure graph.projectRoot is set.",
        };
      }

      if (!name || !/^[a-zA-Z0-9_\-]+$/.test(name)) {
        return {
          result:
            "Skill name is required and must contain only letters, numbers, underscores, or hyphens.",
        };
      }
      if (!code.trim()) {
        return { result: "Cannot save empty skill code." };
      }

      // Map language to file extension
      let ext = ".ts";
      if (language === "python") ext = ".py";
      else if (language === "bash") ext = ".sh";

      const skillsDir = path.join(basePath, ".agent", "skills");
      // Basic sandboxing: ensure we only ever write under .agent/skills
      try {
        if (!fs.existsSync(skillsDir)) {
          fs.mkdirSync(skillsDir, { recursive: true });
        }
      } catch (err) {
        return {
          result: `Failed to prepare skills directory: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }

      const fileName = `${name}${ext}`;
      const absPath = path.join(skillsDir, fileName);

      // Extra safety: ensure the resolved path stays under skillsDir
      const resolved = path.resolve(absPath);
      const resolvedSkillsDir = path.resolve(skillsDir);
      if (!resolved.startsWith(resolvedSkillsDir)) {
        return {
          result:
            "Refused to save skill: resolved path escapes the .agent/skills directory.",
        };
      }

      try {
        fs.writeFileSync(absPath, code, "utf-8");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err);
        console.error(`[save_skill] Failed to write skill file: ${msg}`);
        return {
          result: `Failed to write skill file: ${msg}`,
        };
      }

      const relPath = path
        .relative(basePath, absPath)
        .replace(/\\/g, "/");

      try {
        registerSkill(basePath, {
          id: name,
          description,
          path: relPath,
          language,
          tags,
        });
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : String(err);
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
          result:
            "Cannot scaffold node: project root is unknown. Ensure graph.projectRoot is set.",
        };
      }
      const archNodeId = String(toolInput.archNodeId ?? "").trim();
      const relPath = String(toolInput.relPath ?? "").trim();
      const layer =
        typeof toolInput.layer === "string"
          ? (toolInput.layer as string)
          : undefined;
      const kind =
        typeof toolInput.kind === "string"
          ? (toolInput.kind as string)
          : undefined;
      const template =
        typeof toolInput.template === "string"
          ? (toolInput.template as string)
          : undefined;
      const readme =
        toolInput.readme === true || toolInput.readme === "true";
      const test = toolInput.test === true || toolInput.test === "true";
      if (!archNodeId || !relPath) {
        return {
          result:
            "archNodeId and relPath are required to scaffold a node.",
        };
      }
      const res = (toolExec as any).executeScaffoldNode(basePath, {
        archNodeId,
        relPath,
        layer,
        kind,
        template,
        readme,
        test,
      });
      return {
        result: res.result ?? `Error scaffolding node: ${res.error}`,
      };
    }
    case "telemetry_tail": {
      const params = {
        requestId:
          typeof toolInput.requestId === "string"
            ? (toolInput.requestId as string)
            : undefined,
        route:
          typeof toolInput.route === "string"
            ? (toolInput.route as string)
            : undefined,
      };
      const res = (toolExec as any).executeTelemetryTail(basePath, params);
      return {
        result: res.result ?? `Telemetry error: ${res.error}`,
      };
    }
    case "jira_create_ticket": {
      const fromInput = String(toolInput.projectKey ?? "").trim();
      const projectKey = fromInput || (jiraContext?.projectKey ?? "");
      const summary = String(toolInput.summary ?? "").trim();
      const description =
        typeof toolInput.description === "string"
          ? (toolInput.description as string)
          : undefined;
      const archNodeId =
        typeof toolInput.archNodeId === "string"
          ? (toolInput.archNodeId as string)
          : undefined;
      const labelsInput = toolInput.labels as unknown;
      const labels =
        Array.isArray(labelsInput) && labelsInput.every((t) => typeof t === "string")
          ? (labelsInput as string[])
          : undefined;
      if (!projectKey || !summary) {
        return {
          result:
            "summary is required. projectKey is required (provide in tool input or set workspace Jira project key).",
        };
      }
      const res = await (toolExec as any).executeJiraCreateTicket(
        basePath,
        { projectKey, summary, description, archNodeId, labels },
        jiraContext
      );
      return {
        result: res.result ?? `Jira error: ${res.error}`,
      };
    }
    case "jira_search_by_archNodeId": {
      const archNodeId = String(toolInput.archNodeId ?? "").trim();
      const maxResultsRaw = toolInput.maxResults;
      const maxResults =
        typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw)
          ? (maxResultsRaw as number)
          : 10;
      if (!archNodeId) {
        return { result: "archNodeId is required to search Jira issues." };
      }
      const res = await (toolExec as any).executeJiraSearchByArchNodeId(
        basePath,
        archNodeId,
        maxResults,
        jiraContext
      );
      return {
        result: res.result ?? `Jira search error: ${res.error}`,
      };
    }
    case "jira_watch": {
      const archNodeId = String(toolInput.archNodeId ?? "").trim();
      const maxResultsRaw = toolInput.maxResults;
      const maxResults =
        typeof maxResultsRaw === "number" && Number.isFinite(maxResultsRaw)
          ? (maxResultsRaw as number)
          : 5;
      if (!archNodeId) {
        return {
          result:
            "archNodeId is required to watch Jira issues. Pass the module's archNodeId (e.g. 'services/auth').",
        };
      }
      const res = await (toolExec as any).executeJiraSearchByArchNodeId(
        basePath,
        archNodeId,
        maxResults,
        jiraContext
      );
      return {
        result: res.result ?? `Jira watch error: ${res.error}`,
      };
    }
    default:
      return { result: `Unknown tool: ${toolName}` };
  }
}

export async function askAboutArchitecture(
  question: string,
  graph: ArchGraph,
  nodeId?: string,
  history?: ArchitectureChatHistory,
  apiKey?: string,
  findings?: ContractFinding[],
  rootPath?: string,
  jiraConfig?: { baseUrl: string; email: string; apiToken: string },
  jiraProjectKey?: string,
  rail?: { outcome: string; state: string; logicPath: Array<{ layer: string; nodeId: string }>; sessionId: string } | null,
  pdfBase64?: string,
  pdfFileName?: string,
  feedbackContext?: string
): Promise<AskResult> {
  const key = apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    return {
      answer:
        "[No API key] Set ANTHROPIC_API_KEY or archVisualizer.anthropicApiKey to enable Claude reasoning.",
    };
  }

  const client = new Anthropic({ apiKey: key });
  const allFindings = findings ?? [];
  const basePath = rootPath ?? graph.projectRoot;

  const hist = history ?? [];
  const railContext =
    rail && rail.logicPath?.length
      ? buildRailContext(rail as any, hist as any, 500)
      : [];

  const route = routeQuestion(question, graph, allFindings, nodeId, history);

  // Pre-resolve possible navigation targets from the query
  const matchResult = matchQueryToGraph(question, graph);

  // Detect explicit "save as skill" intent so we can strongly steer tool use.
  const skillSaveMatch = question.match(
    /save (?:it |this )?as a skill(?: called| named)?\s+["']?([\w\-]+)["']?/i
  );
  const forcedSkillName = skillSaveMatch?.[1]?.trim() ?? null;

  // Detect "use / run skill X" so we prefer run_skill over save_skill on first step.
  const useSkillMatch = question.match(
    /(?:use|run)\s+(?:the\s+)?(?:['"]?([\w\-]+)['"]?\s+)?skill|skill\s+['"]?([\w\-]+)['"]?\s+to\s+(?:summarize|list)/i
  );
  const forcedRunSkillId =
    (useSkillMatch?.[1] ?? useSkillMatch?.[2])?.trim() ?? null;
  const isUsageRequest = !!forcedRunSkillId || /summarize\s+(?:all\s+)?(?:routes|interfaces|modules)|list\s+(?:all\s+)?(?:routes|interfaces)/i.test(question);

  let codeContext = "";
  if (route.filesToRead.length > 0) {
    const retrieved = retrieveFileSnippets(
      basePath,
      route.filesToRead,
      graph,
      route.keywords
    );
    codeContext = retrieved.formatted;
  }

  const availablePaths = new Set<string>();
  for (const n of graph.nodes) {
    for (const f of (n.files ?? []).filter(
      (f) => /\.(ts|tsx|js|jsx|py|md|json)$/.test(f) && !/\.test\.|\.spec\./.test(f)
    )) {
      const norm = f.replace(/\\/g, "/").replace(/^\.\//, "");
      availablePaths.add(norm);
    }
  }

  let contextText = buildGraphContext(
    graph,
    route.relevantNodeIds,
    route.intent,
    route.relevantFindings,
    codeContext,
    nodeId,
    history,
    question,
    availablePaths
  );

  // Surface the Skill Library so Claude can see and reuse existing skills.
  if (basePath) {
    const skillsText = formatSkillSummary(basePath, 20);
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
      formatMatchedNodesForPrompt(matchResult.matchedNodeIds, graph) +
      `\n\nMATCH REASON: ${matchResult.reason}\n` +
      "Use these exact ids in any graphCommand you emit.";
  } else if (matchResult.isNavigation) {
    contextText +=
      `\n\n[Navigation intent detected but no nodes matched "${question}". ` +
      "If you cannot confidently identify modules, use graphCommand.action=\"reset\".]";
  }

  // Inject rail context (outcome, state, logic path, session digest) into the system prompt.
  const railSystemContent = railContext
    .filter((h: ArchitectureChatHistory[number]): h is { role: "system"; content: string } => h.role === "system")
    .map((h: { role: "system"; content: string }) => h.content)
    .join("\n\n");
  // Inject any system messages from history (e.g. Librarian skill code) into the system prompt.
  const systemFromHistory = (history ?? [])
    .filter((h: ArchitectureChatHistory[number]): h is { role: "system"; content: string } => h.role === "system")
    .map((h) => h.content)
    .join("\n\n");
  const systemParts = [railSystemContent, systemFromHistory].filter(Boolean).join("\n\n");
  let systemPrompt =
    systemParts.length > 0
      ? systemParts + "\n\n" + buildSystemPrompt(graph)
      : buildSystemPrompt(graph);
  if (feedbackContext && feedbackContext.trim()) {
    systemPrompt = feedbackContext.trim() + "\n\n" + systemPrompt;
  }

  // Prepend rail session turns as prior messages (user/assistant) so Claude sees the rail context.
  const railPriorTurns = railContext.filter(
    (h: ArchitectureChatHistory[number]): h is { role: "user" | "assistant"; content: string } =>
      h.role === "user" || h.role === "assistant"
  ) as Anthropic.MessageParam[];

  // Pre-send trim: avoid exceeding model context window (200K; we cap at 180K).
  let systemEst = estimateTokens(systemPrompt);
  let contextEst = estimateTokens(contextText);
  const railEst = railPriorTurns.reduce((s, m) => s + estimateTokens(typeof m.content === "string" ? m.content : JSON.stringify(m.content)), 0);
  const reserveForOutput = 4000; // Leave room for response
  const totalEst = systemEst + contextEst + railEst;
  if (totalEst > CONTEXT_WINDOW_SAFE - reserveForOutput) {
    const toTrim = totalEst - (CONTEXT_WINDOW_SAFE - reserveForOutput);
    contextText = trimTextToBudget(contextText, Math.max(0, contextEst - toTrim));
  }

  const userContent: Anthropic.MessageParam["content"] =
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
          { type: "text", text: contextText },
        ]
      : contextText;

  const messages: Anthropic.MessageParam[] = [
    ...railPriorTurns,
    { role: "user", content: userContent },
  ];

  const MAX_STEPS = 6;
  let finalAnswer = "";
  let finalGraphCommand: GraphCommand | undefined;
  let proposal: unknown;
  let usedSaveSkill = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const reasoningSteps: string[] = [];
  const citationSet = new Map<string, { label: string; nodeId?: string; edgeId?: string; filePath?: string }>();

  const jiraContext: JiraToolContext | undefined =
    jiraConfig || jiraProjectKey
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
          ? { tool_choice: { type: "tool" as const, name: "save_skill" as const } }
          : isUsageRequest && step === 0
            ? { tool_choice: { type: "tool" as const, name: "run_skill" as const } }
            : {}),
        messages,
      });

      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      const totalTokens = inputTokens + outputTokens;
      if (basePath) bumpSessionUsage(basePath, { tokenUsage: totalTokens, llmCallCount: 1 });
      if (process.env.METRICS_LOG === "1") {
        console.warn(
          `[metrics] Claude architect step=${step + 1} input=${inputTokens} output=${outputTokens} total=${totalInputTokens + totalOutputTokens}`
        );
      }

      emitTrace(
        "llm_call",
        { role: "architect", step: step + 1, nodeId, question },
        {
          stopReason: response.stop_reason,
          usage: response.usage,
          contentTypes: response.content.map((b) => b.type),
        },
        "Claude architect response"
      );

      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "end_turn") {
        const text = textBlocks.map((b) => b.text).join("\n").trim();
        if (text) finalAnswer = text;

        // Fallback: navigation query with matched nodes but no answer tool call.
        // Synthesize a graphCommand from matchResult so the canvas still updates.
        if (!finalGraphCommand && matchResult.isNavigation && matchResult.matchedNodeIds.length > 0) {
          if (matchResult.matchedNodeIds.length === 1) {
            finalGraphCommand = {
              action: "focus_node",
              nodeId: matchResult.matchedNodeIds[0],
            };
          } else {
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
        if (text) finalAnswer = text;
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      // Execute non-answer tools first so that side effects (like save_skill)
      // occur even if answer is also present in the same tool_use batch.
      const actionTools = toolUseBlocks.filter((t) => t.name !== "answer");
      const answerTool = toolUseBlocks.find((t) => t.name === "answer");

      for (const toolUse of actionTools) {
        emitTrace(
          "llm_reasoning",
          { tool: toolUse.name, input: toolUse.input, step: step + 1 },
          {},
          "Claude requested tool"
        );

        if (toolUse.name === "save_skill") {
          usedSaveSkill = true;
        }

        const input = toolUse.input as Record<string, unknown>;
        const { result, proposal: prop } = await executeTool(
          toolUse.name,
          input,
          basePath,
          graph,
          availablePaths,
          route.keywords,
          jiraContext
        );

        if (prop) proposal = prop;

        const stepLabel = formatReasoningStep(toolUse.name, input, result);
        if (stepLabel) reasoningSteps.push(stepLabel);
        collectCitations(toolUse.name, input, result, citationSet, route.relevantNodeIds ?? [], graph);

        emitTrace(
          "llm_call",
          { tool: toolUse.name, step: step + 1 },
          { result: result.slice(0, 800), proposal: prop ? true : false },
          "Tool executed for Claude"
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: result.slice(0, 8000),
        });
      }

      if (answerTool) {
        emitTrace(
          "llm_reasoning",
          { tool: answerTool.name, input: answerTool.input, step: step + 1 },
          {},
          "Claude requested tool"
        );
        const input = answerTool.input as {
          content: string;
          graphCommand?: unknown;
        };
        finalAnswer = input.content;
        if (input.graphCommand) {
          finalGraphCommand = parseGraphCommand(input.graphCommand);
          reasoningSteps.push(
            `Emitted graph command: ${(input.graphCommand as { action?: string })?.action ?? "unknown"}`
          );
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: answerTool.id,
          content: "Answer recorded.",
        });
      }

      if (finalAnswer) break;

      messages.push({ role: "user", content: toolResults });
    }

    if (!finalAnswer) {
      const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
      if (lastAssistant && Array.isArray(lastAssistant.content)) {
        const texts = lastAssistant.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
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
      } else {
        finalGraphCommand = {
          action: "highlight_nodes",
          nodeIds: matchResult.matchedNodeIds,
        };
      }
    }

    const citations = Array.from(citationSet.values());
    return {
      answer: finalAnswer,
      ...(finalGraphCommand ? { graphCommand: finalGraphCommand } : {}),
      ...(proposal ? { proposal } : {}),
      ...(usedSaveSkill ? { usedSaveSkill: true } : {}),
      ...(totalInputTokens > 0 || totalOutputTokens > 0
        ? { tokenUsage: { input: totalInputTokens, output: totalOutputTokens } }
        : {}),
      ...(reasoningSteps.length > 0 ? { reasoningTrace: reasoningSteps } : {}),
      ...(citations.length > 0 ? { citations } : {}),
    };
  } catch (err) {
    return {
      answer: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

