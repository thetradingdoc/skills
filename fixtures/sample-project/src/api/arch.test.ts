import { describe, it, expect } from "vitest";

describe("src/api [Business Logic]", () => {
  it("exports expected symbols", async () => {
    const mod = await import("./arch.test.ts");
    expect(mod).toHaveProperty("createClient");
    expect(mod).toHaveProperty("ApiConfig");
  });
});