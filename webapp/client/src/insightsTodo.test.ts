import { describe, expect, it } from "vitest";
import {
  buildInsightsTodoPayload,
  isSpineRemediationAction,
  isSpineRemediationTodo,
} from "./insightsTodo";
import type { ArchNode } from "./types";
import type { NodeNextAction } from "./insightsBriefing";

const node = {
  id: "n1",
  label: "Trading Chat API",
  files: ["middleware-platform/routes/trading-chat.js"],
} as ArchNode;

describe("Gate E insights sourceNodeId", () => {
  it("includes sourceNodeId for POST /todos attribution", () => {
    const payload = buildInsightsTodoPayload(node, {
      id: "no_auth",
      title: "No authentication",
      detail: "Add auth",
      priority: "blocker",
      severity: "blocker",
      kind: "code",
    } as NodeNextAction);
    expect(payload.sourceNodeId).toBe("n1");
  });
});

describe("spine remediation guards", () => {
  it("treats spine kind, board-setup, and legacy wire-ingress as spine remediation", () => {
    expect(
      isSpineRemediationAction({
        kind: "spine",
        id: "board-setup",
        title: "Switch to money-path board",
        taskTitle: "Apply trading agent spine",
      } as NodeNextAction)
    ).toBe(true);
    expect(
      isSpineRemediationAction({
        kind: "spine",
        id: "wire-ingress",
        title: "Wire ingress",
        taskTitle: "Apply trading agent spine",
      } as NodeNextAction)
    ).toBe(true);
  });

  it("refuses to build Insights todos for spine actions", () => {
    expect(() =>
      buildInsightsTodoPayload(node, {
        id: "board-setup",
        title: "Switch to money-path board",
        detail: "Apply trading spine",
        priority: "high",
        severity: "warning",
        kind: "spine",
        taskTitle: "Apply trading agent spine",
      } as NodeNextAction)
    ).toThrow(/Apply trading spine/);
  });

  it("detects existing spine todos by title/source_path", () => {
    expect(
      isSpineRemediationTodo({
        title: "Apply trading agent spine",
        source_path: "insights:n1:board-setup",
      })
    ).toBe(true);
    expect(
      isSpineRemediationTodo({
        title: "Trading scan is missing the architecture spine",
        source_path: "insights:n1:missing_trading_spine",
      })
    ).toBe(true);
    expect(
      isSpineRemediationTodo({
        title: '"Trading Chat API" has no authentication',
        source_path: "insights:n1:no_auth",
      })
    ).toBe(false);
  });
});
