"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const context_1 = require("./context");
vitest_1.vi.mock("./context", () => {
    return {
        buildRailContext: vitest_1.vi.fn((rail, history, _budget) => {
            return [
                {
                    role: "system",
                    content: `RAIL OUTCOME: ${rail.frozenOutcome ?? rail.outcome}`,
                },
                ...history,
            ];
        }),
    };
});
(0, vitest_1.describe)("rail context anchor uses frozen outcome", () => {
    (0, vitest_1.it)("keeps the same frozen outcome anchor across multiple calls", () => {
        const rail = {
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
        const history = [
            { role: "user", content: "turn 1" },
            { role: "assistant", content: "turn 2" },
        ];
        const calls = [];
        for (let i = 0; i < 3; i++) {
            const ctx = (0, context_1.buildRailContext)(rail, history, 200);
            const system = ctx.find((m) => m.role === "system");
            calls.push(system.content);
        }
        for (const c of calls) {
            (0, vitest_1.expect)(c).toContain("Frozen outcome");
            (0, vitest_1.expect)(c).not.toContain("Mutable outcome");
        }
    });
});
