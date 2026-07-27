/** Phase 1 todo status helpers */

export const PHASE1_STATUSES = ["todo", "in_progress", "needs_review", "done"] as const;
export type Phase1Status = (typeof PHASE1_STATUSES)[number];

const TRANSITIONS: Record<Phase1Status, Phase1Status[]> = {
  todo: ["in_progress"],
  in_progress: ["needs_review", "todo"],
  needs_review: ["done", "in_progress", "todo"],
  done: [],
};

export function normalizeTodoStatus(status: string | null | undefined): Phase1Status {
  if (status === "pending") return "todo";
  if (status === "completed") return "done";
  if (PHASE1_STATUSES.includes(status as Phase1Status)) return status as Phase1Status;
  return "todo";
}

export function canTransitionTodo(from: string, to: string): boolean {
  const f = normalizeTodoStatus(from);
  const t = normalizeTodoStatus(to);
  return TRANSITIONS[f].includes(t);
}

export function isDependencyDone(status: string | null | undefined): boolean {
  const s = normalizeTodoStatus(status);
  return s === "done";
}

export function buildTaskAgentPrompt(row: {
  title?: string | null;
  description?: string | null;
  context?: string | null;
  constraints?: string | null;
  acceptance_criteria?: unknown;
  file_scope?: string[] | null;
}): string {
  const parts: string[] = [];
  if (row.context?.trim()) parts.push(`## Context\n${row.context.trim()}`);
  if (row.constraints?.trim()) parts.push(`## Constraints\n${row.constraints.trim()}`);
  const ac = row.acceptance_criteria as { functional?: string[]; technical?: string[] } | null;
  if (ac && typeof ac === "object") {
    const fn = Array.isArray(ac.functional) ? ac.functional.filter(Boolean) : [];
    const tech = Array.isArray(ac.technical) ? ac.technical.filter(Boolean) : [];
    if (fn.length || tech.length) {
      parts.push(
        `## Acceptance criteria\n${[...fn, ...tech].map((x) => `- ${x}`).join("\n")}`
      );
    }
  }
  if (row.file_scope?.length) {
    parts.push(`## File scope\n${row.file_scope.map((p) => `- ${p}`).join("\n")}`);
  }
  if (row.description?.trim()) parts.push(`## Notes\n${row.description.trim()}`);
  return parts.join("\n\n") || String(row.title ?? "Task");
}
