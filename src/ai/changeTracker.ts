/**
 * What the tool changed, and how to put it back.
 *
 * Phase C in the plan called for a sandbox: hold every write until it has been
 * reviewed, then apply. The sandbox that exists is a mkdir coupled to the
 * rails system, and a worktree per edit is heavy for a one-line change.
 *
 * So changes land immediately and are reviewed after — the model Cursor uses,
 * and the one already half-built. The typecheck rollback catches anything that
 * breaks the build; review catches changes that compile and are still wrong.
 *
 * The cost of that choice is that a bad edit is briefly real. The mitigation is
 * that every write is recorded with the contents that preceded it, so revert is
 * exact rather than approximate — and available long after the turn that made
 * the change has ended.
 */
import * as fs from "fs";
import * as path from "path";

export type ChangeRecord = {
  id: string;
  at: string;
  action: "edit" | "create";
  /** Path relative to the project root. */
  file: string;
  /** Contents before the change. Absent for a created file. */
  previous?: string;
  /** Contents written. Kept so a reverted change can be reapplied. */
  next: string;
  /** Set once the change has been put back. */
  reverted?: boolean;
  revertedAt?: string;
};

const CHANGES_DIR = ".agent";
const CHANGES_FILE = "changes.json";

function changesPath(rootPath: string): string {
  return path.join(path.resolve(rootPath), CHANGES_DIR, CHANGES_FILE);
}

export function readChanges(rootPath: string): ChangeRecord[] {
  try {
    const p = changesPath(rootPath);
    if (!fs.existsSync(p)) return [];
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeChanges(rootPath: string, records: ChangeRecord[]): void {
  try {
    const dir = path.join(path.resolve(rootPath), CHANGES_DIR);
    fs.mkdirSync(dir, { recursive: true });
    // Keep the file bounded. A hundred changes is far more history than anyone
    // reviews, and this sits inside the user's repository.
    const trimmed = records.slice(-100);
    fs.writeFileSync(changesPath(rootPath), JSON.stringify(trimmed, null, 2), "utf-8");
  } catch {
    // Recording must never be the reason a write fails.
  }
}

export function recordChange(
  rootPath: string,
  entry: Omit<ChangeRecord, "id" | "at">
): ChangeRecord {
  const record: ChangeRecord = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: new Date().toISOString(),
    ...entry,
  };
  const all = readChanges(rootPath);
  all.push(record);
  writeChanges(rootPath, all);
  return record;
}

/**
 * Put a change back.
 *
 * An edit is restored to its previous contents. A created file is deleted,
 * since there is nothing to restore it to — which is why the action is
 * recorded rather than inferred from whether previous is set.
 */
export function revertChange(
  rootPath: string,
  changeId: string
): { ok?: true; error?: string } {
  const all = readChanges(rootPath);
  const record = all.find((c) => c.id === changeId);

  if (!record) return { error: "No change with id " + changeId };
  if (record.reverted) return { error: "That change has already been reverted." };

  const abs = path.resolve(path.resolve(rootPath), record.file);

  // The path was validated when the change was made, but a records file can be
  // edited by hand, so it is checked again before anything is written.
  const rel = path.relative(path.resolve(rootPath), abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { error: "Refusing to revert a path outside the project root" };
  }

  try {
    if (record.action === "create") {
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } else {
      if (record.previous === undefined) {
        return { error: "No previous contents recorded for this edit" };
      }
      fs.writeFileSync(abs, record.previous, "utf-8");
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  record.reverted = true;
  record.revertedAt = new Date().toISOString();
  writeChanges(rootPath, all);
  return { ok: true };
}

/** A unified diff, computed line by line — enough to review a change. */
export function diffOf(record: ChangeRecord): string {
  const before = (record.previous ?? "").split("\n");
  const after = record.next.split("\n");

  if (record.action === "create") {
    return after.map((l) => "+ " + l).join("\n");
  }

  // Longest common subsequence would be better, but a change made by an
  // anchored replacement is contiguous, so finding the first and last differing
  // lines is enough and stays readable.
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++;
  }

  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (
    endBefore >= start &&
    endAfter >= start &&
    before[endBefore] === after[endAfter]
  ) {
    endBefore--;
    endAfter--;
  }

  const CONTEXT = 3;
  const from = Math.max(0, start - CONTEXT);
  const lines: string[] = [];

  for (let i = from; i < start; i++) lines.push("  " + before[i]);
  for (let i = start; i <= endBefore; i++) lines.push("- " + before[i]);
  for (let i = start; i <= endAfter; i++) lines.push("+ " + after[i]);
  for (let i = endBefore + 1; i < Math.min(before.length, endBefore + 1 + CONTEXT); i++) {
    lines.push("  " + before[i]);
  }

  return lines.join("\n");
}

/** Counts for a one-line summary without rendering the whole diff. */
export function changeStats(record: ChangeRecord): { added: number; removed: number } {
  if (record.action === "create") {
    return { added: record.next.split("\n").length, removed: 0 };
  }

  const before = (record.previous ?? "").split("\n");
  const after = record.next.split("\n");

  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++;
  }

  let endBefore = before.length - 1;
  let endAfter = after.length - 1;
  while (endBefore >= start && endAfter >= start && before[endBefore] === after[endAfter]) {
    endBefore--;
    endAfter--;
  }

  return {
    added: Math.max(0, endAfter - start + 1),
    removed: Math.max(0, endBefore - start + 1),
  };
}
