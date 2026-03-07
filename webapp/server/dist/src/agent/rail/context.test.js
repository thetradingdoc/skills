"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const context_1 = require("./context");
function makeRail(overrides = {}) {
    const base = {
        id: "rail-ctx",
        version: 1,
        outcome: "Test outcome",
        trigger: { source: "chat", userMessage: "x", sessionId: "sess-ctx" },
        archetype: "ui-api-external",
        logicPath: [],
        state: "EXECUTING",
        frozenOutcome: undefined,
        frozenLogicPath: undefined,
        baselineNodeIds: undefined,
        activeAgent: "executor",
        tasks: [],
        jiraKeys: [],
        traceIds: [],
        overlaps: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: "agent",
        sessionId: "sess-ctx",
        snapshotPath: undefined,
        traces: [],
        telemetry: undefined,
        hallucinationIndex: undefined,
        hallucinationAcknowledgedAt: undefined,
    };
    return { ...base, ...overrides };
}
(0, vitest_1.describe)("buildRailContext Tier 2 overflow", () => {
    (0, vitest_1.it)("never drops the most recent turn even when summarizing", () => {
        const rail = makeRail();
        const history = [];
        for (let i = 0; i < 20; i++) {
            history.push({ role: "user", content: `turn-${i}` });
        }
        const tokenBudget = 50;
        const ctx = (0, context_1.buildRailContext)(rail, history, tokenBudget);
        const allText = ctx.map((m) => m.content).join("\n");
        (0, vitest_1.expect)(allText).toContain("turn-19");
    });
    (0, vitest_1.it)("keeps total tokens within budget", () => {
        const rail = makeRail();
        const history = [];
        for (let i = 0; i < 30; i++) {
            history.push({ role: "user", content: `message-${i} ${"x".repeat(40)}` });
        }
        const tokenBudget = 60;
        const ctx = (0, context_1.buildRailContext)(rail, history, tokenBudget);
        const totalTokens = ctx.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
        (0, vitest_1.expect)(totalTokens).toBeLessThanOrEqual(tokenBudget);
    });
});
function makeRail(overrides = {}) {
    const base = {
        id: "rail-1",
        version: 1,
        outcome: "Implement feature X",
        trigger: { source: "chat", userMessage: "Do X", sessionId: "sess-1" },
        archetype: "ui-api-external",
        logicPath: [
            { step: 1, layer: "UI", nodeId: "ui/button", filePath: "src/ui/Button.tsx", action: "modify" },
            { step: 2, layer: "API", nodeId: "api/endpoint", filePath: "src/api/endpoint.ts", action: "modify" },
        ],
        state: "EXECUTING",
        activeAgent: "executor",
        tasks: [],
        jiraKeys: [],
        traceIds: [],
        overlaps: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        createdBy: "agent",
        sessionId: "sess-1",
        snapshotPath: undefined,
        traces: [],
        telemetry: undefined,
        hallucinationIndex: undefined,
        hallucinationAcknowledgedAt: undefined,
        frozenOutcome: undefined,
        frozenLogicPath: undefined,
        baselineNodeIds: undefined,
    };
    return { ...base, ...overrides };
}
(0, vitest_1.describe)("buildRailContext", () => {
    (0, vitest_1.it)("uses frozenOutcome and frozenLogicPath when present", () => {
        const rail = makeRail({
            outcome: "Old outcome",
            frozenOutcome: "Frozen outcome",
            logicPath: [],
            frozenLogicPath: [
                { step: 1, layer: "UI", nodeId: "ui/locked", filePath: "src/ui/Locked.tsx", action: "modify" },
            ],
        });
        const history = [];
        const ctx = (0, context_1.buildRailContext)(rail, history, 200);
        const system = ctx.find((m) => m.role === "system");
        (0, vitest_1.expect)(system.content).toContain("Frozen outcome");
        (0, vitest_1.expect)(system.content).toContain("ui/locked");
    });
    (0, vitest_1.it)("scopes Tier 2 history by railId when present", () => {
        const railA = makeRail({ id: "rail-A" });
        const railB = makeRail({ id: "rail-B", sessionId: "sess-2" });
        const history = [
            { role: "user", content: "global-1" },
            { role: "user", content: "A-1", ...{ railId: "rail-A", sessionId: "sess-1" } },
            { role: "assistant", content: "A-2", ...{ railId: "rail-A", sessionId: "sess-1" } },
            { role: "user", content: "B-1", ...{ railId: "rail-B", sessionId: "sess-2" } },
        ];
        const ctxA = (0, context_1.buildRailContext)(railA, history, 200);
        const nonSystemA = ctxA.filter((m) => m.role !== "system").map((m) => m.content);
        (0, vitest_1.expect)(nonSystemA.join(" ")).toContain("A-1");
        (0, vitest_1.expect)(nonSystemA.join(" ")).toContain("A-2");
        (0, vitest_1.expect)(nonSystemA.join(" ")).not.toContain("B-1");
        const ctxB = (0, context_1.buildRailContext)(railB, history, 200);
        const nonSystemB = ctxB.filter((m) => m.role !== "system").map((m) => m.content);
        (0, vitest_1.expect)(nonSystemB.join(" ")).toContain("B-1");
        (0, vitest_1.expect)(nonSystemB.join(" ")).not.toContain("A-1");
    });
    (0, vitest_1.it)("falls back to session-scoped history when railId is missing", () => {
        const rail = makeRail({ id: "rail-A", sessionId: "sess-1" });
        const history = [
            { role: "user", content: "sess-1-msg-1", ...{ sessionId: "sess-1" } },
            { role: "assistant", content: "sess-1-msg-2", ...{ sessionId: "sess-1" } },
            { role: "user", content: "sess-2-msg", ...{ sessionId: "sess-2" } },
        ];
        const ctx = (0, context_1.buildRailContext)(rail, history, 200);
        const nonSystem = ctx.filter((m) => m.role !== "system").map((m) => m.content);
        (0, vitest_1.expect)(nonSystem.join(" ")).toContain("sess-1-msg-1");
        (0, vitest_1.expect)(nonSystem.join(" ")).toContain("sess-1-msg-2");
        (0, vitest_1.expect)(nonSystem.join(" ")).not.toContain("sess-2-msg");
    });
});
