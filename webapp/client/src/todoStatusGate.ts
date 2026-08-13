/** Manual Move gates for Flow Tasks (client + unit tests). */

export type ManualAdvanceResult = { ok: true } | { ok: false; reason: string };

/**
 * Checklist-only Move when there is no rail.
 * With rail_id: agent owns needs_review; Approve owns done.
 */
export function canManualAdvanceTodo(
  todo: { status?: string | null; rail_id?: string | null },
  nextStatus: string
): ManualAdvanceResult {
  const rail = todo.rail_id?.trim();
  const next = normalizeManualStatus(nextStatus);
  if (rail && next === "done") {
    return { ok: false, reason: "Use Approve to apply sandbox changes" };
  }
  if (rail && next === "needs_review") {
    return { ok: false, reason: "Wait for the agent — or Reject if reviewing" };
  }
  return { ok: true };
}

function normalizeManualStatus(status: string): string {
  if (status === "pending") return "todo";
  if (status === "completed") return "done";
  return status;
}
