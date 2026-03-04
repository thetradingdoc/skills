import * as path from "path";
import * as fs from "fs";
import type { RailId } from "../types";

export function getSandboxPath(rootPath: string, railId: RailId): string {
  return path.join(rootPath, ".agent", "sandboxes", `rail-${railId}`);
}

export function ensureSandbox(rootPath: string, railId: RailId): string {
  const sandboxPath = getSandboxPath(rootPath, railId);
  if (!fs.existsSync(sandboxPath)) {
    fs.mkdirSync(sandboxPath, { recursive: true });
  }
  return sandboxPath;
}

/** Remove sandbox directory for a rail (on archive/fail). */
export function removeSandbox(rootPath: string, railId: RailId): void {
  const sandboxPath = getSandboxPath(rootPath, railId);
  try {
    if (fs.existsSync(sandboxPath)) {
      fs.rmSync(sandboxPath, { recursive: true, force: true });
    }
  } catch {
    /* best-effort */
  }
}

