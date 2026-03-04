import * as path from "path";
import { scanProject } from "../src/analyzer/scanner";

async function main() {
  const rootPath = path.resolve(__dirname, "../fixtures/sample-project");
  const graph = await scanProject(rootPath);

  console.log("projectRoot:", graph.projectRoot);
  console.log("first 3 nodes and their files:");
  for (const node of graph.nodes.slice(0, 3)) {
    console.log("node.id:", node.id);
    console.log("  files:", node.files);
  }
}

main().catch((err) => {
  console.error("debug-paths error", err);
  process.exit(1);
});

