#!/usr/bin/env npx tsx
/**
 * Scan fixture project, find a violation or drift, create a Jira issue.
 * Usage: npx tsx scripts/test-jira-create-issue.ts
 * Requires: JIRA_* in .env, optionally JIRA_PROJECT_KEY
 */

import "dotenv/config";
import * as path from "path";
import { scanProject } from "../src/analyzer/scanner";
import { detectDrift } from "../src/analyzer/driftDetector";
import { enrichGraph } from "../src/ai/enricher-v2";
import { analyseGraph } from "../src/analysis/graphAnalyser";
import {
  getJiraConfig,
  listProjects,
  createIssue,
  testJiraAuth,
  getRepoNameFromGit,
} from "../src/jira/client";

const FIXTURE_PATH = path.resolve(__dirname, "../fixtures/sample-project");

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const auth = await testJiraAuth();
  if (!auth.success && !dryRun) {
    console.error("✗ Jira auth failed:", auth.error);
    process.exit(1);
  }
  if (dryRun) {
    console.log("--dry-run: skipping Jira auth and create");
  }

  const config = getJiraConfig();
  if (!config) {
    console.error("✗ Missing Jira config");
    process.exit(1);
  }

  let graph = await scanProject(FIXTURE_PATH);
  graph = detectDrift(graph);
  graph = await enrichGraph(graph);
  graph = analyseGraph(graph);

  const driftEdges = graph.edges.filter((e) => e.isDrift);
  const violationEdges = graph.edges.filter((e) => e.isLayerViolation);

  const targetEdge = driftEdges[0] ?? violationEdges[0];
  if (!targetEdge) {
    console.log("No drift or layer violations found in fixture — nothing to create");
    process.exit(0);
  }

  if (dryRun) {
    console.log("✓ Would create Jira issue for:", targetEdge.source, "→", targetEdge.target);
    console.log("  Reason:", targetEdge.driftReason ?? "Layer violation");
    process.exit(0);
  }

  const projectKey =
    process.env.JIRA_PROJECT_KEY ??
    (await listProjects(config))[0]?.key;

  if (!projectKey) {
    console.error("✗ No project found. Set JIRA_PROJECT_KEY in .env or ensure account has access.");
    process.exit(1);
  }

  const reason = targetEdge.driftReason ?? "Layer violation";
  const summary = `[Arch] ${targetEdge.source} → ${targetEdge.target}`;
  const description = `${reason}\n\nSource: ${targetEdge.source}\nTarget: ${targetEdge.target}`;
  const repoLabel = getRepoNameFromGit(FIXTURE_PATH);
  const labels = repoLabel ? [repoLabel] : undefined;

  const { key } = await createIssue(config, {
    projectKey,
    summary,
    description,
    issueType: "Bug",
    labels,
  });

  console.log("✓ Created Jira issue:", key);
  console.log(`  ${config.baseUrl}/browse/${key}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
