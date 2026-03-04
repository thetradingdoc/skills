import { describe, it, expect } from "vitest";
import { getAst } from "./getAst";
import * as path from "path";

describe("getAst", () => {
  const root = path.resolve(__dirname, "../../");

  it("extracts AST from a TS file", () => {
    const result = getAst(root, "src/agent/planValidator.ts");
    expect(result.success).toBe(true);
    expect(result.output?.path).toBe("src/agent/planValidator.ts");
    expect(result.output?.fingerprint).toMatch(/^[a-f0-9]+$/);
    expect(result.output?.exports).toBeDefined();
    expect(result.output?.imports).toBeDefined();
    expect(result.output?.topLevelDeclarations).toBeDefined();
  });

  it("rejects path outside allowlist", () => {
    const result = getAst(root, ".env");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects non-existent file", () => {
    const result = getAst(root, "src/nonexistent.ts");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
