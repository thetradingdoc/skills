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

export function discoverPlaywrightSpecs(projectRoot: string): string[] {
  const candidates: string[] = [];
  const roots = ["tests", "playwright", "e2e"];
  const exts = [".spec.ts", ".spec.tsx", ".spec.js", ".spec.jsx", ".test.ts", ".test.js"];
  const seen = new Set<string>();

  function walk(dir: string, depth: number) {
    if (depth <= 0) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth - 1);
      } else {
        if (exts.some((ext) => e.name.endsWith(ext))) {
          const rel = path.relative(projectRoot, full).replace(/\\/g, "/");
          if (!seen.has(rel)) {
            seen.add(rel);
            candidates.push(rel);
          }
        }
      }
    }
  }

  for (const root of roots) {
    const full = path.join(projectRoot, root);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      walk(full, 4);
    }
  }

  return candidates.sort();
}

export interface SpecMapping {
  spec: string;
  routes: string[];
  modules: string[];
}

/**
 * Parse a spec file for route patterns (page.goto, route matching).
 * Returns routes (path segments) and modules inferred from spec path.
 */
function parseSpecForRoutes(projectRoot: string, specPath: string): SpecMapping {
  const full = path.join(projectRoot, specPath);
  const routes: string[] = [];
  const modules: string[] = [];

  // Infer module from spec path: tests/auth/login.spec.ts -> auth, login
  const rel = specPath.replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  if (parts.length >= 2) {
    modules.push(parts[0]!);
    if (parts.length >= 3) modules.push(parts.slice(0, 2).join("/"));
  }

  try {
    const content = fs.readFileSync(full, "utf-8");
    // page.goto("/route") or page.goto(`/route`)
    const gotoMatches = content.matchAll(
      /page\.goto\s*\(\s*[`'"](\/[^`'"]*)[`'"]\s*\)/g
    );
    for (const m of gotoMatches) {
      const route = m[1]?.split("?")[0]?.replace(/\/$/, "") ?? "";
      if (route && !routes.includes(route)) routes.push(route);
    }
    // Route-like patterns: /auth/login, /api/users
    const routeLike = content.matchAll(/[`'"](\/[a-zA-Z0-9/_-]+)[`'"]/g);
    for (const m of routeLike) {
      const r = m[1];
      if (r && r.startsWith("/") && r.length > 1 && !routes.includes(r)) {
        routes.push(r);
      }
    }
  } catch {
    /* ignore parse errors */
  }

  return { spec: specPath, routes, modules };
}

/**
 * Build spec-to-scope mapping for all discovered specs.
 */
export function discoverPlaywrightSpecMappings(
  projectRoot: string
): SpecMapping[] {
  const specs = discoverPlaywrightSpecs(projectRoot);
  return specs.map((s) => parseSpecForRoutes(projectRoot, s));
}

/**
 * Filter specs to those matching the given nodeIds or routes.
 * If scope is empty, returns all specs.
 */
export function mapSpecsToScope(
  projectRoot: string,
  options?: { nodeIds?: string[]; routes?: string[] }
): string[] {
  if (!options?.nodeIds?.length && !options?.routes?.length) {
    return discoverPlaywrightSpecs(projectRoot);
  }
  const mappings = discoverPlaywrightSpecMappings(projectRoot);
  const nodeIds = new Set(
    (options.nodeIds ?? []).map((n) => n.replace(/\/$/, ""))
  );
  const routes = new Set(
    (options.routes ?? []).map((r) => r.replace(/\/$/, ""))
  );

  const matched = new Set<string>();
  for (const m of mappings) {
    const moduleMatch =
      nodeIds.size === 0 ||
      m.modules.some((mod) =>
        Array.from(nodeIds).some((n) => mod.includes(n) || n.includes(mod))
      );
    const routeMatch =
      routes.size === 0 ||
      m.routes.some((r) =>
        Array.from(routes).some((rt) => r === rt || r.startsWith(rt + "/"))
      );
    if (moduleMatch || routeMatch) {
      matched.add(m.spec);
    }
  }
  if (matched.size > 0) return [...matched].sort();
  return discoverPlaywrightSpecs(projectRoot);
}

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

