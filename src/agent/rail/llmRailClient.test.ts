import { describe, it, expect, vi } from "vitest";
import type { ArchitectureChatHistory } from "../../types";
import type { Rail } from "../types";
import { buildRailContext } from "./context";

vi.mock("./context", () => {
  return {
    buildRailContext: vi.fn((rail: Rail, history: ArchitectureChatHistory, _budget: number) => {
      return [
        {
          role: "system",
          content: `RAIL OUTCOME: ${rail.frozenOutcome ?? rail.outcome}`,
        },
        ...history,
      ] as ArchitectureChatHistory;
    }),
  };
});

describe("rail context anchor uses frozen outcome", () => {
  it("keeps the same frozen outcome anchor across multiple calls", () => {
    const rail: Rail = {
      id: "rail-multi",
      version: 1,
      outcome: "Mutable outcome",
      frozenOutcome: "Frozen outcome",
      trigger: { source: "chat", userMessage: "do X", sessionId: "sess-rail" },
      archetype: "ui-api-external",
      logicPath: [],
      frozenLogicPath: [],
      baselineNodeIds: [],
      state: "EXECUTING",
      activeAgent: "executor",
      tasks: [],
      jiraKeys: [],
      traceIds: [],
      overlaps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: "agent",
      sessionId: "sess-rail",
      snapshotPath: undefined,
      traces: [],
      telemetry: undefined,
      hallucinationIndex: undefined,
      hallucinationAcknowledgedAt: undefined,
    };

    const history: ArchitectureChatHistory = [
      { role: "user", content: "turn 1" },
      { role: "assistant", content: "turn 2" },
    ];

    const calls = [];
    for (let i = 0; i < 3; i++) {
      const ctx = buildRailContext(rail, history, 200);
      const system = ctx.find((m) => m.role === "system")!;
      calls.push(system.content);
    }

    for (const c of calls) {
      expect(c).toContain("Frozen outcome");
      expect(c).not.toContain("Mutable outcome");
    }
  });
});

