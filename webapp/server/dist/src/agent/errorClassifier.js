"use strict";
/**
 * Error classification and routing — AGENT_ROADMAP v4 §4c
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyFailure = classifyFailure;
/**
 * Classify a verification failure and return the route target.
 */
function classifyFailure(failure, ctx) {
    const touched = new Set(ctx.touchedPaths);
    // Unknown LLM output
    if (failure.tool === "llm_response" && !failure.passed) {
        return { type: "unknown_llm_output", route: "code_writer" };
    }
    // diff_graph failure (scanner error) → treat as layer_violation
    if (failure.tool === "diff_graph" && !failure.passed) {
        return { type: "layer_violation", route: "arch_planner" };
    }
    // run_lint
    if (failure.tool === "run_lint" && !failure.passed) {
        const hasTs = failure.errors.some((e) => e.type === "ts");
        const hasLint = failure.errors.some((e) => e.type === "lint");
        if (hasTs)
            return { type: "ts_error", route: "code_writer" };
        if (hasLint)
            return { type: "lint_error", route: "code_writer" };
        return { type: "lint_error", route: "code_writer" };
    }
    // run_vitest
    if (failure.tool === "run_vitest" && !failure.passed) {
        const touchedByFailure = failure.errors.some((e) => touched.has(e.filePath));
        return {
            type: touchedByFailure ? "vitest_failure_touched" : "vitest_failure_untouched",
            route: touchedByFailure ? "code_writer" : "hitl",
        };
    }
    // run_playwright_trace
    if (failure.tool === "run_playwright_trace" && !failure.passed) {
        const touchedByFailure = failure.errors.some((e) => touched.has(e.filePath));
        return {
            type: touchedByFailure ? "playwright_failure_touched" : "playwright_failure_untouched",
            route: touchedByFailure ? "code_writer" : "hitl",
        };
    }
    // layer_violation from diff_graph
    if (failure.tool === "diff_graph" || failure.errors.some((e) => e.type === "layer")) {
        return { type: "layer_violation", route: "arch_planner" };
    }
    return { type: "ts_error", route: "code_writer" };
}
