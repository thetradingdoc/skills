import * as fs from "fs";
import * as path from "path";
import type { RailId } from "../types";
import { getSandboxPath, ensureSandbox } from "./sandbox";

export interface MaterializationResult {
  success: boolean;
  copiedFiles: string[];
  error?: string;
}

export function getRailSandboxPath(rootPath: string, railId: RailId): string {
  return getSandboxPath(rootPath, railId);
}

/**
 * Sync a set of project-relative paths from the real project root into the rail's sandbox.
 * This is used so verification (lint/tests/Playwright) can run against the sandbox.
 */
export function syncSandboxFromRoot(
  rootPath: string,
  railId: RailId,
  paths: string[]
): string {
  const sandboxRoot = ensureSandbox(rootPath, railId);
  for (const rel of paths) {
    const src = path.join(rootPath, rel);
    const dst = path.join(sandboxRoot, rel);
    try {
      if (!fs.existsSync(src)) continue;
      const dir = path.dirname(dst);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.copyFileSync(src, dst);
    } catch {
      // Best-effort; verification will still run against whatever is present.
    }
  }
  return sandboxRoot;
}

export function materializeRail(
  railId: RailId,
  sandboxPath: string,
  rootPath: string
): MaterializationResult {
  const copiedFiles: string[] = [];
  try {
    const sandboxRoot = path.resolve(sandboxPath);
    const projectRoot = path.resolve(rootPath);

    if (!fs.existsSync(sandboxRoot)) {
      return { success: false, copiedFiles, error: `Sandbox for rail ${railId} does not exist` };
    }

    const entries = walkDir(sandboxRoot);
    for (const absFile of entries) {
      const rel = path.relative(sandboxRoot, absFile);
      const target = path.join(projectRoot, rel);
      const targetDir = path.dirname(target);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.copyFileSync(absFile, target);
      copiedFiles.push(rel.replace(/\\/g, "/"));
    }

    return { success: true, copiedFiles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, copiedFiles, error: message };
  }
}

function walkDir(root: string): string[] {
  const result: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const children = fs.readdirSync(current);
      for (const child of children) {
        stack.push(path.join(current, child));
      }
    } else if (stat.isFile()) {
      result.push(current);
    }
  }
  return result;
}

