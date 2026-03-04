"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errorClassifier_1 = require("./errorClassifier");
function ctx(touched = []) {
    return {
        touchedPaths: touched,
        plan: { goal: "x", tasks: [], dependencies: [] },
        retryCounts: {},
    };
}
(0, vitest_1.describe)("errorClassifier", () => {
    (0, vitest_1.it)("routes ts_error to code_writer", () => {
        const f = {
            tool: "run_lint",
            passed: false,
            errors: [{ filePath: "src/a.ts", message: "x", type: "ts" }],
        };
        const r = (0, errorClassifier_1.classifyFailure)(f, ctx(["src/a.ts"]));
        (0, vitest_1.expect)(r.type).toBe("ts_error");
        (0, vitest_1.expect)(r.route).toBe("code_writer");
    });
    (0, vitest_1.it)("routes vitest_failure_touched when path in touchedPaths", () => {
        const f = {
            tool: "run_vitest",
            passed: false,
            errors: [{ filePath: "src/auth/index.ts", message: "fail", type: "test" }],
        };
        const r = (0, errorClassifier_1.classifyFailure)(f, ctx(["src/auth/index.ts"]));
        (0, vitest_1.expect)(r.type).toBe("vitest_failure_touched");
        (0, vitest_1.expect)(r.route).toBe("code_writer");
    });
    (0, vitest_1.it)("routes vitest_failure_untouched to hitl when path not in touchedPaths", () => {
        const f = {
            tool: "run_vitest",
            passed: false,
            errors: [{ filePath: "src/other/mod.ts", message: "fail", type: "test" }],
        };
        const r = (0, errorClassifier_1.classifyFailure)(f, ctx(["src/auth/index.ts"]));
        (0, vitest_1.expect)(r.type).toBe("vitest_failure_untouched");
        (0, vitest_1.expect)(r.route).toBe("hitl");
    });
    (0, vitest_1.it)("routes layer_violation from diff_graph to arch_planner", () => {
        const f = {
            tool: "diff_graph",
            passed: false,
            errors: [{ filePath: "src", message: "layer mismatch", type: "layer" }],
        };
        const r = (0, errorClassifier_1.classifyFailure)(f, ctx());
        (0, vitest_1.expect)(r.type).toBe("layer_violation");
        (0, vitest_1.expect)(r.route).toBe("arch_planner");
    });
});
