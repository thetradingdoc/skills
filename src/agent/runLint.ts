/**
 * run_lint — AGENT_ROADMAP v4 §4c
 * Runs ESLint/TypeScript check on paths. Returns LintOutput.
 */

import * as path from "path";
import { spawnSync } from "child_process";

export interface LintOutput {
  passed: boolean;
  errors: Array<{
    filePath: string;
    line: number;
    column: number;
    message: string;
    ruleId: string;
    severity: "error" | "warning";
  }>;
}

export function runLint(projectRoot: string, paths?: string[], workingDir?: string): LintOutput {
  const errors: LintOutput["errors"] = [];

  // Try tsc first (catches type errors)
  const tscProc = spawnSync("npx", ["tsc", "--noEmit", "--pretty", "false"], {
    cwd: workingDir ?? projectRoot,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });

  if (tscProc.status !== 0 && tscProc.stderr) {
    const root = path.resolve(projectRoot);
    const lines = tscProc.stderr.split("\n");
    for (const line of lines) {
      const match = line.match(/^([^(]+)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/);
      if (match) {
        const [, filePath, lineNum, col, message] = match;
        const resolved = path.isAbsolute(filePath?.trim() ?? "")
          ? filePath!.trim()
          : path.join(root, filePath?.trim() ?? "");
        const rel = path.relative(root, resolved).replace(/\\/g, "/");
        errors.push({
          filePath: rel,
          line: parseInt(lineNum ?? "0", 10),
          column: parseInt(col ?? "0", 10),
          message: message ?? "",
          ruleId: "tsc",
          severity: "error",
        });
      }
    }
  }

  // Try ESLint if configured
  const lintPaths = paths?.length ? paths : ["src"];
  const eslintProc = spawnSync("npx", ["eslint", ...lintPaths, "--format", "json"], {
    cwd: workingDir ?? projectRoot,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });

  // eslint exits 1 on findings, 2 on fatal
  if (eslintProc.stdout) {
    try {
      const out = JSON.parse(eslintProc.stdout) as Array<{
        filePath: string;
        messages: Array<{
          line: number;
          column: number;
          message: string;
          ruleId: string;
          severity: number;
        }>;
      }>;
      const root = path.resolve(workingDir ?? projectRoot);
      for (const file of out) {
        const rel = path.relative(root, path.isAbsolute(file.filePath) ? file.filePath : path.join(root, file.filePath)).replace(/\\/g, "/");
        for (const m of file.messages) {
          errors.push({
            filePath: rel,
            line: m.line,
            column: m.column,
            message: m.message,
            ruleId: m.ruleId ?? "unknown",
            severity: m.severity === 2 ? "error" : "warning",
          });
        }
      }
    } catch {
      // ESLint not configured or output not JSON
    }
  }

  return {
    passed: errors.filter((e) => e.severity === "error").length === 0,
    errors,
  };
}
