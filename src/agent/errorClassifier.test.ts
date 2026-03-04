import { describe, it, expect } from "vitest";
import { classifyFailure } from "./errorClassifier";
import type { VerificationOutput, ClassifyFailureContext } from "./types";

function ctx(touched: string[] = []): ClassifyFailureContext {
  return {
    touchedPaths: touched,
    plan: { goal: "x", tasks: [], dependencies: [] },
    retryCounts: {},
  };
}

describe("errorClassifier", () => {
  it("routes ts_error to code_writer", () => {
    const f: VerificationOutput = {
      tool: "run_lint",
      passed: false,
      errors: [{ filePath: "src/a.ts", message: "x", type: "ts" }],
    };
    const r = classifyFailure(f, ctx(["src/a.ts"]));
    expect(r.type).toBe("ts_error");
    expect(r.route).toBe("code_writer");
  });

  it("routes vitest_failure_touched when path in touchedPaths", () => {
    const f: VerificationOutput = {
      tool: "run_vitest",
      passed: false,
      errors: [{ filePath: "src/auth/index.ts", message: "fail", type: "test" }],
    };
    const r = classifyFailure(f, ctx(["src/auth/index.ts"]));
    expect(r.type).toBe("vitest_failure_touched");
    expect(r.route).toBe("code_writer");
  });

  it("routes vitest_failure_untouched to hitl when path not in touchedPaths", () => {
    const f: VerificationOutput = {
      tool: "run_vitest",
      passed: false,
      errors: [{ filePath: "src/other/mod.ts", message: "fail", type: "test" }],
    };
    const r = classifyFailure(f, ctx(["src/auth/index.ts"]));
    expect(r.type).toBe("vitest_failure_untouched");
    expect(r.route).toBe("hitl");
  });

  it("routes layer_violation from diff_graph to arch_planner", () => {
    const f: VerificationOutput = {
      tool: "diff_graph",
      passed: false,
      errors: [{ filePath: "src", message: "layer mismatch", type: "layer" }],
    };
    const r = classifyFailure(f, ctx());
    expect(r.type).toBe("layer_violation");
    expect(r.route).toBe("arch_planner");
  });
});
