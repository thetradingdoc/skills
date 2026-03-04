import { describe, it, expect } from "vitest";
import * as path from "path";
import { scanProject } from "../analyzer/scanner";
import { detectDrift } from "../analyzer/driftDetector";

const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/sample-project");

describe("scanner", () => {
  it("scans fixture project and produces graph", async () => {
    const graph = await scanProject(FIXTURE_PATH);
    expect(graph.nodes.length).toBeGreaterThanOrEqual(5);
    expect(graph.edges.length).toBeGreaterThanOrEqual(4);
    expect(graph.projectRoot).toBe(FIXTURE_PATH);
  });

  it("resolves path aliases (@/, #lib/, ~/utils/)", async () => {
    const graph = await scanProject(FIXTURE_PATH);
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain("src/auth");
    expect(nodeIds).toContain("src/shared");
    expect(nodeIds).toContain("lib");
    const hasAliasEdge =
      graph.edges.some((e) => e.source === "src/auth" && e.target === "src/shared") ||
      graph.edges.some((e) => e.source === "src/api" && e.target === "lib");
    expect(hasAliasEdge).toBe(true);
  });
});

describe("driftDetector", () => {
  it("marks auth->api edge as drift", async () => {
    let graph = await scanProject(FIXTURE_PATH);
    // Auth imports api via session.ts -> ../../api/client
    const authToApiEdge = graph.edges.find(
      (e) => e.source === "src/auth" && e.target === "src/api"
    );
    expect(authToApiEdge).toBeDefined();
    graph = detectDrift(graph);
    const driftEdges = graph.edges.filter((e) => e.isDrift);
    const authToApi = driftEdges.find(
      (e) => e.source === "src/auth" && e.target === "src/api"
    );
    expect(authToApi).toBeDefined();
    expect(authToApi?.driftReason).toBeDefined();
  });

  it("marks src/scripts as deprecated", async () => {
    let graph = await scanProject(FIXTURE_PATH);
    graph = detectDrift(graph);
    const scripts = graph.nodes.find((n) => n.id === "src/scripts");
    expect(scripts?.status).toBe("deprecated");
  });
});
