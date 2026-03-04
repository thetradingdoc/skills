import { describe, it, expect } from "vitest";

describe("lib [Utilities]", () => {
  it("exports expected symbols", async () => {
    const mod = await import("./arch.test.ts");
    expect(mod).toHaveProperty("request");
  });
});