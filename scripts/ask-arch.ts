import "dotenv/config";
import path from "path";
import { scanProject } from "../src/analyzer/scanner";
import { detectDrift } from "../src/analyzer/driftDetector";
import { enrichGraph as enrichGraphV2 } from "../src/ai/enricher-v2";
import { analyseGraph } from "../src/analysis/graphAnalyser";
import { scanContracts } from "../src/agent/contractScanner";
import { scanDocumentReferences } from "../src/agent/referenceScanner";
import { scanEnvironmentGaps } from "../src/agent/envScanner";
import { runArchitectureTask } from "../src/ai/manager";

async function main() {
  const [, , ...rest] = process.argv;
  const question = rest.join(" ").trim();

  if (!question) {
    console.error(
      "Usage: tsx scripts/ask-arch.ts \"Your architecture question here\""
    );
    process.exit(1);
  }

  const rootPath = process.cwd();
  console.error(`[ask-arch] Root: ${rootPath}`);
  console.error(`[ask-arch] Question: ${question}`);

  const findings = [
    ...scanContracts(rootPath),
    ...scanDocumentReferences(rootPath),
    ...scanEnvironmentGaps(rootPath),
  ];

  console.error("[ask-arch] Scanning project...");
  let graph = await scanProject(rootPath, findings);
  console.error("[ask-arch] Detecting drift...");
  graph = detectDrift(graph);
  console.error("[ask-arch] Enriching graph...");
  graph = await enrichGraphV2(graph, process.env.OPENAI_API_KEY);
  console.error("[ask-arch] Analysing graph...");
  graph = analyseGraph(graph);

  const apiKeyOpenAI = process.env.OPENAI_API_KEY;
  const apiKeyClaude = process.env.ANTHROPIC_API_KEY;

  if (!apiKeyClaude && !apiKeyOpenAI) {
    console.error(
      "Warning: Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set. The agent may fall back to mock behavior."
    );
  }

  console.error("[ask-arch] Running architecture task via manager...");
  const result = await runArchitectureTask({
    question,
    graph,
    rootPath: path.resolve(rootPath),
    apiKeyOpenAI,
    apiKeyClaude,
    findings,
  });

  console.log("=== ANSWER ===");
  console.log(result.answer);

  if (result.graphCommand) {
    console.log("\n=== GRAPH COMMAND ===");
    console.log(JSON.stringify(result.graphCommand, null, 2));
  }

  if (typeof result.criticScore === "number") {
    console.log("\n=== CRITIC SCORE ===");
    console.log(result.criticScore);
  }

  if (result.criticReport) {
    console.log("\n=== CRITIC REPORT ===");
    console.log(result.criticReport);
  }
}

main().catch((err) => {
  console.error(
    "[ask-arch] Fatal error:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});

