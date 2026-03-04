#!/usr/bin/env npx tsx
/**
 * Generate test stubs from the architecture graph.
 * Usage: npx tsx scripts/generate-tests.ts [project-path]
 * Default: fixtures/sample-project
 */

import "dotenv/config";
import * as path from "path";
import { scanProject } from "../src/analyzer/scanner";
import { detectDrift } from "../src/analyzer/driftDetector";
import { enrichGraph } from "../src/ai/enricher-v2";
import { analyseGraph } from "../src/analysis/graphAnalyser";
import {
  generateTestsFromGraph,
  writeGeneratedTests,
} from "../src/agent/testGenerator";

async function main() {
  const projectPath =
    process.argv[2] ??
    path.resolve(__dirname, "../fixtures/sample-project");

  console.log("Scanning", projectPath, "...");
  let graph = await scanProject(projectPath);
  graph = detectDrift(graph);
  graph = await enrichGraph(graph);
  graph = analyseGraph(graph);

  const tests = generateTestsFromGraph(graph, { projectRoot: projectPath });
  const written = writeGeneratedTests(tests, projectPath);

  console.log("✓ Generated", written.length, "test files");
  for (const p of written.slice(0, 10)) {
    console.log("  ", path.relative(projectPath, p));
  }
  if (written.length > 10) {
    console.log("  ... and", written.length - 10, "more");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
