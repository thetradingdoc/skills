/**
 * LLM client — Execution Plan Phase 1
 * Wraps Anthropic API for Code Writer and Arch Planner.
 */

import Anthropic from "@anthropic-ai/sdk";
import { emitTrace } from "./traceLogger";
import { bumpSessionUsage } from "./sessionPersistence";
import type { AgentPlan, AgentPlanTask, ProposedFileSpec, Rail } from "./types";
import type { ArchitectureChatHistory } from "../types";
import { buildRailContext } from "./rail/context";

const VALID_TOOLS = new Set(["write_file", "read_file"]);

export interface LLMCallContext {
  role: "code_writer" | "arch_planner";
  goal: string;
  plan: AgentPlan;
  taskId: string;
  taskModule: string;
  conversationTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  fileContent?: string;
  filePath?: string;
  errorOutput?: string;
  projectRoot?: string;
  apiKey?: string;
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
  if (ctx.errorOutput) {
    lines.push("Error output (fix these):", ctx.errorOutput, "");
  }
  lines.push(
    "Use write_file for each file you need to create or update. Use read_file if you need to inspect additional context first."
  );
  return lines.join("\n");
}

export async function callLLM(context: LLMCallContext): Promise<LLMCallResult> {
  const apiKey = context.apiKey ?? process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    const err =
      "Anthropic API key not configured. Set archVisualizer.anthropicApiKey or ANTHROPIC_API_KEY.";
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
    const client = new Anthropic({ apiKey });

    let system = CODE_WRITER_SYSTEM;
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userMsg }];

    if (context.rail) {
      const railHistory = buildRailContext(
        context.rail,
        context.railHistory ?? [],
        500
      );
      const systemRail = `You are executing rail ${context.rail.id}.\n` +
        `Frozen outcome: ${context.rail.frozenOutcome ?? context.rail.outcome}.\n` +
        "Do not change the outcome; every step must move toward this outcome only.\n" +
        "Do not introduce new goals, alter the specification, or expand scope beyond this rail.\n";

      const systemMessages = railHistory
        .filter((m) => m.role === "system")
        .map((m) => m.content);

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
      model: "claude-sonnet-4-6",
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

      emitTrace(
        "llm_call",
        inputForTrace,
        { tool, input: toolUse.input ?? {}, tokens: totalTokens },
        `LLM → ${tool}`
      );
      return { type: "tool_call", tool, input: (toolUse.input ?? {}) as Record<string, unknown> };
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
