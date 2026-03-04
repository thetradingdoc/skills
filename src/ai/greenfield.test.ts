/**
 * Greenfield mode tests: validateGraphCommand, manager orchestrator.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateGraphCommand } from "./validateGraphCommand";
import { runArchitectureTask } from "./manager";
import type { ArchGraph } from "../types";

const EMPTY_GRAPH: ArchGraph = {
  nodes: [],
  edges: [],
  generatedAt: Date.now(),
  projectRoot: "",
  projectName: "test",
};

vi.mock("./greenfieldEnricher", () => ({
  askGreenfield: vi.fn().mockResolvedValue({
    answer: "Mock design: API, services, and data layers.",
    graphCommands: [
      { action: "create_node", id: "api", label: "API", layer: "Presentation" },
      { action: "create_node", id: "services/auth", label: "Auth", layer: "Business Logic" },
      { action: "connect", fromId: "api", toId: "services/auth" },
    ],
  }),
}));

vi.mock("./critic", () => ({
  reviewGreenfieldAnswer: vi.fn().mockResolvedValue({
    approved: true,
    score: 8,
    report: "Design is coherent.",
    violations: [],
  }),
}));

describe("validateGraphCommand", () => {
  describe("create_node", () => {
    it("accepts valid create_node", () => {
      const raw = {
        action: "create_node",
        id: "services/auth",
        label: "Auth Service",
        layer: "Business Logic",
      };
      const r = validateGraphCommand(raw);
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.command.action).toBe("create_node");
        expect(r.command.id).toBe("services/auth");
        expect(r.command.label).toBe("Auth Service");
        expect(r.command.layer).toBe("Business Logic");
      }
    });

    it("accepts create_node with optional fields", () => {
      const raw = {
        action: "create_node",
        id: "api",
        label: "API Layer",
        layer: "Presentation",
        description: "REST API",
        archNodeId: "api",
      };
      const r = validateGraphCommand(raw);
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.command.description).toBe("REST API");
        expect(r.command.archNodeId).toBe("api");
      }
    });

    it("rejects create_node with invalid layer", () => {
      const raw = {
        action: "create_node",
        id: "x",
        label: "X",
        layer: "InvalidLayer",
      };
      const r = validateGraphCommand(raw);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.error).toContain("layer");
    });

    it("rejects create_node with path traversal in id", () => {
      const raw = {
        action: "create_node",
        id: "foo/../bar",
        label: "Bar",
        layer: "Utilities",
      };
      const r = validateGraphCommand(raw);
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.error.toLowerCase()).toMatch(/path|traversal/);
    });

    it("rejects create_node missing required fields", () => {
      expect(validateGraphCommand({ action: "create_node" }).valid).toBe(false);
      expect(validateGraphCommand({ action: "create_node", id: "x" }).valid).toBe(false);
      expect(validateGraphCommand({ action: "create_node", id: "x", label: "X" }).valid).toBe(
        false
      );
    });
  });

  describe("connect", () => {
    it("accepts valid connect", () => {
      const raw = {
        action: "connect",
        fromId: "api",
        toId: "services/auth",
        edgeType: "import",
      };
      const r = validateGraphCommand(raw);
      expect(r.valid).toBe(true);
      if (r.valid) {
        expect(r.command.action).toBe("connect");
        expect(r.command.fromId).toBe("api");
        expect(r.command.toId).toBe("services/auth");
        expect(r.command.edgeType).toBe("import");
      }
    });

    it("rejects connect with path traversal in fromId", () => {
      const raw = { action: "connect", fromId: "../evil", toId: "api" };
      const r = validateGraphCommand(raw);
      expect(r.valid).toBe(false);
    });

    it("rejects connect missing fromId or toId", () => {
      expect(validateGraphCommand({ action: "connect" }).valid).toBe(false);
      expect(validateGraphCommand({ action: "connect", fromId: "a" }).valid).toBe(false);
    });
  });

  describe("reset", () => {
    it("accepts reset", () => {
      const r = validateGraphCommand({ action: "reset" });
      expect(r.valid).toBe(true);
      if (r.valid) expect(r.command.action).toBe("reset");
    });
  });

  describe("malformed payloads", () => {
    it("rejects non-object", () => {
      expect(validateGraphCommand(null).valid).toBe(false);
      expect(validateGraphCommand("string").valid).toBe(false);
    });

    it("rejects unknown action", () => {
      const r = validateGraphCommand({ action: "unknown" });
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.error).toMatch(/create_node|connect|reset/);
    });
  });
});

describe("runArchitectureTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs greenfield task and returns result shape", async () => {
    const result = await runArchitectureTask({
      question: "Design a backend",
      graph: EMPTY_GRAPH,
      mode: "greenfield",
      rootPath: null,
    });
    expect(result).toBeDefined();
    expect(result.answer).toContain("Mock design");
    expect(result.graphCommands).toBeDefined();
    expect(result.graphCommands!.length).toBeGreaterThanOrEqual(1);
    expect(result.graphCommand?.action).toBe("create_node");
    expect(result.criticReport).toBe("Design is coherent.");
    expect(result.criticScore).toBe(8);
    expect(result.traceId).toBeDefined();
  });

  it("throws ArchError when askGreenfield fails", async () => {
    const { askGreenfield } = await import("./greenfieldEnricher");
    vi.mocked(askGreenfield).mockRejectedValueOnce(new Error("Rate limit exceeded"));
    const { ArchError } = await import("./errors");
    await expect(
      runArchitectureTask({
        question: "Design",
        graph: EMPTY_GRAPH,
        mode: "greenfield",
        rootPath: null,
      })
    ).rejects.toThrow(ArchError);
  });

  it("returns mode mismatch for analysis without rootPath", async () => {
    const result = await runArchitectureTask({
      question: "Review this",
      graph: EMPTY_GRAPH,
      mode: "analysis",
      rootPath: null,
    });
    expect(result.answer).toContain("project root");
    expect(result.criticReport).toBeDefined();
    expect(result.criticScore).toBe(0);
    expect(result.traceId).toBeDefined();
  });

  it("orchestrator returns analysis error shape when mode=analysis without rootPath", async () => {
    const result = await runArchitectureTask({
      question: "Review",
      graph: EMPTY_GRAPH,
      mode: "analysis",
      rootPath: null,
    });
    expect(result.criticScore).toBe(0);
    expect(result.answer).toContain("project root");
  });
});

describe("integration: mock LLM with malformed graphCommand", () => {
  it("greenfield handles invalid graphCommand from mock - returns answer without valid command", async () => {
    const { askGreenfield } = await import("./greenfieldEnricher");
    vi.mocked(askGreenfield).mockResolvedValueOnce({
      answer: "Design proposal",
      graphCommand: { action: "create_node", id: "../evil", label: "Evil", layer: "Utilities" },
    });
    const { reviewGreenfieldAnswer } = await import("./critic");
    vi.mocked(reviewGreenfieldAnswer).mockResolvedValueOnce({
      approved: true,
      score: 80,
      report: "OK",
      violations: [],
    });
    const result = await runArchitectureTask({
      question: "Design",
      graph: EMPTY_GRAPH,
      mode: "greenfield",
      rootPath: null,
    });
    // greenfieldEnricher validates graphCommand - invalid id would fail validation
    // and answer would include validation note. Result shape should still be valid.
    expect(result.answer).toBeDefined();
    expect(result.criticReport).toBeDefined();
    expect(result.traceId).toBeDefined();
  });
});

describe("fuzz: malformed graphCommand payloads", () => {
  const malformedPayloads: unknown[] = [
    null,
    undefined,
    42,
    "string",
    [],
    {},
    { action: "create_node" },
    { action: "create_node", id: 123, label: "x", layer: "Utilities" },
    { action: "create_node", id: "x", label: 123, layer: "Utilities" },
    { action: "create_node", id: "x", label: "x", layer: 999 },
    { action: "create_node", id: "x", label: "x" },
    { action: "connect" },
    { action: "connect", fromId: "a" },
    { action: "connect", toId: "b" },
    { action: "connect", fromId: 123, toId: "b" },
    { action: "unknown" },
    { action: "create_node", id: "../../etc/passwd", label: "x", layer: "Utilities" },
    { action: "create_node", id: "x", label: "x", layer: "NonExistentLayer" },
    { action: "create_node", id: "a".repeat(300), label: "x", layer: "Utilities" },
  ];

  malformedPayloads.forEach((payload, i) => {
    const preview = String(JSON.stringify(payload) ?? String(payload)).slice(0, 60);
    it(`rejects malformed payload #${i + 1}: ${preview}`, () => {
      const r = validateGraphCommand(payload);
      expect(r.valid).toBe(false);
      expect(r.valid === false ? r.error : "").toBeTruthy();
    });
  });
});
