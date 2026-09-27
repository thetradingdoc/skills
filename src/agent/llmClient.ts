/**
 * LLM client — Execution Plan Phase 1
 * Wraps Anthropic API for Code Writer and Arch Planner.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { emitTrace } from "./traceLogger";
import { bumpSessionUsage } from "./sessionPersistence";
import type { AgentPlan, AgentPlanTask, ProposedFileSpec, Rail } from "./types";
import type { ModuleSignals } from "./moduleSignals";
import type { ArchitectureChatHistory } from "../types";
import { buildRailContext } from "./rail/context";
import { loadAntiPatterns } from "./rail/manager";

const VALID_TOOLS = new Set(["write_file", "read_file", "get_ast"]);

export interface LLMCallContext {
  role: "code_writer" | "arch_planner";
  goal: string;
  plan: AgentPlan;
  taskId: string;
  taskModule: string;
  conversationTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  fileContent?: string;
  filePath?: string;
  astSummary?: {
    path: string;
    fingerprint: string;
    importCount: number;
    exportFunctionCount: number;
    exportClassCount: number;
    exportInterfaceCount: number;
    exportConstCount: number;
  };
  moduleSignals?: ModuleSignals;
  errorOutput?: string;
  projectRoot?: string;
  apiKey?: string;
  provider?: "anthropic" | "openai";
  model?: string;
  rail?: Rail;
  railHistory?: ArchitectureChatHistory;
}

export type LLMCallResult =
  | { type: "tool_call"; tool: string; input: Record<string, unknown> }
  | { type: "agent_plan"; plan: AgentPlan }
  | { type: "end_turn"; content: string }
  | { type: "unknown_output"; raw: string }
  | { type: "no_api_key"; error: string };

const CODE_WRITER_SYSTEM = `You are a code writer.

You MUST use tools to act:
- Use write_file to write or update code.
- Use read_file to read additional files when needed.

Constraints:
- Only operate within the planned task/module scope.
- Do not propose architecture. Do not change rules.
- Prefer minimal, targeted edits that make tests pass.
- Paths must be project-root-relative (e.g. "src/foo/bar.ts").
- When creating new files, create all files listed in the spec.
- When a file spec includes todos, implement them all.`;

const CODE_WRITER_TOOLS: Anthropic.Tool[] = [
  {
    name: "read_file",
    description: "Read a single file's full contents (project-root-relative path).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write a file's full contents (project-root-relative path).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "get_ast",
    description: "Extract imports/exports fingerprint for a file (project-root-relative path).",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
  },
];

function getTaskFromPlan(plan: AgentPlan, taskId: string): AgentPlanTask | undefined {
  return plan.tasks.find((t) => t.id === taskId);
}

function buildUserMessage(ctx: LLMCallContext): string {
  const lines: string[] = [
    `Goal: ${ctx.goal}`,
    `Task: ${ctx.taskId} — ${ctx.taskModule}`,
    "",
  ];
  if (ctx.projectRoot && ctx.rail?.archetype) {
    const anti = loadAntiPatterns(ctx.projectRoot, ctx.rail.archetype);
    if (anti.length > 0) {
      lines.push("Anti-patterns to avoid (from prior failed rails):");
      for (const p of anti.slice(-6)) {
        lines.push(`- Avoid: ${p.reason}`);
      }
      lines.push("");
    }
  }
  if (ctx.conversationTurns && ctx.conversationTurns.length > 0) {
    lines.push("Recent conversation (most recent last):");
    for (const t of ctx.conversationTurns.slice(-4)) {
      lines.push(`${t.role.toUpperCase()}: ${t.content}`);
    }
    lines.push("");
  }

  const task = getTaskFromPlan(ctx.plan, ctx.taskId);
  if (task?.proposedFiles && task.proposedFiles.length > 0) {
    lines.push("Files to create for this module (implement all of them):");
    for (const f of task.proposedFiles as (string | ProposedFileSpec)[]) {
      if (typeof f === "string") {
        lines.push(`- ${f}`);
      } else {
        lines.push(`\n### ${f.name}`);
        lines.push(`Purpose: ${f.purpose}`);
        if (f.todos.length > 0) {
          lines.push("Todos:");
          for (const todo of f.todos) {
            lines.push(`  - ${todo}`);
          }
        }
      }
    }
    lines.push("");
  }

  if (ctx.filePath && ctx.fileContent !== undefined) {
    lines.push(`File ${ctx.filePath}:`, "```", ctx.fileContent.slice(0, 30000), "```", "");
  }
  if (ctx.astSummary) {
    lines.push(
      "Module signals (from get_ast):",
      `- fingerprint: ${ctx.astSummary.fingerprint}`,
      `- imports: ${ctx.astSummary.importCount}`,
      `- exports: functions=${ctx.astSummary.exportFunctionCount}, classes=${ctx.astSummary.exportClassCount}, interfaces=${ctx.astSummary.exportInterfaceCount}, consts=${ctx.astSummary.exportConstCount}`,
      ""
    );
  }
  if (ctx.moduleSignals) {
    const ms = ctx.moduleSignals;
    lines.push(
      "Structural module signals:",
      `- moduleId: ${ms.moduleId}`,
      `- fan-in: ${ms.fanIn}`,
      `- fan-out: ${ms.fanOut}`,
      `- external imports: ${ms.externalImportCount}`,
      `- export count: ${ms.exportCount}`,
      `- file count: ${ms.fileCount}`,
      `- health: ${ms.health}`,
      ms.healthReasons.length ? `- healthReasons: ${ms.healthReasons.join("; ")}` : "",
      ""
    );
  }
  if (ctx.errorOutput) {
    lines.push("Error output (fix these):", ctx.errorOutput, "");
  }
  lines.push(
    "Use write_file for each file you need to create or update. Use read_file if you need to inspect additional context first."
  );
  return lines.join("\n");
}

function validateToolInput(
  tool: string,
  input: Record<string, unknown>
): { ok: true } | { ok: false; reason: string } {
  if (tool === "read_file" || tool === "get_ast") {
    const p = typeof input.path === "string" ? input.path.trim() : "";
    if (!p) return { ok: false, reason: `${tool} requires non-empty "path" string` };
    if (p.length > 500) return { ok: false, reason: `${tool} path too long` };
    return { ok: true };
  }
  if (tool === "write_file") {
    const p = typeof input.path === "string" ? input.path.trim() : "";
    const c = typeof input.content === "string" ? input.content : "";
    if (!p) return { ok: false, reason: "write_file requires non-empty \"path\" string" };
    if (!c) return { ok: false, reason: "write_file requires non-empty \"content\" string" };
    if (p.length > 500) return { ok: false, reason: "write_file path too long" };
    return { ok: true };
  }
  return { ok: false, reason: `Unknown tool: ${tool}` };
}

export async function callLLM(context: LLMCallContext): Promise<LLMCallResult> {
  const provider = context.provider ?? "anthropic";
  const apiKey = context.apiKey ?? (provider === "openai" ? process.env.OPENAI_API_KEY?.trim() : process.env.ANTHROPIC_API_KEY?.trim());
  if (!apiKey) {
    const err =
      `${provider === "openai" ? "OpenAI" : "Anthropic"} API key not configured.`;
    emitTrace("error", { role: context.role, goal: context.goal }, { error: err }, err);
    return { type: "no_api_key", error: err };
  }

  const userMsg = buildUserMessage(context);
  const inputForTrace = {
    role: context.role,
    goal: context.goal,
    taskId: context.taskId,
    filePath: context.filePath,
  };

  try {
    if (provider === "openai") {
      const client = new OpenAI({ apiKey });
      let system = CODE_WRITER_SYSTEM;
      let prior: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (context.rail) {
        const railHistory = buildRailContext(context.rail, context.railHistory ?? [], 500) as ArchitectureChatHistory;
        system = [
          `You are executing rail ${context.rail.id}. Frozen outcome: ${context.rail.frozenOutcome ?? context.rail.outcome}. Do not expand its scope.`,
          ...railHistory.filter((m: ArchitectureChatHistory[number]) => m.role === "system").map((m: ArchitectureChatHistory[number]) => m.content),
          CODE_WRITER_SYSTEM,
        ].filter(Boolean).join("\n\n");
        prior = railHistory.filter((m): m is { role: "user" | "assistant"; content: string } => m.role === "user" || m.role === "assistant");
      }
      const tools: OpenAI.ChatCompletionTool[] = CODE_WRITER_TOOLS.map((tool) => ({
        type: "function",
        function: { name: tool.name, description: tool.description, parameters: tool.input_schema as Record<string, unknown> },
      }));
      const response = await client.chat.completions.create({
        model: context.model ?? "gpt-4o-mini",
        max_tokens: 8192,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          ...prior,
          { role: "user", content: userMsg },
        ],
        tools,
        tool_choice: "auto",
      });
      const choice = response.choices[0];
      const usage = response.usage;
      const totalTokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
      if (context.projectRoot) bumpSessionUsage(context.projectRoot, { tokenUsage: totalTokens, llmCallCount: 1 });
      emitTrace("llm_call", inputForTrace, { tokens: totalTokens }, "OpenAI code writer reasoning step");
      const toolCall = choice?.message.tool_calls?.[0];
      if (toolCall?.type === "function") {
        const name = toolCall.function.name;
        if (!VALID_TOOLS.has(name)) return { type: "unknown_output", raw: `Model requested unknown tool: ${name}` };
        let input: Record<string, unknown>;
        try { input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; }
        catch { return { type: "unknown_output", raw: `Invalid JSON arguments for ${name}` }; }
        const valid = validateToolInput(name, input);
        return valid.ok ? { type: "tool_call", tool: name, input } : { type: "unknown_output", raw: `Invalid tool call: ${valid.reason}` };
      }
      const content = choice?.message.content?.trim() ?? "";
      if (choice?.finish_reason === "stop") return { type: "end_turn", content };
      return { type: "unknown_output", raw: content || `finish_reason=${choice?.finish_reason ?? "unknown"}` };
    }

    const client = new Anthropic({ apiKey });

    let system = CODE_WRITER_SYSTEM;
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

    if (context.rail) {
        const railHistory = buildRailContext(
          context.rail,
          context.railHistory ?? [],
          500
      ) as ArchitectureChatHistory;
      const systemRail = `You are executing rail ${context.rail.id}.\n` +
        `Frozen outcome: ${context.rail.frozenOutcome ?? context.rail.outcome}.\n` +
        "Do not change the outcome; every step must move toward this outcome only.\n" +
        "Do not introduce new goals, alter the specification, or expand scope beyond this rail.\n";

      const systemMessages = railHistory
        .filter((m: ArchitectureChatHistory[number]) => m.role === "system")
        .map((m: ArchitectureChatHistory[number]) => m.content);

      system = [systemRail, ...systemMessages, CODE_WRITER_SYSTEM]
        .filter(Boolean)
        .join("\n\n");

      const priorTurns = railHistory.filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          m.role === "user" || m.role === "assistant"
      );

      messages = [
        ...priorTurns,
        { role: "user", content: userMsg },
      ];
    }

    const response = await client.messages.create({
      model: context.model ?? "claude-sonnet-4-6",
      max_tokens: 8192,
      temperature: 0,
      system,
      tools: CODE_WRITER_TOOLS,
      messages,
    });

    const usage = response.usage;
    const totalTokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
    if (context.projectRoot) {
      bumpSessionUsage(context.projectRoot, { tokenUsage: totalTokens, llmCallCount: 1 });
    }

    emitTrace("llm_call", inputForTrace, { tokens: totalTokens }, "Code writer reasoning step");

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUse) {
      const tool = toolUse.name;
      if (!VALID_TOOLS.has(tool)) {
        emitTrace(
          "error",
          inputForTrace,
          { tool, tokens: totalTokens },
          `Unknown tool: ${tool}`
        );
        return { type: "unknown_output", raw: `Model requested unknown tool: ${tool}` };
      }

      const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;
      const ok = validateToolInput(tool, toolInput);
      if (!ok.ok) {
        emitTrace(
          "error",
          inputForTrace,
          { tool, input: toolInput, tokens: totalTokens },
          `Invalid tool call: ${ok.reason}`
        );
        return { type: "unknown_output", raw: `Invalid tool call: ${ok.reason}` };
      }

      emitTrace(
        "llm_call",
        inputForTrace,
        { tool, input: toolInput, tokens: totalTokens },
        `LLM → ${tool}`
      );
      return { type: "tool_call", tool, input: toolInput };
    }

    const texts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (response.stop_reason === "end_turn") {
      emitTrace(
        "llm_call",
        inputForTrace,
        { stopReason: response.stop_reason, tokens: totalTokens, text: texts.slice(0, 800) },
        "LLM → end_turn"
      );
      return { type: "end_turn", content: texts };
    }

    emitTrace(
      "error",
      inputForTrace,
      { stopReason: response.stop_reason, tokens: totalTokens, text: texts.slice(0, 800) },
      "unknown_llm_output"
    );
    return { type: "unknown_output", raw: texts || `stop_reason=${response.stop_reason ?? "unknown"}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emitTrace("error", inputForTrace, { error: msg }, `LLM failed: ${msg}`);
    return { type: "unknown_output", raw: msg };
  }
}
