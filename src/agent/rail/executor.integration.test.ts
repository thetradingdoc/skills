import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { materializeRail } from "./executor";

const TMP_ROOT = path.join(process.cwd(), ".tmp-rail-materialize-test");
const SANDBOX = path.join(TMP_ROOT, ".agent", "sandboxes", "rail-test");

describe("rail materialize integration", () => {
  beforeAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
    fs.mkdirSync(SANDBOX, { recursive: true });
    const filePath = path.join(SANDBOX, "src", "example.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export const x = 1;\n", "utf-8");
  });

  afterAll(() => {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("copies sandbox files into project root", () => {
    const result = materializeRail("test" as any, SANDBOX, TMP_ROOT);
    expect(result.success).toBe(true);
    expect(result.copiedFiles).toContain("src/example.ts");
    const target = path.join(TMP_ROOT, "src", "example.ts");
    expect(fs.existsSync(target)).toBe(true);
    const content = fs.readFileSync(target, "utf-8");
    expect(content).toContain("export const x = 1");
  });

  it("returns a failure result when sandbox is missing", () => {
    const missingSandbox = path.join(TMP_ROOT, ".agent", "sandboxes", "rail-missing");
    const result = materializeRail("missing" as any, missingSandbox, TMP_ROOT);
    expect(result.success).toBe(false);
    expect(result.copiedFiles).toEqual([]);
    expect(result.error).toBeDefined();
  });
});

