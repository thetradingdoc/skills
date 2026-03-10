/**
 * Task runner — Execution Plan Phases 0–3
 * Takes approved plan, runs tasks: read_file → LLM → write_file → staging.
 */

import * as fs from "fs";
import * as path from "path";
import type { AgentPlan, Rail } from "./types";
import { executeTool } from "./toolExecutor";
import { callLLM } from "./llmClient";
import { getSessionId } from "./traceLogger";
import { getRailTelemetry } from "./rail/telemetry";

const RAIL_TOKEN_BUDGET =
  typeof process.env.RAIL_TOKEN_BUDGET === "string" &&
  !Number.isNaN(Number(process.env.RAIL_TOKEN_BUDGET))
    ? Math.max(10_000, Math.min(180_000, Number(process.env.RAIL_TOKEN_BUDGET)))
    : 100_000;

const ENTRY_CANDIDATES = ["index.ts", "index.tsx", "index.js", "index.jsx"];

function resolveModuleToFilePath(modulePath: string, rootPath: string): { path: string } | { error: string; attempted: string[] } {
  const attempted: string[] = [];
  const fullDir = path.resolve(rootPath, modulePath);
  const dirExists = fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory();

  if (dirExists) {
    for (const entry of ENTRY_CANDIDATES) {
      const candidate = path.join(fullDir, entry);
      attempted.push(path.relative(rootPath, candidate).replace(/\\/g, "/"));
      if (fs.existsSync(candidate)) {
        return { path: attempted[attempted.length - 1]! };
      }
    }
  }

  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const candidate = `${modulePath}${ext}`;
    const full = path.resolve(rootPath, candidate);
    attempted.push(path.relative(rootPath, full).replace(/\\/g, "/"));
    if (fs.existsSync(full)) {
      return { path: attempted[attempted.length - 1]! };
    }
  }

  return { error: `Could not resolve module "${modulePath}" to a file`, attempted };
}

export interface RunFirstTaskResult {
  taskId: string;
  toolResult: unknown;
  traceId: string;
  error?: string;
  hasStaging?: boolean;
}

