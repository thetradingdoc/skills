/**
 * Task type classifier — distinguishes auto-capable vs HITL-required tasks.
 */

import type { Task } from "./types.js";

/** Kinds that are typically auto-capable (no human approval needed). */
const AUTO_CAPABLE_KINDS = new Set<string>([
  "code_change",
  "verification",
  "lint",
  "test",
  "playwright",
]);

/** Patterns in description that suggest HITL is required. */
const HITL_PATTERNS = [
  /human.?review|approval|sign.?off|confirm|manual/i,
  /security|auth|credential|secret|production/i,
  /delete|remove|destroy|drop/i,
  /deploy|release|publish/i,
];

/**
 * Classify a task as auto-capable or HITL-required.
 * Uses task.autoCapable if set; otherwise infers from kind and description.
 */
export function classifyTaskAutoCapable(task: Task): boolean {
  if (task.autoCapable === false) return false;
  if (task.autoCapable === true) return true;
  if (!AUTO_CAPABLE_KINDS.has(task.kind)) return false;
  const desc = (task.description ?? "").toLowerCase();
  if (HITL_PATTERNS.some((p) => p.test(desc))) return false;
  return true;
}

/**
 * Partition tasks into auto-capable and HITL-required.
 */
export function partitionTasksByCapability(tasks: Task[]): {
  autoCapable: Task[];
  hitlRequired: Task[];
} {
  const autoCapable: Task[] = [];
  const hitlRequired: Task[] = [];
  for (const t of tasks) {
    if (classifyTaskAutoCapable(t)) autoCapable.push(t);
    else hitlRequired.push(t);
  }
  return { autoCapable, hitlRequired };
}
