/**
 * Copy analysis-chat rail sandbox to project root and archive.
 */

import * as fs from "fs";
import * as path from "path";
import {
  getRail,
  loadRails,
  updateRailState,
} from "../../../src/agent/rail/manager.js";
import { transitionRail } from "../../../src/agent/rail/orchestrator.js";
import { getSandboxPath } from "../../../src/agent/rail/sandbox.js";
import type { Rail } from "../../../src/agent/types.js";

function walkDir(dir: string, base: string, maxDepth: number): string[] {
  const out: string[] = [];
  if (maxDepth <= 0) return out;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = path.relative(base, path.join(dir, e.name));
      if (e.isDirectory()) {
        out.push(rel + "/");
        out.push(...walkDir(path.join(dir, e.name), base, maxDepth - 1));
      } else {
        out.push(rel);
      }
    }
  } catch {
    // ignore
  }
  return out;
}

export function materializeAnalysisRail(
  root: string,
  railId: string
): { ok: true; rail: Rail } | { ok: false; error: string; status?: number } {
  loadRails(root);
  const rail = getRail(root, railId);
  if (!rail) {
    return { ok: false, error: "Rail not found.", status: 404 };
  }
  if (rail.archetype === "greenfield-materialize") {
    return { ok: false, error: "Use greenfield materialize for this rail.", status: 400 };
  }
  const verifTasks = (rail.tasks ?? []).filter((t) => t.kind === "verification");
  const passed = verifTasks.length > 0 && verifTasks.every((t) => t.status === "completed");
  if (!passed) {
    return {
      ok: false,
      error: "Verification has not passed yet.",
      status: 409,
    };
  }
  const sandboxPath = getSandboxPath(root, railId);
  if (!fs.existsSync(sandboxPath)) {
    return { ok: false, error: "Sandbox not found for this rail.", status: 400 };
  }
  const relFiles = walkDir(sandboxPath, sandboxPath, 6).filter((p) => !p.endsWith("/"));
  const copied: string[] = [];
  for (const rel of relFiles) {
    const srcFile = path.join(sandboxPath, rel);
    const rootFile = path.join(root, rel);
    try {
      const dir = path.dirname(rootFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(rootFile, fs.readFileSync(srcFile, "utf-8"), "utf-8");
      copied.push(rel);
    } catch {
      // best-effort per file
    }
  }
  const toMat = transitionRail(root, railId, "MATERIALIZING" as any, { reviewerPassed: true } as any);
  if (!toMat.ok || !toMat.rail) {
    return { ok: false, error: toMat.error ?? "Failed to enter MATERIALIZING.", status: 500 };
  }
  updateRailState(root, railId, toMat.rail.state);
  const tr = transitionRail(root, railId, "ARCHIVED" as any, { materializationApproved: true } as any);
  if (!tr.ok || !tr.rail) {
    return { ok: false, error: tr.error ?? "Failed to archive rail.", status: 500 };
  }
  updateRailState(root, railId, tr.rail.state);
  return { ok: true, rail: tr.rail };
}
