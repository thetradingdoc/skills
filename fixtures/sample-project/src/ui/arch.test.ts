import { describe, it, expect } from "vitest";

describe("src/ui [Presentation]", () => {
  it("exports expected symbols", async () => {
    const mod = await import("./App.tsx");
    expect(mod).toHaveProperty("App");
    expect(mod).toHaveProperty("Dashboard");
  });
});