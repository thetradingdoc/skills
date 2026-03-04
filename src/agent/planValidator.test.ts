import { describe, it, expect } from "vitest";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { validatePlan } from "./planValidator";

const tmpDir = path.join(os.tmpdir(), `arch-agent-test-${Date.now()}`);

function setupTmpProject(): string {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "services"), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, "src", "auth"), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "src", "services", "index.ts"), "export {};\n");
  fs.writeFileSync(path.join(tmpDir, "src", "auth", "index.ts"), "export {};\n");
  return tmpDir;
}

describe("planValidator", () => {
  it("rejects invalid JSON", () => {
    const root = setupTmpProject();
    const r = validatePlan("{ invalid", root);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("JSON");
  });

  it("rejects schema with missing fields", () => {
    const root = setupTmpProject();
    const r = validatePlan(JSON.stringify({ goal: "x" }), root);
    expect(r.valid).toBe(false);
    expect(r.error).toBeDefined();
  });

  it("accepts valid plan", () => {
    const root = setupTmpProject();
    const plan = {
      goal: "Add auth",
      tasks: [
        { id: "T1", module: "src/auth", layer: "Business Logic", action: "create", expectedOutput: "Auth module" },
        { id: "T2", module: "src/services", layer: "Business Logic", action: "modify", expectedOutput: "Uses auth" },
      ],
      dependencies: [["T1", "T2"]],
    };
    const r = validatePlan(JSON.stringify(plan), root);
    expect(r.valid).toBe(true);
    expect(r.plan).toBeDefined();
  });

  it("detects circular dependencies", () => {
    const root = setupTmpProject();
    const plan = {
      goal: "x",
      tasks: [
        { id: "A", module: "src/auth", layer: "Business Logic", action: "create", expectedOutput: "x" },
        { id: "B", module: "src/services", layer: "Business Logic", action: "create", expectedOutput: "x" },
      ],
      dependencies: [
        ["A", "B"],
        ["B", "A"],
      ],
    };
    const r = validatePlan(JSON.stringify(plan), root);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Circular");
  });

  it("detects file conflicts between tasks", () => {
    const root = setupTmpProject();
    const plan = {
      goal: "x",
      tasks: [
        { id: "T1", module: "src/services", layer: "Business Logic", action: "modify", expectedOutput: "x" },
        { id: "T2", module: "src/services/index.ts", layer: "Business Logic", action: "modify", expectedOutput: "x" },
      ],
      dependencies: [],
    };
    const r = validatePlan(JSON.stringify(plan), root);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("both touch");
  });
});
