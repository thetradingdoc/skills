import { describe, it, expect } from "vitest";

describe("src/auth [Business Logic]", () => {
  it("exports expected symbols", async () => {
    const mod = await import("./arch.test.ts");
    expect(mod).toHaveProperty("getSession");
    expect(mod).toHaveProperty("initSession");
  });
});