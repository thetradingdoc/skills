#!/usr/bin/env npx tsx
/**
 * Run vitest, parse results, create Jira issues for failures.
 * Usage: npx tsx scripts/run-tests-and-report.ts [project-path] [--jira]
 */

import "dotenv/config";
import { execSync, spawnSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { getJiraConfig, testJiraAuth, createIssue, listProjects, getRepoNameFromGit } from "../src/jira/client";

async function main() {
  const args = process.argv.slice(2);
  const createJira = args.includes("--jira");
  const projectPath =
    args.find((a) => !a.startsWith("--")) ??
    path.resolve(__dirname, "../fixtures/sample-project");

  const pkgPath = path.join(projectPath, "package.json");
  const hasVitest =
    fs.existsSync(pkgPath) &&
    JSON.parse(fs.readFileSync(pkgPath, "utf-8")).devDependencies?.vitest;

  if (!hasVitest) {
    console.log("Project has no vitest — skipping unit tests");
    process.exit(0);
  }

  console.log("Running vitest...");
  const jsonPath = path.join(projectPath, ".arch-test-results.json");
  const result = spawnSync(
    "npx",
    ["vitest", "run", "--reporter=json", `--outputFile=${jsonPath}`],
    {
      cwd: projectPath,
      encoding: "utf-8",
      env: { ...process.env, CI: "1" },
    }
  );

  let report: { testResults?: Array<{ name: string; assertionResults?: Array<{ status: string; fullName?: string; title?: string }> }> } = {};
  if (fs.existsSync(jsonPath)) {
    try {
      report = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
      fs.unlinkSync(jsonPath);
    } catch {
      /* ignore */
    }
  }
  const output = result.stdout + result.stderr;

  if (result.status === 0) {
    console.log("✓ All tests passed");
    process.exit(0);
  }

  const failures: { file: string; name: string }[] = [];
  for (const tr of report.testResults ?? []) {
    for (const r of tr.assertionResults ?? []) {
      if (r.status === "failed") {
        failures.push({
          file: tr.name ?? "unknown",
          name: r.fullName ?? r.title ?? "unknown",
        });
      }
    }
  }
  if (failures.length === 0 && (output.includes("FAIL") || result.status !== 0)) {
    failures.push({ file: "unknown", name: "Test failure" });
  }

  console.log("✗", failures.length, "test failure(s)");
  for (const f of failures.slice(0, 5)) {
    console.log("  ", f.file, "—", f.name);
  }

  if (createJira && failures.length > 0) {
    const auth = await testJiraAuth();
    if (!auth.success) {
      console.error("Jira auth failed:", auth.error);
      process.exit(1);
    }
    const config = getJiraConfig()!;
    const projects = await listProjects(config);
    const projectKey = process.env.JIRA_PROJECT_KEY ?? projects[0]?.key;
    if (!projectKey) {
      console.error("No Jira project. Set JIRA_PROJECT_KEY.");
      process.exit(1);
    }
    const repoLabel = getRepoNameFromGit(projectPath);
    const labels = repoLabel ? [repoLabel] : undefined;
    const summary =
      failures.length === 1
        ? `[Test] ${failures[0].name}`
        : `[Test] ${failures.length} failing tests`;
    const description = failures
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
    console.log("  Created Jira issue:", key);
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
