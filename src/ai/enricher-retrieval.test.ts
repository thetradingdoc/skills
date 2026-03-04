import { describe, it, expect } from "vitest";
import { clearPlanCache } from "./enricher-retrieval";

describe("enricher-retrieval", () => {
  it("clearPlanCache does not throw", () => {
    expect(() => clearPlanCache()).not.toThrow();
  });
});
