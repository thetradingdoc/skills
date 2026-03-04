#!/usr/bin/env npx tsx
/**
 * Verify the full pipeline: generate tests, run arch validation, optionally Jira.
 * Usage: npx tsx scripts/test-verify-pipeline.ts [--jira] [--generate]
 */

import "dotenv/config";
import * as path from "path";
import { execSync } from "child_process";

const projectPath = path.resolve(__dirname, "../fixtures/sample-project");

async function main() {
  const doJira = process.argv.includes("--jira");
  const doGenerate = process.argv.includes("--generate");

  console.log("=== Verify Pipeline ===\n");

  if (doGenerate) {
    console.log("1. Generating tests...");
    execSync(`tsx scripts/generate-tests.ts "${projectPath}"`, {
      stdio: "inherit",
      cwd: path.resolve(__dirname, ".."),
    });
    console.log("");
  }

  console.log("2. Running architecture validation (scan + rules + violations)...");
  const args = [projectPath];
  if (doJira) args.push("--jira");
  try {
    execSync(`tsx scripts/run-arch-tests.ts ${args.join(" ")}`, {
      stdio: "inherit",
      cwd: path.resolve(__dirname, ".."),
    });
  } catch {
    if (doJira) {
      console.log("\n✓ Pipeline complete (violations → Jira issues created)");
    }
    process.exit(1);
  }

  console.log("\n✓ Pipeline complete — no violations");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
