/**
 * sessionTouchedPaths — AGENT_ROADMAP v4 §4c
 * Phase 1: stub populated on dry-run commits. Phase 2 replaces with real staging.
 */

const paths = new Set<string>();

export function getSessionTouchedPaths(): string[] {
  return Array.from(paths);
}

export function addTouchedPath(p: string): void {
  paths.add(p);
}

export function addTouchedPaths(ps: string[]): void {
  for (const p of ps) paths.add(p);
}

/** Phase 1 stub: simulate a commit by adding paths without writing files. */
export function mockCommit(pathsToAdd: string[]): void {
  addTouchedPaths(pathsToAdd);
}

export function clearSessionTouchedPaths(): void {
  paths.clear();
}
