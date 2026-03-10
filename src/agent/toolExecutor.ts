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
import { getAst } from "./getAst";
import type { AgentPlan } from "./types";

const MAX_CONTENT_CHARS = 50000;

export interface ToolExecutorContext {
  rootPath: string;
  allowlist?: AllowlistConfig;
  plan?: AgentPlan;
  taskId?: string;
}

export interface ToolResult {
  success: boolean;
  output: Record<string, unknown>;
  error?: string;
}

function isInPlanScope(filePath: string, plan?: AgentPlan): { ok: true } | { ok: false; reason: string } {
  if (!plan) return { ok: true };
  const norm = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  const bases = plan.tasks.map((t) => t.module.replace(/\\/g, "/").replace(/\/+$/, ""));
  const ok = bases.some((b) => norm === b || norm.startsWith(b + "/"));
  if (!ok) {
    return {
      ok: false,
      reason: `Path is outside approved plan scope. Allowed modules: ${bases.join(", ")}`,
    };
  }
  return { ok: true };
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

    const scope = isInPlanScope(filePath, context.plan);
    if (!scope.ok) {
      const out = { success: false, output: { reason: scope.reason }, error: scope.reason };
      emitTrace("read_file", input, out.output, `read_file rejected: ${scope.reason}`);
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

    const scope = isInPlanScope(filePath, context.plan);
    if (!scope.ok) {
      const out = { success: false, output: { reason: scope.reason }, error: scope.reason };
      emitTrace("write_file", input, out.output, `write_file rejected: ${scope.reason}`);
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

    const stagingId = writeToStaging(filePath, content, { beforeContent, taskId: context.taskId });
    const output: Record<string, unknown> = { stagingId, path: filePath };
    emitTrace("write_file", { path: filePath }, output, "write_file ok (staged)");
    return { success: true, output };
  }

  if (tool === "get_ast") {
    const filePath = typeof input.path === "string" ? input.path : "";
    if (!filePath) {
      const out = { success: false, output: {}, error: "get_ast requires path" };
      emitTrace("get_ast" as const, input, out.output, "get_ast failed: missing path");
      return out;
    }

    const scope = isInPlanScope(filePath, context.plan);
    if (!scope.ok) {
      const out = { success: false, output: { reason: scope.reason }, error: scope.reason };
      emitTrace("get_ast" as const, input, out.output, `get_ast rejected: ${scope.reason}`);
      return out;
    }

    const check = checkPathAllowed(filePath, allowlist, "read");
    if (!check.allowed) {
      const out = { success: false, output: { reason: check.reason }, error: check.reason };
      emitTrace("get_ast" as const, input, out.output, `get_ast rejected: ${check.reason}`);
      return out;
    }

    const res = getAst(context.rootPath, filePath);
    if (!res.success || !res.output) {
      const out = { success: false, output: { path: filePath }, error: res.error ?? "get_ast failed" };
      emitTrace("get_ast" as const, input, out.output, `get_ast failed: ${out.error}`);
      return out;
    }
    const output: Record<string, unknown> = res.output as unknown as Record<string, unknown>;
    emitTrace("get_ast" as const, input, output, "get_ast ok");
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

  if (tool === "list_files") {
    const base = typeof input.base === "string" ? input.base : "";
    const baseRel = base.replace(/\\/g, "/").replace(/^\/+/, "");
    const startDir = path.resolve(context.rootPath, baseRel || ".");
    const results: string[] = [];

    function walk(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        const rel = path.relative(context.rootPath, abs).replace(/\\/g, "/");
        if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.isFile()) {
          const scope = isInPlanScope(rel, context.plan);
          if (!scope.ok) continue;
          const check = checkPathAllowed(rel, allowlist, "read");
          if (!check.allowed) continue;
          results.push(rel);
        }
      }
    }

    try {
      if (fs.existsSync(startDir)) {
        walk(startDir);
      }
      const output: Record<string, unknown> = { files: results };
      emitTrace("read_file", input, output, "list_files ok");
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const out = { success: false, output: {}, error: msg };
      emitTrace("error" as const, { tool: "list_files", input }, out.output, msg);
      return out;
    }
  }

  if (tool === "search_files") {
    const query = typeof input.query === "string" ? input.query : "";
    const base = typeof input.base === "string" ? input.base : "";
    const baseRel = base.replace(/\\/g, "/").replace(/^\/+/, "");
    const startDir = path.resolve(context.rootPath, baseRel || ".");
    const maxMatches =
      typeof input.maxMatches === "number" && input.maxMatches > 0
        ? input.maxMatches
        : 50;
    const results: Array<{
      path: string;
      lines: Array<{ line: number; text: string }>;
    }> = [];

    if (!query) {
      const out = {
        success: false,
        output: {},
        error: "search_files requires query",
      };
      emitTrace("error" as const, { tool: "search_files", input }, out.output, out.error);
      return out;
    }

    function searchFile(rel: string, abs: string) {
      const scope = isInPlanScope(rel, context.plan);
      if (!scope.ok) return;
      const check = checkPathAllowed(rel, allowlist, "read");
      if (!check.allowed) return;
      let content: string;
      try {
        content = fs.readFileSync(abs, "utf-8");
      } catch {
        return;
      }
      const lines = content.split(/\r?\n/);
      const matches: Array<{ line: number; text: string }> = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]!.includes(query)) {
          matches.push({ line: i + 1, text: lines[i]! });
          if (matches.length >= 5) break;
        }
      }
      if (matches.length) {
        results.push({ path: rel, lines: matches });
      }
    }

    function walk(dir: string) {
      if (results.length >= maxMatches) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxMatches) break;
        const abs = path.join(dir, entry.name);
        const rel = path.relative(context.rootPath, abs).replace(/\\/g, "/");
        if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
        if (entry.isDirectory()) {
          walk(abs);
        } else if (entry.isFile()) {
          searchFile(rel, abs);
        }
      }
    }

    try {
      if (fs.existsSync(startDir)) {
        walk(startDir);
      }
      const output: Record<string, unknown> = { matches: results };
      emitTrace("read_file", input, output, "search_files ok");
      return { success: true, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const out = { success: false, output: {}, error: msg };
      emitTrace("error" as const, { tool: "search_files", input }, out.output, msg);
      return out;
    }
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
