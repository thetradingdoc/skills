/**
 * Durable staging buffer — AGENT_ROADMAP v4 §5c, §6
 * write_file → .arch-agent-staging/, commit_file applies after approval.
 */

import * as fs from "fs";
import * as path from "path";

function isPathUnderRoot(projectRoot: string, filePath: string): boolean {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, filePath);
  const relative = path.relative(root, resolved).replace(/\\/g, "/");
  return !relative.startsWith("..") && !path.isAbsolute(relative);
}
import { addTouchedPaths } from "./sessionTouchedPaths";

const STAGING_DIR = ".arch-agent-staging";
const BUFFER_FILE = "buffer.json";

interface StagingEntry {
  path: string;
  content: string;
  beforeContent?: string;
  taskId?: string;
}

let stagingDir: string = "";
const buffer = new Map<string, StagingEntry>();

export function initStaging(projectRoot: string): void {
  stagingDir = path.join(projectRoot, STAGING_DIR);
  if (!fs.existsSync(stagingDir)) {
    fs.mkdirSync(stagingDir, { recursive: true });
  }
  loadBuffer();
}

function bufferPath(): string {
  return path.join(stagingDir, BUFFER_FILE);
}

function loadBuffer(): void {
  buffer.clear();
  const p = bufferPath();
  if (fs.existsSync(p)) {
    try {
      const raw = fs.readFileSync(p, "utf-8");
      const arr = JSON.parse(raw) as StagingEntry[];
      for (const e of arr) buffer.set(e.path, e);
    } catch {
      buffer.clear();
    }
  }
}

function saveBuffer(): void {
  const p = bufferPath();
  const arr = Array.from(buffer.values());
  fs.writeFileSync(p, JSON.stringify(arr, null, 2), "utf-8");
}

export function writeToStaging(
  filePath: string,
  content: string,
  opts?: { beforeContent?: string; taskId?: string }
): string {
  const id = `stg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  buffer.set(filePath, {
    path: filePath,
    content,
    beforeContent: opts?.beforeContent,
    taskId: opts?.taskId,
  });
  saveBuffer();
  return id;
}

export function getStagingEntries(): StagingEntry[] {
  return Array.from(buffer.values());
}

export function getStagingById(id: string): StagingEntry | null {
  for (const e of buffer.values()) {
    if (id.startsWith("stg_")) return e;
  }
  return buffer.values().next().value ?? null;
}

export function commitStaging(pathsToCommit: string[], projectRoot: string): { success: boolean; error?: string } {
  const root = path.resolve(projectRoot);
  for (const p of pathsToCommit) {
    if (!isPathUnderRoot(projectRoot, p)) {
      return { success: false, error: `Path outside project root: ${p}` };
    }
    const e = buffer.get(p);
    if (!e) continue;
    const fullPath = path.join(root, p);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, e.content, "utf-8");
    buffer.delete(p);
  }
  saveBuffer();
  addTouchedPaths(pathsToCommit);
  return { success: true };
}

export function rejectStaging(pathsToReject: string[]): void {
  for (const p of pathsToReject) buffer.delete(p);
  saveBuffer();
}

export function clearStaging(): void {
  buffer.clear();
  if (stagingDir && fs.existsSync(bufferPath())) {
    fs.writeFileSync(bufferPath(), "[]", "utf-8");
  }
}

export function getStagingDir(): string {
  return stagingDir;
}
