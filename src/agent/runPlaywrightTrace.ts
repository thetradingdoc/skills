/**
 * run_playwright_trace — AGENT_ROADMAP v4 §10c
 * Runs Playwright specs, returns PlaywrightOutput (path-referenced screenshots).
 */

import * as path from "path";
import * as fs from "fs";
import { spawnSync } from "child_process";
import type { RailId } from "./types";
import { emitTrace } from "./traceLogger";

export interface PlaywrightFailure {
  testName: string;
  error: string;
  screenshotPath: string;
  domSnapshot: string;
  consoleErrors: string[];
  networkFailures: Array<{ url: string; status: number }>;
}

export interface PlaywrightOutput {
  passed: boolean;
  spec: string;
  failures: PlaywrightFailure[];
  tracePath: string;
}

const STAGING_TRACES = ".arch-agent-staging/traces";

function collectFailures(
  suites: Array<{
    specs?: Array<{
      title?: string;
      tests?: Array<{
        title?: string;
        results?: Array<{
          status?: string;
          error?: { message?: string };
          attachments?: Array<{ name: string; path?: string }>;
        }>;
      }>;
    }>;
  }>,
  tracesDir: string,
  traceId: string
): PlaywrightFailure[] {
  const failures: PlaywrightFailure[] = [];
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          if (result.status === "failed") {
            const screenPath =
              result.attachments?.find((a) => a.name === "screenshot")?.path ??
              path.join(tracesDir, `${traceId}.png`);
            failures.push({
              testName: spec.title ?? test.title ?? "unknown",
              error: result.error?.message ?? "Test failed",
              screenshotPath: screenPath,
              domSnapshot: "",
              consoleErrors: [],
              networkFailures: [],
            });
          }
        }
      }
    }
  }
  return failures;
}

export function runPlaywrightTrace(
  projectRoot: string,
  specPath: string,
  url: string,
  workingDir?: string
): PlaywrightOutput {
  const cwd = workingDir ?? projectRoot;
  const tracesDir = path.join(cwd, STAGING_TRACES);
  if (!fs.existsSync(path.dirname(tracesDir))) {
    fs.mkdirSync(path.dirname(tracesDir), { recursive: true });
  }
  if (!fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, { recursive: true });
  }
  const traceId = `pw_${Date.now()}`;
  const tracePath = path.join(tracesDir, `${traceId}.zip`);
  const jsonOut = path.join(tracesDir, `${traceId}-results.json`);

  const args = ["playwright", "test", specPath, "--reporter=json"];
  const proc = spawnSync("npx", args, {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      APP_URL: url,
      PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOut,
    },
    maxBuffer: 10 * 1024 * 1024,
  });

  const failures: PlaywrightFailure[] = [];
  let passed = proc.status === 0;

  try {
    const raw = fs.existsSync(jsonOut) ? fs.readFileSync(jsonOut, "utf-8") : "{}";
    const parsed = JSON.parse(raw);
    const suites = parsed?.suites ?? [];
    const collected = collectFailures(suites ?? [], tracesDir, traceId);
    if (collected.length > 0) {
      passed = false;
      failures.push(...collected);
    }
    try {
      fs.unlinkSync(jsonOut);
    } catch {
      /* ignore */
    }
  } catch {
    if (proc.status !== 0) {
      passed = false;
      failures.push({
        testName: path.basename(specPath),
        error: (proc.stderr ?? proc.stdout ?? "Playwright failed").slice(0, 500),
        screenshotPath: path.join(tracesDir, `${traceId}.png`),
        domSnapshot: "",
        consoleErrors: [],
        networkFailures: [],
      });
    }
  }

  return {
    passed,
    spec: specPath,
    failures,
    tracePath,
  };
}

export async function runPlaywrightForRail(
  railId: RailId,
  projectRoot: string,
  sandboxPath: string,
  specs: string[],
  baseUrl: string
): Promise<PlaywrightOutput> {
  let allPassed = true;
  const allFailures: PlaywrightFailure[] = [];
  let lastTracePath = "";

  for (const spec of specs) {
    const result = runPlaywrightTrace(projectRoot, spec, baseUrl, sandboxPath);
    allFailures.push(...result.failures);
    if (!result.passed) {
      allPassed = false;
    }
    lastTracePath = result.tracePath;
    emitTrace({
      role: "reviewer",
      type: result.passed ? "info" : "error",
      message: result.passed
        ? `Playwright spec ${spec} passed for rail ${railId}`
        : `Playwright spec ${spec} failed for rail ${railId}`,
      railId,
      metadata: {
        filePath: spec,
      },
    });
  }

  return {
    passed: allPassed,
    spec: specs.join(", "),
    failures: allFailures,
    tracePath: lastTracePath,
  };
}

