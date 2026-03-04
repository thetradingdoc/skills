"use strict";
/**
 * Greenfield mode tests: validateGraphCommand, manager orchestrator.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validateGraphCommand_1 = require("./validateGraphCommand");
const manager_1 = require("./manager");
const EMPTY_GRAPH = {
    nodes: [],
    edges: [],
    generatedAt: Date.now(),
    projectRoot: "",
    projectName: "test",
};
vitest_1.vi.mock("./greenfieldEnricher", () => ({
    askGreenfield: vitest_1.vi.fn().mockResolvedValue({
        answer: "Mock design: API, services, and data layers.",
        graphCommands: [
            { action: "create_node", id: "api", label: "API", layer: "Presentation" },
            { action: "create_node", id: "services/auth", label: "Auth", layer: "Business Logic" },
            { action: "connect", fromId: "api", toId: "services/auth" },
        ],
    }),
}));
vitest_1.vi.mock("./critic", () => ({
    reviewGreenfieldAnswer: vitest_1.vi.fn().mockResolvedValue({
        approved: true,
        score: 8,
        report: "Design is coherent.",
        violations: [],
    }),
}));
(0, vitest_1.describe)("validateGraphCommand", () => {
    (0, vitest_1.describe)("create_node", () => {
        (0, vitest_1.it)("accepts valid create_node", () => {
            const raw = {
                action: "create_node",
                id: "services/auth",
                label: "Auth Service",
                layer: "Business Logic",
            };
            const r = (0, validateGraphCommand_1.validateGraphCommand)(raw);
            (0, vitest_1.expect)(r.valid).toBe(true);
            if (r.valid) {
                (0, vitest_1.expect)(r.command.action).toBe("create_node");
                (0, vitest_1.expect)(r.command.id).toBe("services/auth");
                (0, vitest_1.expect)(r.command.label).toBe("Auth Service");
                (0, vitest_1.expect)(r.command.layer).toBe("Business Logic");
            }
        });
        (0, vitest_1.it)("accepts create_node with optional fields", () => {
            const raw = {
                action: "create_node",
                id: "api",
                label: "API Layer",
                layer: "Presentation",
                description: "REST API",
                archNodeId: "api",
            };
            const r = (0, validateGraphCommand_1.validateGraphCommand)(raw);
            (0, vitest_1.expect)(r.valid).toBe(true);
            if (r.valid) {
                (0, vitest_1.expect)(r.command.description).toBe("REST API");
                (0, vitest_1.expect)(r.command.archNodeId).toBe("api");
            }
        });
        (0, vitest_1.it)("rejects create_node with invalid layer", () => {
            const raw = {
                action: "create_node",
                id: "x",
                label: "X",
                layer: "InvalidLayer",
            };
            const r = (0, validateGraphCommand_1.validateGraphCommand)(raw);
            (0, vitest_1.expect)(r.valid).toBe(false);
            if (!r.valid)
                (0, vitest_1.expect)(r.error).toContain("layer");
        });
        (0, vitest_1.it)("rejects create_node with path traversal in id", () => {
            const raw = {
                action: "create_node",
                id: "foo/../bar",
                label: "Bar",
                layer: "Utilities",
            };
            const r = (0, validateGraphCommand_1.validateGraphCommand)(raw);
            (0, vitest_1.expect)(r.valid).toBe(false);
            if (!r.valid)
                (0, vitest_1.expect)(r.error.toLowerCase()).toMatch(/path|traversal/);
        });
        (0, vitest_1.it)("rejects create_node missing required fields", () => {
            (0, vitest_1.expect)((0, validateGraphCommand_1.validateGraphCommand)({ action: "create_node" }).valid).toBe(false);
            (0, vitest_1.expect)((0, validateGraphCommand_1.validateGraphCommand)({ action: "create_node", id: "x" }).valid).toBe(false);
            (0, vitest_1.expect)((0, validateGraphCommand_1.validateGraphCommand)({ action: "create_node", id: "x", label: "X" }).valid).toBe(false);
        });
    });
    (0, vitest_1.describe)("connect", () => {
        (0, vitest_1.it)("accepts valid connect", () => {
            const raw = {
                action: "connect",
                fromId: "api",
                toId: "services/auth",
                edgeType: "import",
            };
            const r = (0, validateGraphCommand_1.validateGraphCommand)(raw);
            (0, vitest_1.expect)(r.valid).toBe(true);
            if (r.valid) {
                (0, vitest_1.expect)(r.command.action).toBe("connect");
                (0, vitest_1.expect)(r.command.fromId).toBe("api");
                (0, vitest_1.expect)(r.command.toId).toBe("services/auth");
                (0, vitest_1.expect)(r.command.edgeType).toBe("import");
            }
        });
        (0, vitest_1.it)("rejects connect with path traversal in fromId", () => {
            const raw = { action: "connect", fromId: "../evil", toId: "api" };
            const r = (0, validateGraphCommand_1.validateGraphCommand)(raw);
            (0, vitest_1.expect)(r.valid).toBe(false);
        });
        (0, vitest_1.it)("rejects connect missing fromId or toId", () => {
            (0, vitest_1.expect)((0, validateGraphCommand_1.validateGraphCommand)({ action: "connect" }).valid).toBe(false);
            (0, vitest_1.expect)((0, validateGraphCommand_1.validateGraphCommand)({ action: "connect", fromId: "a" }).valid).toBe(false);
        });
    });
    (0, vitest_1.describe)("reset", () => {
        (0, vitest_1.it)("accepts reset", () => {
            const r = (0, validateGraphCommand_1.validateGraphCommand)({ action: "reset" });
            (0, vitest_1.expect)(r.valid).toBe(true);
            if (r.valid)
                (0, vitest_1.expect)(r.command.action).toBe("reset");
        });
    });
    (0, vitest_1.describe)("malformed payloads", () => {
        (0, vitest_1.it)("rejects non-object", () => {
            (0, vitest_1.expect)((0, validateGraphCommand_1.validateGraphCommand)(null).valid).toBe(false);
            (0, vitest_1.expect)((0, validateGraphCommand_1.validateGraphCommand)("string").valid).toBe(false);
        });
        (0, vitest_1.it)("rejects unknown action", () => {
            const r = (0, validateGraphCommand_1.validateGraphCommand)({ action: "unknown" });
            (0, vitest_1.expect)(r.valid).toBe(false);
            if (!r.valid)
                (0, vitest_1.expect)(r.error).toMatch(/create_node|connect|reset/);
        });
    });
});
(0, vitest_1.describe)("runArchitectureTask", () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.clearAllMocks();
    });
    (0, vitest_1.it)("runs greenfield task and returns result shape", async () => {
        const result = await (0, manager_1.runArchitectureTask)({
            question: "Design a backend",
            graph: EMPTY_GRAPH,
            mode: "greenfield",
            rootPath: null,
        });
        (0, vitest_1.expect)(result).toBeDefined();
        (0, vitest_1.expect)(result.answer).toContain("Mock design");
        (0, vitest_1.expect)(result.graphCommands).toBeDefined();
        (0, vitest_1.expect)(result.graphCommands.length).toBeGreaterThanOrEqual(1);
        (0, vitest_1.expect)(result.graphCommand?.action).toBe("create_node");
        (0, vitest_1.expect)(result.criticReport).toBe("Design is coherent.");
        (0, vitest_1.expect)(result.criticScore).toBe(8);
        (0, vitest_1.expect)(result.traceId).toBeDefined();
    });
    (0, vitest_1.it)("throws ArchError when askGreenfield fails", async () => {
        const { askGreenfield } = await import("./greenfieldEnricher");
        vitest_1.vi.mocked(askGreenfield).mockRejectedValueOnce(new Error("Rate limit exceeded"));
        const { ArchError } = await import("./errors");
        await (0, vitest_1.expect)((0, manager_1.runArchitectureTask)({
            question: "Design",
            graph: EMPTY_GRAPH,
            mode: "greenfield",
            rootPath: null,
        })).rejects.toThrow(ArchError);
    });
    (0, vitest_1.it)("returns mode mismatch for analysis without rootPath", async () => {
        const result = await (0, manager_1.runArchitectureTask)({
            question: "Review this",
            graph: EMPTY_GRAPH,
            mode: "analysis",
            rootPath: null,
        });
        (0, vitest_1.expect)(result.answer).toContain("project root");
        (0, vitest_1.expect)(result.criticReport).toBeDefined();
        (0, vitest_1.expect)(result.criticScore).toBe(0);
        (0, vitest_1.expect)(result.traceId).toBeDefined();
    });
    (0, vitest_1.it)("orchestrator returns analysis error shape when mode=analysis without rootPath", async () => {
        const result = await (0, manager_1.runArchitectureTask)({
            question: "Review",
            graph: EMPTY_GRAPH,
            mode: "analysis",
            rootPath: null,
        });
        (0, vitest_1.expect)(result.criticScore).toBe(0);
        (0, vitest_1.expect)(result.answer).toContain("project root");
    });
});
(0, vitest_1.describe)("integration: mock LLM with malformed graphCommand", () => {
    (0, vitest_1.it)("greenfield handles invalid graphCommand from mock - returns answer without valid command", async () => {
        const { askGreenfield } = await import("./greenfieldEnricher");
        vitest_1.vi.mocked(askGreenfield).mockResolvedValueOnce({
            answer: "Design proposal",
            graphCommand: { action: "create_node", id: "../evil", label: "Evil", layer: "Utilities" },
        });
        const { reviewGreenfieldAnswer } = await import("./critic");
        vitest_1.vi.mocked(reviewGreenfieldAnswer).mockResolvedValueOnce({
            approved: true,
            score: 80,
            report: "OK",
            violations: [],
        });
        const result = await (0, manager_1.runArchitectureTask)({
            question: "Design",
            graph: EMPTY_GRAPH,
            mode: "greenfield",
            rootPath: null,
        });
        // greenfieldEnricher validates graphCommand - invalid id would fail validation
        // and answer would include validation note. Result shape should still be valid.
        (0, vitest_1.expect)(result.answer).toBeDefined();
        (0, vitest_1.expect)(result.criticReport).toBeDefined();
        (0, vitest_1.expect)(result.traceId).toBeDefined();
    });
});
(0, vitest_1.describe)("fuzz: malformed graphCommand payloads", () => {
    const malformedPayloads = [
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
        (0, vitest_1.it)(`rejects malformed payload #${i + 1}: ${preview}`, () => {
            const r = (0, validateGraphCommand_1.validateGraphCommand)(payload);
            (0, vitest_1.expect)(r.valid).toBe(false);
            (0, vitest_1.expect)(r.valid === false ? r.error : "").toBeTruthy();
        });
    });
});
