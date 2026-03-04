/**
 * write_context_summary — AGENT_ROADMAP v4 §10e
 * Typed schema, validation, allowlist.
 */

import * as fs from "fs";
import * as path from "path";
import { checkPathAllowed } from "./securityAllowlist";

export interface ContextSummaryBlock {
  sessionDate: string;
  action: "create" | "modify" | "refactor";
  layer: string;
  tests: { vitest: "pass" | "fail"; playwright?: "pass" | "fail" };
  fingerprint: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validateContextSummaryBlock(obj: unknown): { valid: boolean; error?: string } {
  if (!obj || typeof obj !== "object") {
    return { valid: false, error: "Summary must be an object" };
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.sessionDate !== "string" || !DATE_REGEX.test(o.sessionDate)) {
    return { valid: false, error: "sessionDate must be YYYY-MM-DD" };
  }
  if (!["create", "modify", "refactor"].includes(o.action as string)) {
    return { valid: false, error: "action must be create, modify, or refactor" };
  }
  if (typeof o.layer !== "string") {
    return { valid: false, error: "layer must be a string" };
  }
  if (!o.tests || typeof o.tests !== "object") {
    return { valid: false, error: "tests must be an object" };
  }
  const t = o.tests as Record<string, unknown>;
  if (t.vitest !== "pass" && t.vitest !== "fail") {
    return { valid: false, error: "tests.vitest must be pass or fail" };
  }
  if (t.playwright !== undefined && t.playwright !== "pass" && t.playwright !== "fail") {
    return { valid: false, error: "tests.playwright must be pass or fail" };
  }
  if (typeof o.fingerprint !== "string") {
    return { valid: false, error: "fingerprint must be a string" };
  }
  return { valid: true };
}

export function writeContextSummary(
  projectRoot: string,
  modulePath: string,
  summary: ContextSummaryBlock
): { success: boolean; error?: string } {
  const fullPath = path.join(projectRoot, modulePath, ".context.md");
  const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
  const allowed = checkPathAllowed(relativePath, { projectRoot });
  if (!allowed.allowed) {
    return { success: false, error: allowed.reason };
  }
  const block = `\n## Agent Session ${summary.sessionDate}
- Action: ${summary.action}
- Layer: ${summary.layer}
- Tests: vitest ${summary.tests.vitest}${summary.tests.playwright ? `, playwright ${summary.tests.playwright}` : ""}
- Fingerprint: ${summary.fingerprint}
`;
  try {
    if (fs.existsSync(fullPath)) {
      fs.appendFileSync(fullPath, block, "utf-8");
    } else {
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, block.trimStart(), "utf-8");
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
