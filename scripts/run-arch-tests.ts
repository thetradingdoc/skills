#!/usr/bin/env npx tsx
/**
 * Run architecture validation: scan + analyse + rules check.
 * Outputs pass/fail. With --jira, creates Jira issues for violations.
 * Usage: npx tsx scripts/run-arch-tests.ts [project-path] [--jira]
 */

import "dotenv/config";
import * as path from "path";
import { scanProject } from "../src/analyzer/scanner";
import { detectDrift } from "../src/analyzer/driftDetector";
import { enrichGraph } from "../src/ai/enricher-v2";
import { analyseGraph } from "../src/analysis/graphAnalyser";
import { getJiraConfig, testJiraAuth, createIssue, listProjects, getRepoNameFromGit } from "../src/jira/client";

async function main() {
  const args = process.argv.slice(2);
  const createJira = args.includes("--jira");
  const projectPath =
    args.find((a) => !a.startsWith("--")) ??
    path.resolve(__dirname, "../fixtures/sample-project");

  console.log("Scanning", projectPath, "...");
  let graph = await scanProject(projectPath);
  graph = detectDrift(graph);
  graph = await enrichGraph(graph);
  graph = analyseGraph(graph);

  const driftEdges = graph.edges.filter((e) => e.isDrift);
  const violationEdges = graph.edges.filter((e) => e.isLayerViolation);
  const issues = [...driftEdges, ...violationEdges.filter((e) => !e.isDrift)];

  if (issues.length === 0) {
    console.log("✓ No architectural violations");
    process.exit(0);
  }

  console.log("✗", issues.length, "violation(s) found:");
  for (const e of issues.slice(0, 10)) {
    console.log("  ", e.source, "→", e.target, ":", e.driftReason ?? "layer violation");
  }
  if (issues.length > 10) {
    console.log("  ... and", issues.length - 10, "more");
  }

  if (createJira) {
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
    for (const edge of issues.slice(0, 5)) {
      const { key } = await createIssue(config, {
        projectKey,
        summary: `[Arch] ${edge.source} → ${edge.target}`,
        description: edge.driftReason ?? "Layer violation",
        issueType: "Bug",
        labels,
      });
      console.log("  Created", key);
    }
  }

  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
