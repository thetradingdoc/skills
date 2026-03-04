import { describe, it, expect } from "vitest";
import { classifyFailure } from "./errorClassifier";
import type { VerificationOutput, AgentPlan, ClassifyFailureContext } from "./types";

describe("classifyFailure – visual Playwright failures", () => {
  const basePlan: AgentPlan = {
    goal: "Test visual failure routing",
    tasks: [],
    dependencies: [],
  };

  function makeCtx(touchedPaths: string[] = []): ClassifyFailureContext {
    return {
      touchedPaths,
      plan: basePlan,
      retryCounts: {},
    };
  }

  it("routes [VISUAL] failures to playwright_visual_failure + hitl", () => {
    const failure: VerificationOutput = {
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

    const result = classifyFailure(failure, makeCtx());

    expect(result.type).toBe("playwright_visual_failure");
    expect(result.route).toBe("hitl");
  });
});

