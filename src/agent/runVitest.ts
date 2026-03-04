/**
 * run_vitest — AGENT_ROADMAP v4 §4c
 * Runs Vitest. Returns VitestOutput.
 */

import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";

export interface VitestOutput {
  passed: boolean;
  summary: { total: number; passed: number; failed: number; skipped: number };
  failures: Array<{
    testName: string;
    filePath: string;
    error: string;
    stackTrace: string;
  }>;
}

export function runVitest(projectRoot: string, pattern?: string, workingDir?: string): VitestOutput {
  const cwd = workingDir ?? projectRoot;
  const jsonFile = path.join(cwd, ".arch-agent-staging", "vitest-results.json");
  const stagingDir = path.dirname(jsonFile);
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }
  const args = ["vitest", "run", "--reporter=json", `--outputFile.json=${jsonFile}`];
  if (pattern) args.push("--testNamePattern", pattern);

  const proc = spawnSync("npx", args, {
    cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const failures: VitestOutput["failures"] = [];
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const raw = fs.existsSync(jsonFile) ? fs.readFileSync(jsonFile, "utf-8") : "{}";
    const parsed = JSON.parse(raw);
    const results = parsed?.testResults ?? parsed?.results;
    if (Array.isArray(results)) {
      for (const file of results as Array<{
        name: string;
        assertionResults?: Array<{
          fullName: string;
          status: string;
          failureMessages?: string[];
        }>;
      }>) {
        const filePath = path.relative(cwd, file.name);
        for (const t of file.assertionResults ?? []) {
          total++;
          if (t.status === "passed") passed++;
          else if (t.status === "skipped") skipped++;
          else {
            failed++;
            failures.push({
              testName: t.fullName,
              filePath,
              error: t.failureMessages?.[0] ?? "Test failed",
              stackTrace: t.failureMessages?.join("\n") ?? "",
            });
          }
        }
      }
    }
    try {
      fs.unlinkSync(jsonFile);
    } catch {
      /* ignore */
    }
  } catch {
    if (proc.status !== 0) {
      failures.push({
        testName: pattern ?? "vitest run",
        filePath: ".",
        error: (proc.stderr ?? proc.stdout ?? "Vitest failed").slice(0, 500),
        stackTrace: "",
      });
      failed = 1;
      total = 1;
    }
  }

  return {
    passed: failed === 0,
    summary: { total, passed, failed, skipped },
    failures,
  };
}
