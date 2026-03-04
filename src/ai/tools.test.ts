import { describe, it, expect } from "vitest";
import * as path from "path";
import { executeReadFile, executeGrep, executeRunCommand } from "./tools";

const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/sample-project");

describe("tools", () => {
  describe("executeReadFile", () => {
    it("returns file content for existing file", () => {
      const res = executeReadFile(FIXTURE_PATH, "src/auth/index.ts");
      expect(res.result).toBeDefined();
      expect(res.error).toBeUndefined();
      expect(res.result).toContain("---");
    });

    it("returns error for file not found", () => {
      const res = executeReadFile(FIXTURE_PATH, "src/nonexistent.ts");
      expect(res.error).toBeDefined();
      expect(res.result).toBeUndefined();
    });

    it("rejects path outside project root", () => {
      const res = executeReadFile(FIXTURE_PATH, "../../../etc/passwd");
      expect(res.error).toBe("Path outside project root");
    });
  });

  describe("executeGrep", () => {
    it("returns matching lines", () => {
      const res = executeGrep(FIXTURE_PATH, "export");
      expect(res.results).toBeDefined();
      expect(Array.isArray(res.results)).toBe(true);
    });
  });

  describe("executeRunCommand", () => {
    it("rejects disallowed commands", () => {
      const res = executeRunCommand(FIXTURE_PATH, "rm -rf /");
      expect(res.error).toBeDefined();
      expect(res.error).toContain("not allowed");
      expect(res.result).toBeUndefined();
    });

    it("returns result and exitCode for allowed command", () => {
      const res = executeRunCommand(FIXTURE_PATH, "npx tsc --noEmit");
      expect(res.error).toBeUndefined();
      expect(res.result).toBeDefined();
      expect(res.result).toContain("exitCode:");
      expect(typeof res.exitCode).toBe("number");
    });
  });
});
