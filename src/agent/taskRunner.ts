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

  let filePath: string | undefined;
  let existingContent: string | undefined;

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

    const readResult = await executeTool("read_file", { path: filePath }, { rootPath });
    if (!readResult.success) {
      return {
        taskId: task.id,
        toolResult: { error: readResult.error, ...readResult.output },
        traceId: getSessionId(),
        error: readResult.error,
      };
    }
    existingContent = readResult.output.content as string;
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
  const MAX_ITER = 20;

  let currentFilePath = filePath;
  let currentFileContent = existingContent;
  let currentError = opts?.errorOutput;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const llmResult = await callLLM({
      role: "code_writer",
      goal: plan.goal,
      plan,
      taskId: task.id,
      taskModule: task.module,
      conversationTurns: opts?.conversationTurns,
      fileContent: currentFileContent,
      filePath: currentFilePath,
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
      const writeResult = await executeTool("write_file", llmResult.input, { rootPath });
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
      currentFilePath = undefined;
      currentFileContent = undefined;
      currentError = undefined;
      continue;
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
        const secondRead = await executeTool("read_file", { path: pathToRead }, { rootPath });
        currentFilePath = pathToRead;
        currentFileContent = secondRead.success
          ? (secondRead.output.content as string)
          : `[Error reading ${pathToRead}: ${secondRead.error}]`;
        lastToolResult = secondRead.success ? secondRead.output : { error: secondRead.error };
      }
      continue;
    }

    if (llmResult.type === "end_turn") {
      lastToolResult = { note: llmResult.content };
      break;
    }

    lastToolResult = { raw: (llmResult as any).raw };
    break;
  }

  return {
    taskId: task.id,
    toolResult: lastToolResult,
    traceId: getSessionId(),
    hasStaging,
  };
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
  }
): Promise<RunFirstTaskResult> {
  return runTaskAtIndex(plan, currentTaskIndex + 1, rootPath, opts);
}
