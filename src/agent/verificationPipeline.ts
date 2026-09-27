/**
 * Verification pipeline — lint → vitest → playwright, with structured error feedback for agents.
 */

import { runLint } from "./runLint.js";
import { runVitest } from "./runVitest.js";
import {
  runPlaywrightForRail,
  discoverPlaywrightSpecs,
  mapSpecsToScope,
} from "./runPlaywrightTrace.js";
import type { RailId } from "./types.js";

export interface VerificationResult {
  passed: boolean;
  lint: import("./runLint.js").LintOutput;
  vitest: import("./runVitest.js").VitestOutput;
  playwright: import("./runPlaywrightTrace.js").PlaywrightOutput | null;
  /** Agent-facing summary of failures for self-correction. */
  errorFeedback: string;
}

/** A truthful, user-readable account of checks that actually ran. */
export function summarizeVerification(result: VerificationResult): string {
  const checks = [`Lint ${result.lint.passed ? "passed" : "failed"}`];
  const { total, passed, failed } = result.vitest.summary;
  checks.push(total > 0
    ? `Vitest ${passed}/${total} passed${failed ? `, ${failed} failed` : ""}`
    : "Vitest collected 0 tests");
  checks.push(result.playwright
    ? `Playwright ${result.playwright.passed ? "passed" : "failed"}`
    : "Playwright not run (no matching specs)");
  return checks.join(" · ");
}

export interface VerificationPipelineOptions {
  projectRoot: string;
  sandboxPath: string;
  railId?: RailId;
  baseUrl?: string;
  /** Specs to run; if absent, discovers all or uses scope. */
  specPaths?: string[];
  /** Scope for spec discovery: nodeIds or routes for scoped verification. */
  scope?: { nodeIds?: string[]; routes?: string[] };
}

/**
 * Run the full verification pipeline: lint → vitest → playwright.
 * Returns structured result and error feedback for agent self-correction.
 */
export async function runVerificationPipeline(
  opts: VerificationPipelineOptions
): Promise<VerificationResult> {
  const { projectRoot, sandboxPath, railId, baseUrl, specPaths, scope } = opts;
  const url = baseUrl ?? process.env.APP_URL ?? "http://127.0.0.1:4173";

  const lint = runLint(projectRoot, undefined, sandboxPath);
  const vitest = runVitest(projectRoot, undefined, sandboxPath);

  const specs =
    specPaths ??
    (scope ? mapSpecsToScope(projectRoot, scope) : discoverPlaywrightSpecs(projectRoot));
  let playwright: VerificationResult["playwright"] = null;
  if (specs.length > 0) {
    playwright = await runPlaywrightForRail(
      railId ?? ("verify" as RailId),
      projectRoot,
      sandboxPath,
      specs,
      url
    );
  }

  const passed =
    lint.passed &&
    vitest.passed &&
    (!playwright || playwright.passed);

  const errorParts: string[] = [];
  if (!lint.passed) {
    errorParts.push(
      `Lint errors (${lint.errors.length}):\n${lint.errors
        .slice(0, 8)
        .map((e) => `  ${e.filePath}:${e.line}:${e.column} - ${e.message}`)
        .join("\n")}`
    );
  }
  if (!vitest.passed) {
    errorParts.push(
      `Vitest failures (${vitest.failures.length}):\n${vitest.failures
        .slice(0, 5)
        .map((f) => `  ${f.testName} (${f.filePath}): ${f.error.slice(0, 200)}`)
        .join("\n")}`
    );
  }
  if (playwright && !playwright.passed) {
    errorParts.push(
      `Playwright failures:\n${playwright.failures
        .slice(0, 5)
        .map((f) => `  ${f.testName}: ${f.error.slice(0, 200)}`)
        .join("\n")}`
    );
  }
  const errorFeedback = errorParts.join("\n\n");

  return {
    passed,
    lint,
    vitest,
    playwright,
    errorFeedback,
  };
}
