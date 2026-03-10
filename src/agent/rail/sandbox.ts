import * as path from "path";
import * as fs from "fs";
import type { RailId } from "../types";
import { getAllRails } from "./manager.js";

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

export function cleanupOrphanSandboxes(rootPath: string, workspaceId?: string | null): void {
  const base = path.join(rootPath, ".agent", "sandboxes");
  if (!fs.existsSync(base)) return;
  const rails = new Set(
    getAllRails()
      .filter((r) => !workspaceId || r.workspaceId === workspaceId)
      .map((r) => r.id)
  );
  const entries = fs.readdirSync(base, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const name = e.name;
    if (!name.startsWith("rail-")) continue;
    const railId = name.slice("rail-".length);
    if (!rails.has(railId as RailId)) {
      const dir = path.join(base, name);
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

