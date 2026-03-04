#!/usr/bin/env npx tsx
/**
 * Full validation pipeline: clone repo, scan, arch validation, unit tests, optional Jira.
 * Outputs JSON to stdout. Progress to stderr.
 * Usage: npx tsx scripts/validate-repo.ts <repo-url> [--jira]
 */

import "dotenv/config";
import { simpleGit } from "simple-git";
import * as fs from "fs";
import * as path from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { spawnSync } from "child_process";
import { scanProject } from "../src/analyzer/scanner";
import { detectDrift } from "../src/analyzer/driftDetector";
import { enrichGraph } from "../src/ai/enricher-v2";
import { analyseGraph } from "../src/analysis/graphAnalyser";
import {
  getJiraConfig,
  testJiraAuth,
  createIssue,
  listProjects,
} from "../src/jira/client";

function log(msg: string) {
  process.stderr.write(msg + "\n");
}

function authUrl(url: string): string {
  const trimmed = url.trim();
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;
  if (!token) return trimmed;
  const match = trimmed.match(/^(https?:\/\/)(github\.com\/[\w.-]+\/[\w.-]+?)(\.git)?\/?$/i);
  if (!match) return trimmed;
  const [, scheme, repoPath] = match;
  return `${scheme}${token}@${repoPath}`;
}

function repoNameFromUrl(url: string): string | null {
  const m = url.match(/(?:github\.com|gitlab\.com|bitbucket\.org)[/:][\w.-]+\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m?.[1] ?? null;
}

interface ArchViolation {
  source: string;
  target: string;
  reason: string;
}

interface TestFailure {
  file: string;
  name: string;
}

interface JiraCreated {
  key: string;
  summary: string;
  type: "arch" | "test";
}

interface ValidateResult {
  graph: unknown;
  archViolations: ArchViolation[];
  archPassed: boolean;
  testFailures: TestFailure[];
  testsRun: boolean;
  testsPassed: boolean | null;
  jiraCreated: JiraCreated[];
  jiraBaseUrl: string | null;
}

async function main() {
  const args = process.argv.slice(2);
  const createJira = args.includes("--jira");
  const repoUrl = args.find((a) => !a.startsWith("--"));
  if (!repoUrl) {
    process.stderr.write("Usage: npx tsx scripts/validate-repo.ts <repo-url> [--jira]\n");
    process.exit(1);
  }

  const dir = path.join(tmpdir(), `arch-validate-${randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });

  const result: ValidateResult = {
    graph: null,
    archViolations: [],
    archPassed: true,
    testFailures: [],
    testsRun: false,
    testsPassed: null,
    jiraCreated: [],
    jiraBaseUrl: getJiraConfig()?.baseUrl ?? null,
  };

  try {
    log("Cloning repository...");
    const cloneUrl = authUrl(repoUrl);
    const git = simpleGit();
    await git.clone(cloneUrl, dir, ["--depth", "1"]);

    log("Scanning and analysing...");
    let graph = await scanProject(dir);
    graph = detectDrift(graph);
    graph = await enrichGraph(graph);
    graph = analyseGraph(graph);

    result.graph = {
      ...graph,
      projectRoot: path.basename(dir),
      nodes: graph.nodes.map((n) => ({ ...n, path: n.id })),
    };

    const driftEdges = graph.edges.filter((e) => e.isDrift);
    const violationEdges = graph.edges.filter((e) => e.isLayerViolation);
    const issues = [...driftEdges, ...violationEdges.filter((e) => !e.isDrift)];

    for (const e of issues) {
      result.archViolations.push({
        source: e.source,
        target: e.target,
        reason: e.driftReason ?? "Layer violation",
      });
    }
    result.archPassed = result.archViolations.length === 0;

    const pkgPath = path.join(dir, "package.json");
    const hasVitest =
      fs.existsSync(pkgPath) &&
      JSON.parse(fs.readFileSync(pkgPath, "utf-8")).devDependencies?.vitest;

    if (hasVitest) {
      log("Running unit tests...");
      const jsonPath = path.join(dir, ".arch-test-results.json");
      const testResult = spawnSync(
        "npx",
        ["vitest", "run", "--reporter=json", `--outputFile=${jsonPath}`],
        { cwd: dir, encoding: "utf-8", env: { ...process.env, CI: "1" } }
      );
      result.testsRun = true;
      result.testsPassed = testResult.status === 0;

      if (fs.existsSync(jsonPath)) {
        try {
          const report = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
            testResults?: Array<{
              name?: string;
              assertionResults?: Array<{ status: string; fullName?: string; title?: string }>;
            }>;
          };
          for (const tr of report.testResults ?? []) {
            for (const r of tr.assertionResults ?? []) {
              if (r.status === "failed") {
                result.testFailures.push({
                  file: tr.name ?? "unknown",
                  name: r.fullName ?? r.title ?? "unknown",
                });
              }
            }
          }
          fs.unlinkSync(jsonPath);
        } catch {
          /* ignore */
        }
      }
      if (result.testFailures.length === 0 && testResult.status !== 0) {
        result.testFailures.push({ file: "unknown", name: "Test failure" });
      }
    }

    if (createJira && (result.archViolations.length > 0 || result.testFailures.length > 0)) {
      const auth = await testJiraAuth();
      if (auth.success) {
        const config = getJiraConfig()!;
        const projects = await listProjects(config);
        const projectKey = process.env.JIRA_PROJECT_KEY ?? projects[0]?.key;
        const repoLabel = repoNameFromUrl(repoUrl);
        const labels = repoLabel ? [repoLabel] : undefined;
        if (projectKey) {
          for (const v of result.archViolations.slice(0, 5)) {
            const { key } = await createIssue(config, {
              projectKey,
              summary: `[Arch] ${v.source} → ${v.target}`,
              description: v.reason,
              issueType: "Bug",
              labels,
            });
            result.jiraCreated.push({
              key,
              summary: `[Arch] ${v.source} → ${v.target}`,
              type: "arch",
            });
          }
          if (result.testFailures.length > 0) {
            const summary =
              result.testFailures.length === 1
                ? `[Test] ${result.testFailures[0].name}`
                : `[Test] ${result.testFailures.length} failing tests`;
            const description = result.testFailures
              .slice(0, 10)
              .map((f) => `${f.file}: ${f.name}`)
              .join("\n");
            const { key } = await createIssue(config, {
              projectKey,
              summary,
              description,
              issueType: "Bug",
              labels,
            });
            result.jiraCreated.push({ key, summary, type: "test" });
          }
        }
      }
    }
  } finally {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
