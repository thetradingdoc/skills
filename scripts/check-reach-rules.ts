#!/usr/bin/env npx tsx
/**
 * CI entrypoint: evaluate reach.rules against a scanned repo.
 * Usage: npx tsx scripts/check-reach-rules.ts <repo-path>
 * Exit 1 only on non-baselined FAIL. UNEVALUABLE does not fail CI.
 */
import * as fs from "fs";
import * as path from "path";
import { buildAgentInventory } from "./agent-inventory";
import {
  loadClassifyConfig,
  clearDatabaseCache,
  scrubExtractionNoise,
  writeClassifyConfig,
} from "./resource-trace";
import {
  evaluateReachRules,
  generateStarterRules,
  readReachRules,
  writeReachRules,
} from "./reach-rules";

const repoRoot = process.argv[2];
if (!repoRoot) {
  console.error("Usage: npx tsx scripts/check-reach-rules.ts <repo-path>");
  process.exit(2);
}

const abs = path.resolve(repoRoot);
const productRoot = path.resolve(__dirname, "..");

clearDatabaseCache();
const cfg = loadClassifyConfig(productRoot);
const inventory = buildAgentInventory(abs);
scrubExtractionNoise(cfg);
writeClassifyConfig(productRoot, cfg);

let rulesText = readReachRules(productRoot);
if (!rulesText.trim()) {
  rulesText = generateStarterRules(inventory);
  writeReachRules(productRoot, rulesText);
}

const report = evaluateReachRules(inventory, rulesText, productRoot);
const out = {
  ok: report.exitCode === 0,
  exitCode: report.exitCode,
  ciLine: report.ciLine,
  confidenceOfReaches: report.confidenceOfReaches,
  summary: report.summary,
  evaluations: report.evaluations.map((e) => ({
    rule: e.rule.raw,
    status: e.status,
    display: e.display,
    coveragePercent: e.coveragePercent,
    reason: e.reason,
    claim: e.claim ?? null,
    unevaluableCount: e.unevaluableCount ?? null,
  })),
  rules: rulesText,
};

console.log(JSON.stringify(out, null, 2));
process.exit(report.exitCode);
