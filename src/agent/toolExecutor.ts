/**
 * Tool executor — AGENT_ROADMAP v4, Execution Plan Phase 0
 * Executes tools, validates against security allowlist, emits trace entries.
 */

import * as fs from "fs";
import * as path from "path";
import { emitTrace } from "./traceLogger";
import { checkPathAllowed, type AllowlistConfig } from "./securityAllowlist";
import { writeToStaging } from "./staging";
import { runLint } from "./runLint";
import { runVitest } from "./runVitest";

const MAX_CONTENT_CHARS = 50000;

export interface ToolExecutorContext {
  rootPath: string;
  allowlist?: AllowlistConfig;
}

export interface ToolResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
}

export async function executeTool(
  tool: string,
  input: Record<string, unknown>,
  context: ToolExecutorContext
): Promise<ToolResult> {
  const allowlist: AllowlistConfig = context.allowlist ?? {
    projectRoot: context.rootPath,
    allowedPrefixes: ["src/", "docs/"],
  };

  if (tool === "read_file") {
    const filePath = typeof input.path === "string" ? input.path : "";
    if (!filePath) {
      const out = { success: false, output: {}, error: "read_file requires path" };
      emitTrace("read_file", input, out.output, "read_file failed: missing path");
      return out;
    }

    const check = checkPathAllowed(filePath, allowlist, "read");
    if (!check.allowed) {
      const out = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("read_file", input, out.output, `read_file rejected: ${check.reason}`);
      return out;
    }

    const fullPath = path.resolve(context.rootPath, filePath);
    if (!fs.existsSync(fullPath)) {
      const out = { success: false, output: { path: filePath }, error: "File not found" };
      emitTrace("read_file", input, out.output, "read_file failed: file not found");
      return out;
    }

    let content: string;
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const out = { success: false, output: { path: filePath }, error: msg };
      emitTrace("read_file", input, out.output, `read_file failed: ${msg}`);
      return out;
    }

    const truncated = content.length > MAX_CONTENT_CHARS;
    const output: Record<string, unknown> = {
      path: filePath,
      content: truncated ? content.slice(0, MAX_CONTENT_CHARS) + "\n...[truncated]" : content,
      truncated,
    };
    emitTrace("read_file", input, output, truncated ? "read_file ok (truncated)" : "read_file ok");
    return { success: true, output };
  }

  if (tool === "write_file") {
    const filePath = typeof input.path === "string" ? input.path : "";
    const content = typeof input.content === "string" ? input.content : "";
    if (!filePath || !content) {
      const out = { success: false, output: {}, error: "write_file requires path and content" };
      emitTrace("write_file", { path: filePath }, out.output, "write_file failed: missing path or content");
      return out;
    }

    const check = checkPathAllowed(filePath, allowlist, "write");
    if (!check.allowed) {
      const out = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("write_file", input, out.output, `write_file rejected: ${check.reason}`);
      return out;
    }

    const fullPath = path.resolve(context.rootPath, filePath);
    let beforeContent: string | undefined;
    if (fs.existsSync(fullPath)) {
      beforeContent = fs.readFileSync(fullPath, "utf-8");
    }

    const stagingId = writeToStaging(filePath, content, { beforeContent });
    const output: Record<string, unknown> = { stagingId, path: filePath };
    emitTrace("write_file", { path: filePath }, output, "write_file ok (staged)");
    return { success: true, output };
  }

  if (tool === "run_lint") {
    const paths = Array.isArray(input.paths) ? (input.paths as string[]) : undefined;
    const lintResult = runLint(context.rootPath, paths);
    const output: Record<string, unknown> = {
      passed: lintResult.passed,
      errors: lintResult.errors,
    };
    emitTrace("run_lint", input, output, lintResult.passed ? "run_lint pass" : "run_lint fail");
    return { success: lintResult.passed, output };
  }

  if (tool === "run_vitest") {
    const pattern = typeof input.pattern === "string" ? input.pattern : undefined;
    const vitestResult = runVitest(context.rootPath, pattern);
    const output: Record<string, unknown> = {
      passed: vitestResult.passed,
      summary: vitestResult.summary,
      failures: vitestResult.failures,
    };
    emitTrace("run_vitest", input, output, vitestResult.passed ? "run_vitest pass" : "run_vitest fail");
    return { success: vitestResult.passed, output };
  }

  // All other tools: not implemented
  const out: ToolResult = {
    success: false,
    output: {},
    error: `Tool "${tool}" not implemented`,
  };
  emitTrace("error" as const, { tool, input }, {}, `executeTool: ${tool} not implemented`);
  return out;
}