export async function runTaskAtIndex(
  plan: AgentPlan,
  taskIndex: number,
  rootPath: string,
  opts?: {
    skipLLM?: boolean;
    apiKey?: string;
    conversationTurns?: Array<{ role: "user" | "assistant"; content: string }>;
    errorOutput?: string;
    rail?: Rail;
    railHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    moduleSignals?: import("./moduleSignals").ModuleSignals;
  }
): Promise<RunFirstTaskResult> {
  const task = plan.tasks[taskIndex];
  if (!task) {
    return {
      taskId: "",
      toolResult: {},
      traceId: getSessionId(),
      error: "No task at index",
    };
  }

  const isCreate = task.action === "create";
  const requiresStagingWrite =
    (task.successChecks ?? []).some((c) => c.kind === "staging_write" && c.required === true) ||
    isCreate;

  let filePath: string | undefined;
  let existingContent: string | undefined;
  let astSummary:
    | {
        path: string;
        fingerprint: string;
        importCount: number;
        exportFunctionCount: number;
        exportClassCount: number;
        exportInterfaceCount: number;
        exportConstCount: number;
      }
    | undefined;

  if (!isCreate) {
    const resolved = resolveModuleToFilePath(task.module, rootPath);
    if ("error" in resolved) {
      return {
        taskId: task.id,
        toolResult: { error: resolved.error, attempted: resolved.attempted },
        traceId: getSessionId(),
        error: `${resolved.error}. Tried: ${resolved.attempted.join(", ")}`,
      };
    }
    filePath = resolved.path;

    const readResult = await executeTool(
      "read_file",
      { path: filePath },
      { rootPath, plan, taskId: task.id }
    );
    if (!readResult.success) {
      return {
        taskId: task.id,
        toolResult: { error: readResult.error, ...readResult.output },
        traceId: getSessionId(),
        error: readResult.error,
      };
    }
    existingContent = readResult.output.content as string;

    const astResult = await executeTool(
      "get_ast",
      { path: filePath },
      { rootPath, plan, taskId: task.id }
    );
    if (astResult.success) {
      const o = astResult.output as any;
      astSummary = {
        path: String(o.path ?? filePath),
        fingerprint: String(o.fingerprint ?? ""),
        importCount: Array.isArray(o.imports) ? o.imports.length : 0,
        exportFunctionCount: Array.isArray(o.exports?.functions) ? o.exports.functions.length : 0,
        exportClassCount: Array.isArray(o.exports?.classes) ? o.exports.classes.length : 0,
        exportInterfaceCount: Array.isArray(o.exports?.interfaces) ? o.exports.interfaces.length : 0,
        exportConstCount: Array.isArray(o.exports?.constants) ? o.exports.constants.length : 0,
      };
    }
  }

  if (opts?.skipLLM || !opts?.apiKey) {
    return {
      taskId: task.id,
      toolResult: existingContent ? { content: existingContent } : {},
      traceId: getSessionId(),
    };
  }

  let hasStaging = false;
  let lastToolResult: unknown = {};
  let readHops = 0;
  const MAX_READ_HOPS = 4;
  const MAX_ITER =
    typeof process.env.AGENT_MAX_ITER === "string" &&
    !Number.isNaN(Number(process.env.AGENT_MAX_ITER))
      ? Math.max(1, Math.min(50, Number(process.env.AGENT_MAX_ITER)))
      : 20;

  let currentFilePath = filePath;
  let currentFileContent = existingContent;
  let currentError = opts?.errorOutput;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (opts?.rail?.id) {
      const telemetry = getRailTelemetry(opts.rail.id);
      if (telemetry.tokenUsage >= RAIL_TOKEN_BUDGET) {
        return {
          taskId: task.id,
          toolResult: lastToolResult,
          traceId: getSessionId(),
          error: `Rail token budget exceeded (${telemetry.tokenUsage}/${RAIL_TOKEN_BUDGET}). Set RAIL_TOKEN_BUDGET to increase.`,
          hasStaging,
        };
      }
    }
    const llmResult = await callLLM({
      role: "code_writer",
      goal: plan.goal,
      plan,
      taskId: task.id,
      taskModule: task.module,
      conversationTurns: opts?.conversationTurns,
      fileContent: currentFileContent,
      filePath: currentFilePath,
      astSummary,
      moduleSignals: opts?.moduleSignals,
      errorOutput: currentError,
      projectRoot: rootPath,
      apiKey: opts.apiKey,
      rail: opts?.rail,
      railHistory: opts?.railHistory,
    });

    if (llmResult.type === "no_api_key") {
      return {
        taskId: task.id,
        toolResult: lastToolResult,
        traceId: getSessionId(),
        error: llmResult.error,
        hasStaging,
      };
    }

    if (llmResult.type === "tool_call" && llmResult.tool === "write_file") {
      const writeResult = await executeTool("write_file", llmResult.input, {
        rootPath,
        plan,
        taskId: task.id,
      });
      if (!writeResult.success) {
        return {
          taskId: task.id,
          toolResult: { error: writeResult.error },
          traceId: getSessionId(),
          error: writeResult.error,
          hasStaging,
        };
      }
      hasStaging = true;
      lastToolResult = writeResult.output;
      // One staging write is the unit of work for a single plan task.
      // Stop here so the Diff Preview gate can fire deterministically.
      break;
    }

    if (llmResult.type === "tool_call" && llmResult.tool === "read_file") {
      if (readHops >= MAX_READ_HOPS) {
        return {
          taskId: task.id,
          toolResult: lastToolResult,
          traceId: getSessionId(),
          error: `LLM exceeded ${MAX_READ_HOPS} read_file calls without writing`,
          hasStaging,
        };
      }
      readHops++;
      const pathToRead = typeof llmResult.input.path === "string" ? llmResult.input.path : "";
      if (pathToRead) {
        const secondRead = await executeTool(
          "read_file",
          { path: pathToRead },
          { rootPath, plan, taskId: task.id }
        );
        currentFilePath = pathToRead;
        currentFileContent = secondRead.success
          ? (secondRead.output.content as string)
          : `[Error reading ${pathToRead}: ${secondRead.error}]`;
        lastToolResult = secondRead.success ? secondRead.output : { error: secondRead.error };
      }
      continue;
    }

    if (llmResult.type === "tool_call" && llmResult.tool === "get_ast") {
      const pathToRead = typeof llmResult.input.path === "string" ? llmResult.input.path : "";
      if (pathToRead) {
        const r = await executeTool("get_ast", { path: pathToRead }, { rootPath, plan, taskId: task.id });
        lastToolResult = r.success ? r.output : { error: r.error };
      }
      continue;
    }

    if (llmResult.type === "end_turn") {
      lastToolResult = { note: llmResult.content };
      break;
    }

    if (llmResult.type === "unknown_output") {
      currentError = `Invalid or unparseable model output. Produce only a tool call (read_file/write_file/get_ast) or end_turn.\n\nOutput:\n${llmResult.raw}`;
      lastToolResult = { raw: llmResult.raw };
      continue;
    }

    lastToolResult = { raw: (llmResult as any).raw };
    break;
  }

  const final: RunFirstTaskResult = {
    taskId: task.id,
    toolResult: lastToolResult,
    traceId: getSessionId(),
    hasStaging,
  };
  if (requiresStagingWrite && !hasStaging) {
    final.error = `Task ${task.id} ended without producing a staging write.`;
  }
  return final;
}

export async function runFirstTask(
  plan: AgentPlan,
  rootPath: string,
  opts?: {
    skipLLM?: boolean;
    apiKey?: string;
    conversationTurns?: Array<{ role: "user" | "assistant"; content: string }>;
    errorOutput?: string;
    rail?: Rail;
    railHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    moduleSignals?: import("./moduleSignals").ModuleSignals;
  }
): Promise<RunFirstTaskResult> {
  return runTaskAtIndex(plan, 0, rootPath, opts);
}

export async function runNextTask(
  plan: AgentPlan,
  rootPath: string,
  currentTaskIndex: number,
  opts?: {
    skipLLM?: boolean;
    apiKey?: string;
    conversationTurns?: Array<{ role: "user" | "assistant"; content: string }>;
    errorOutput?: string;
    rail?: Rail;
    railHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    moduleSignals?: import("./moduleSignals").ModuleSignals;
  }
): Promise<RunFirstTaskResult> {
  return runTaskAtIndex(plan, currentTaskIndex + 1, rootPath, opts);
}
