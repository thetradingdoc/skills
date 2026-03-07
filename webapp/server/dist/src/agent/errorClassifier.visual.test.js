"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const errorClassifier_1 = require("./errorClassifier");
(0, vitest_1.describe)("classifyFailure – visual Playwright failures", () => {
    const basePlan = {
        goal: "Test visual failure routing",
        tasks: [],
        dependencies: [],
    };
    function makeCtx(touchedPaths = []) {
        return {
            touchedPaths,
            plan: basePlan,
            retryCounts: {},
        };
    }
    (0, vitest_1.it)("routes [VISUAL] failures to playwright_visual_failure + hitl", () => {
        const failure = {
            tool: "run_playwright_trace",
            passed: false,
            errors: [
                {
                    filePath: "scripts/landing-visual.spec.ts",
                    message: "[VISUAL] landing hero is not visible",
                    code: "[VISUAL] landing hero",
                    type: "runtime",
                },
            ],
        };
        const result = (0, errorClassifier_1.classifyFailure)(failure, makeCtx());
        (0, vitest_1.expect)(result.type).toBe("playwright_visual_failure");
        (0, vitest_1.expect)(result.route).toBe("hitl");
    });
});
