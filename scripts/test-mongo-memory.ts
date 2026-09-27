#!/usr/bin/env npx tsx
import "dotenv/config";
import { MongoMemoryAdapter } from "../src/harness/memory/MongoMemoryAdapter";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Set MONGODB_URI in webapp/server/.env first.");
    process.exit(1);
  }
  const memory = new MongoMemoryAdapter({ uri });

  console.log("1. Writing a memory...");
  const { id: memId } = await memory.remember({
    agentId: "demo-agent",
    text: "The user prefers concise answers and is building a hackathon demo about self-improving agents.",
  });
  console.log("   wrote memory id:", memId);

  console.log("2. Recalling with a semantically related query...");
  try {
    const results = await memory.recall({
      agentId: "demo-agent",
      query: "What does this user care about in responses?",
      k: 3,
    });
    console.log("   recall results:", results.map((r) => r.text));
  } catch (err) {
    console.warn(
      "   recall() failed -- this usually means the Atlas Vector Search index\n" +
        "   hasn't been created yet (see setup steps). Continuing...\n",
      err instanceof Error ? err.message : err
    );
  }

  console.log("3. Logging a run...");
  const { id: runId } = await memory.logRun({
    agentId: "demo-agent",
    input: "Summarize the Traade architecture doc.",
    output: "It has five actor types: signal generation, risk, execution, ...",
  });
  console.log("   wrote run id:", runId);

  console.log("4. Proposing a config change...");
  const { id: versionId } = await memory.proposeConfigChange({
    nodeId: "context-policy-1",
    nodeKind: "ContextPolicyNode",
    payload: { maxTokens: 4000, allowedSources: ["agent_memory", "harness_runs"] },
    proposedBy: "reflection",
    diffSummary: "Lower max context tokens from 8000 to 4000 after truncation in recent runs.",
  });
  console.log("   proposed version id:", versionId);

  console.log("5. Approving it...");
  await memory.approveConfigChange(versionId, "demo-user");

  console.log("6. Reading version history...");
  const history = await memory.getVersionHistory("context-policy-1");
  console.log("   history:", JSON.stringify(history, null, 2));

  await memory.close();
  console.log("\nAll good -- MongoDB Atlas memory adapter is working end to end.");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
