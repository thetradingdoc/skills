import { describe, expect, it } from "vitest";
import {
  buildBoardSetupAction,
  nextActionsForNode,
  architectureBrief,
} from "./insightsBriefing";
import { evaluateDesign } from "./designRules";
import type { ArchGraph, ArchNode } from "./types";

function node(partial: Partial<ArchNode> & { id: string; label: string }): ArchNode {
  return {
    layer: "Presentation",
    files: [],
    ...partial,
  } as ArchNode;
}

function tradingScanGraph(nodes: ArchNode[]): ArchGraph {
  return {
    projectName: "trading-agent",
    projectRoot: "/tmp/trading-agent",
    nodes,
    edges: [],
  } as ArchGraph;
}

describe("Insights spine SETUP UX", () => {
  it("emits a single board-setup action for Trading Chat (not dual blockers)", () => {
    const chat = node({
      id: "trading-chat-service",
      label: "Trading Chat Service",
      files: ["middleware-platform/services/trading-chat-service.js"],
    });
    const mid = node({
      id: "middleware-platform",
      label: "Middleware Platform",
      layer: "Data Access",
      files: ["middleware-platform/server.js", "middleware-platform/database.js"],
    });
    const g = tradingScanGraph([chat, mid]);
    const findings = evaluateDesign(g);
    const actions = nextActionsForNode(g, chat, findings);
    const spine = actions.filter((a) => a.kind === "spine");
    expect(spine).toHaveLength(1);
    expect(spine[0]!.id).toBe("board-setup");
    expect(spine[0]!.severity).toBe("warning");
    expect(spine[0]!.priority).toBe("high");
    expect(actions.some((a) => a.id === "wire-ingress")).toBe(false);
    expect(actions.some((a) => a.id.includes("missing_trading_spine"))).toBe(false);
  });

  it("buildBoardSetupAction uses workspace-level setup copy", () => {
    const a = buildBoardSetupAction();
    expect(a.title.toLowerCase()).toContain("money-path");
    expect(a.detail.toLowerCase()).toContain("workspace");
    expect(a.kind).toBe("spine");
  });

  it("architecture brief describes code map vs money path", () => {
    const chat = node({ id: "trading-chat", label: "Trading Chat" });
    const g = tradingScanGraph([chat]);
    const brief = architectureBrief(g);
    expect(brief.toLowerCase()).toMatch(/code map|money path/);
    expect(brief.toLowerCase()).not.toMatch(/broken/);
  });
});
